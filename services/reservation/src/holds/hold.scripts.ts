/**
 * Lua scripts run by Redis as a single atomic step (RES-2).
 *
 * Atomicity is the whole point: two fans asking for seat A-12-07 in the same millisecond
 * cannot both win, and no row-level lock is held in MySQL while the payment runs
 * (ADR 001).
 */

/**
 * All-or-nothing hold.
 *
 * KEYS  seat keys, one per requested seat
 * ARGV  [1] holdId  [2] ttl in seconds  [3] hold record key  [4] hold record JSON
 *
 * Returns the list of seat keys that are already taken. An empty list means every seat
 * was held. Checking first and writing afterwards is safe because the whole script runs
 * without interruption.
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
return {}
`;

/**
 * Releases a hold and only the seats that still belong to it.
 *
 * KEYS  [1] hold record key, [2..n] seat keys
 * ARGV  [1] holdId  [2] userId
 *
 * Returns 1 released, 0 the hold is gone (expired), -1 it belongs to another fan.
 * The seat value is compared with the holdId so a seat already taken by somebody else
 * after this hold expired is never deleted.
 */
export const RELEASE_HOLD = `
if redis.call('EXISTS', KEYS[1]) == 0 then
  return 0
end
local record = cjson.decode(redis.call('GET', KEYS[1]))
if record['userId'] ~= ARGV[2] then
  return -1
end
for i = 2, #KEYS do
  if redis.call('GET', KEYS[i]) == ARGV[1] then
    redis.call('DEL', KEYS[i])
  end
end
redis.call('DEL', KEYS[1])
return 1
`;
