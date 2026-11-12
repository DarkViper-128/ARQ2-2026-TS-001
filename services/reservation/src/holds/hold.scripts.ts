/**
 * Lua scripts run by Redis as a single atomic step.
 *
 * Atomicity is the whole point: two fans asking for seat A-12-07 in the same millisecond
 * cannot both win, and no row-level lock is held in MySQL while the payment runs
 * (ADR 001).
 *
 * Keys in hold-store:
 *   seat:{eventId}:{seatId}  holdId while held (TTL), `sold:{orderId}` once sold (no TTL)
 *   hold:{holdId}            hold record JSON (same TTL as its seats)
 *   hold-ref:{holdId}        copy of the record WITHOUT TTL, so the sweeper still knows the
 *                            seats of a hold whose keys already expired (RES-5)
 *   holds:by-expiry          sorted set holdId -> expiry in ms, read by the sweeper
 *
 * Every script receives "now" from the caller so they all agree on one clock.
 */

/**
 * RES-2. All-or-nothing hold.
 *
 * KEYS  seat keys, one per requested seat
 * ARGV  [1] holdId [2] ttl seconds [3] hold key [4] record JSON
 *       [5] index key [6] ref key [7] expiresAt ms
 *
 * Returns the seat keys that are already taken (held or sold). Empty list = success.
 */
export const ACQUIRE_HOLD = `
local conflicts = {}
for i = 1, #KEYS do
  if redis.call('EXISTS', KEYS[i]) == 1 then
    conflicts[#conflicts + 1] = KEYS[i]
  end
end
if #conflicts > 0 then
  return conflicts
end
local ttl = tonumber(ARGV[2])
for i = 1, #KEYS do
  redis.call('SET', KEYS[i], ARGV[1], 'EX', ttl)
end
redis.call('SET', ARGV[3], ARGV[4], 'EX', ttl)
redis.call('SET', ARGV[6], ARGV[4])
redis.call('ZADD', ARGV[5], tonumber(ARGV[7]), ARGV[1])
return {}
`;

/**
 * RES-3. The fan releases their own hold.
 *
 * KEYS  [1] hold key, [2..n] seat keys
 * ARGV  [1] holdId [2] userId [3] index key [4] ref key
 *
 * Returns 1 released, 0 gone (expired), -1 another fan's hold, -2 locked by an order.
 * A seat is only deleted while it still holds this holdId, so a seat that somebody else
 * took after this hold expired is never touched.
 */
export const RELEASE_HOLD = `
if redis.call('EXISTS', KEYS[1]) == 0 then
  return 0
end
local record = cjson.decode(redis.call('GET', KEYS[1]))
if record['userId'] ~= ARGV[2] then
  return -1
end
if record['status'] == 'LOCKED' then
  return -2
end
for i = 2, #KEYS do
  if redis.call('GET', KEYS[i]) == ARGV[1] then
    redis.call('DEL', KEYS[i])
  end
end
redis.call('DEL', KEYS[1])
redis.call('DEL', ARGV[4])
redis.call('ZREM', ARGV[3], ARGV[1])
return 1
`;

/**
 * RES-4. LockHold (proto/reservation/v1/reservation.proto): binds the hold to an order and
 * pushes its expiry to max(current expiry, now + min lock time).
 *
 * KEYS  [1] hold key, [2..n] seat keys
 * ARGV  [1] holdId [2] orderId [3] userId [4] now ms [5] min lock ms [6] index key [7] ref key
 *
 * Returns { outcome, record JSON } with outcome one of
 *   OK, ALREADY_LOCKED, NOT_FOUND, EXPIRED, LOCKED, FORBIDDEN.
 */
export const LOCK_HOLD = `
if redis.call('EXISTS', KEYS[1]) == 0 then
  if redis.call('EXISTS', ARGV[7]) == 1 then
    return { 'EXPIRED', '' }
  end
  return { 'NOT_FOUND', '' }
end
local raw = redis.call('GET', KEYS[1])
local record = cjson.decode(raw)
if record['userId'] ~= ARGV[3] then
  return { 'FORBIDDEN', '' }
end
if record['status'] == 'LOCKED' then
  if record['orderId'] == ARGV[2] then
    return { 'ALREADY_LOCKED', raw }
  end
  return { 'LOCKED', '' }
end
for i = 2, #KEYS do
  if redis.call('GET', KEYS[i]) ~= ARGV[1] then
    return { 'EXPIRED', '' }
  end
end
local now = tonumber(ARGV[4])
local expires = tonumber(record['expiresAtMs'])
local wanted = now + tonumber(ARGV[5])
if wanted > expires then
  expires = wanted
end
record['status'] = 'LOCKED'
record['orderId'] = ARGV[2]
record['expiresAtMs'] = expires
local encoded = cjson.encode(record)
local ttl = expires - now
redis.call('SET', KEYS[1], encoded, 'PX', ttl)
for i = 2, #KEYS do
  redis.call('PEXPIRE', KEYS[i], ttl)
end
redis.call('SET', ARGV[7], encoded)
redis.call('ZADD', ARGV[6], expires, ARGV[1])
return { 'OK', encoded }
`;

/**
 * RES-5. Finds holds whose keys already expired and claims them for a seat.released event.
 *
 * ARGV  [1] index key [2] now ms [3] batch size
 *
 * Returns the record JSON of every claimed hold. ZREM is the claim: with several
 * Reservation replicas sweeping at once, only the one whose ZREM returns 1 publishes.
 */
export const SWEEP_EXPIRED = `
local ids = redis.call('ZRANGEBYSCORE', ARGV[1], '-inf', ARGV[2], 'LIMIT', 0, tonumber(ARGV[3]))
local claimed = {}
for _, id in ipairs(ids) do
  if redis.call('EXISTS', 'hold:' .. id) == 0 then
    if redis.call('ZREM', ARGV[1], id) == 1 then
      local ref = redis.call('GET', 'hold-ref:' .. id)
      redis.call('DEL', 'hold-ref:' .. id)
      if ref then
        claimed[#claimed + 1] = ref
      end
    end
  end
end
return claimed
`;

/**
 * RES-7, order.confirmed. The seats become permanently taken: their key changes from the
 * holdId to `sold:{orderId}` without TTL, so no later POST /holds can ever take a sold seat.
 *
 * KEYS  [1] hold key, [2..n] seat keys
 * ARGV  [1] holdId [2] sold marker [3] index key [4] ref key
 *
 * A seat that is now held by somebody else is left alone; that fan's order will hit the
 * sold_seats PRIMARY KEY and be refunded.
 */
export const CONSUME_HOLD = `
local marked = 0
for i = 2, #KEYS do
  local current = redis.call('GET', KEYS[i])
  if (not current) or current == ARGV[1] or current == ARGV[2] then
    redis.call('SET', KEYS[i], ARGV[2])
    marked = marked + 1
  end
end
redis.call('DEL', KEYS[1])
redis.call('DEL', ARGV[4])
redis.call('ZREM', ARGV[3], ARGV[1])
return marked
`;

/**
 * RES-7, order.failed. Gives the seats back right away instead of waiting for the TTL.
 *
 * KEYS  [1] hold key, [2..n] seat keys
 * ARGV  [1] holdId [2] index key [3] ref key
 *
 * Returns 1 when the hold still existed (the caller publishes seat.released), 0 otherwise
 * (it expired, and the sweeper already published it).
 */
export const RELEASE_FOR_ORDER = `
if redis.call('EXISTS', KEYS[1]) == 0 then
  return 0
end
for i = 2, #KEYS do
  if redis.call('GET', KEYS[i]) == ARGV[1] then
    redis.call('DEL', KEYS[i])
  end
end
redis.call('DEL', KEYS[1])
redis.call('DEL', ARGV[3])
redis.call('ZREM', ARGV[2], ARGV[1])
return 1
`;
