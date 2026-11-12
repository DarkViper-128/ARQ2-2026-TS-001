#!/usr/bin/env node
// Phase 2 exit criterion (Features 3 and 4): the happy path leaves the order CONFIRMED,
// the failure path gives the seats back, and a double sale triggers the refund.
// Also covers the virtual queue (WR), LockHold (RES-4), the expiry sweeper (RES-5) and
// idempotent checkout (ORD-3).
//
// Every request goes through the API Gateway, except the steps that simulate failures:
// they configure the payment gateway mock and touch the databases directly.
//
//   docker compose up -d --build
//   node scripts/smoke-phase2.mjs
//
// Environment: GATEWAY (default http://localhost:8000), KEYCLOAK (http://localhost:8080),
// MOCK (http://localhost:8090), EVENT_ID.
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const GATEWAY = process.env.GATEWAY ?? 'http://localhost:8000';
const KEYCLOAK = process.env.KEYCLOAK ?? 'http://localhost:8080';
const MOCK = process.env.MOCK ?? 'http://localhost:8090';
const EVENT_ID = process.env.EVENT_ID ?? '3f0c8a52-0000-4000-8000-000000000001';

let passed = 0;
let failed = 0;
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

// Latency tracking for p95 verification (spec: catalog < 50 ms, hold < 100 ms, POST /orders < 300 ms)
const latencies = { catalog: [], hold: [], order: [] };

function categoryFor(path) {
  if (path.includes('/seats')) return 'catalog';
  if (path === '/v1/holds') return 'hold';
  if (path === '/v1/orders') return 'order';
  return null;
}

function p95(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil(sorted.length * 0.95) - 1;
  return sorted[Math.max(0, index)];
}

function check(description, expected, actual) {
  const ok = JSON.stringify(expected) === JSON.stringify(actual);
  if (ok) passed++;
  else failed++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${description.padEnd(60)} ${ok ? JSON.stringify(actual) : `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`}`);
}

async function call(method, path, { token, headers = {}, body, category } = {}) {
  const cat = category ?? categoryFor(path);
  const start = Date.now();
  const response = await fetch(`${GATEWAY}${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const elapsed = Date.now() - start;
  const text = await response.text();
  let json;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }
  if (cat) latencies[cat].push(elapsed);
  return { status: response.status, json, headers: response.headers };
}

async function tokenFor(username, password) {
  const response = await fetch(`${KEYCLOAK}/realms/flashtix/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'password', client_id: 'flashtix-web', username, password }),
  });
  return (await response.json()).access_token;
}

async function mock(config) {
  await fetch(`${MOCK}/_mock/config`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(config),
  });
}

/** Joins the queue and waits for the turn. Returns the admission token. */
async function admit(token) {
  const joined = await call('POST', `/v1/events/${EVENT_ID}/queue`, { token });
  for (let i = 0; i < 30; i++) {
    const turn = await call('GET', `/v1/events/${EVENT_ID}/queue/${joined.json.queueTicketId}`, { token });
    if (turn.json?.status === 'ADMITTED') return turn.json.admissionToken;
    await sleep(1000);
  }
  throw new Error('never admitted');
}

async function seatStatus(seatId) {
  const seats = await call('GET', `/v1/events/${EVENT_ID}/seats`);
  return seats.json.seats.find((seat) => seat.seatId === seatId)?.status;
}

async function waitFor(fn, expected, timeoutMs = 15000) {
  const until = Date.now() + timeoutMs;
  let value;
  while (Date.now() < until) {
    value = await fn();
    if (value === expected) return value;
    await sleep(300);
  }
  return value;
}

async function orderStatus(token, orderId) {
  return (await call('GET', `/v1/orders/${orderId}`, { token })).json?.status;
}

function hold(token, admission, seatIds) {
  return call('POST', '/v1/holds', {
    token,
    headers: admission ? { 'x-admission-token': admission } : {},
    body: { eventId: EVENT_ID, seatIds },
  });
}

function checkout(token, holdId, key = randomUUID(), paymentMethodToken = 'tok_visa_4242') {
  return call('POST', '/v1/orders', {
    token,
    headers: key ? { 'idempotency-key': key } : {},
    body: { holdId, paymentMethodToken },
  });
}

function sql(database, statement) {
  // No host shell (execFile) and the statement goes through stdin, so quotes are safe on
  // Windows and Unix alike. The password is expanded inside the container.
  return execFileSync(
    'docker',
    ['compose', 'exec', '-T', database, 'sh', '-c', 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" -N 2>/dev/null'],
    { encoding: 'utf8', input: statement },
  ).trim();
}

function redis(command) {
  return execFileSync('docker', ['compose', 'exec', '-T', 'hold-store', 'redis-cli', ...command.split(' ')], {
    encoding: 'utf8',
  }).trim();
}

// Seats used by this run; picked among the free ones so the script can run several times.
async function freeSeats(count, section) {
  const seats = (await call('GET', `/v1/events/${EVENT_ID}/seats`)).json.seats;
  const free = seats.filter((seat) => seat.status === 'AVAILABLE' && seat.section === section);
  if (free.length < count) throw new Error(`not enough free seats in section ${section}`);
  return free.slice(0, count).map((seat) => seat.seatId);
}

async function main() {
  const FAN1 = await tokenFor('fan1', 'fan12345');
  const FAN2 = await tokenFor('fan2', 'fan12345');
  // Fast and reliable gateway unless a step asks otherwise.
  await mock({ latencyMinMs: 200, latencyMaxMs: 600, declineRate: 0, errorRate: 0, timeoutRate: 0 });
  const [happySeat, failSeat, conflictSeat, sweepSeat] = await freeSeats(4, 'B');

  console.log('== 1. Virtual queue (WR-2 to WR-5) ==');
  check('POST /queue without a token', 401, (await call('POST', `/v1/events/${EVENT_ID}/queue`)).status);
  const join1 = await call('POST', `/v1/events/${EVENT_ID}/queue`, { token: FAN1 });
  check('POST /queue answers 202', 202, join1.status);
  const join1Again = await call('POST', `/v1/events/${EVENT_ID}/queue`, { token: FAN1 });
  check('joining twice keeps the same ticket', join1.json.queueTicketId, join1Again.json.queueTicketId);
  check(
    "another fan cannot read fan1's ticket",
    404,
    (await call('GET', `/v1/events/${EVENT_ID}/queue/${join1.json.queueTicketId}`, { token: FAN2 })).status,
  );
  check(
    'an unknown event has no queue',
    404,
    (await call('POST', `/v1/events/${randomUUID()}/queue`, { token: FAN1 })).status,
  );
  const ADM1 = await admit(FAN1);
  const ADM2 = await admit(FAN2);
  check('fan1 is admitted with a token', true, typeof ADM1 === 'string' && ADM1.split('.').length === 3);

  console.log('== 2. POST /holds requires the admission token (WR-3) ==');
  check('hold without X-Admission-Token', 403, (await hold(FAN1, undefined, [happySeat])).status);
  check("hold with fan2's admission token", 403, (await hold(FAN1, ADM2, [happySeat])).status);

  console.log('== 3. Happy path: CONFIRMED and SOLD (ORD-3 to ORD-5, PAY-2) ==');
  const happyHold = await hold(FAN1, ADM1, [happySeat]);
  check('hold is created', 201, happyHold.status);
  check('checkout without Idempotency-Key', 400, (await checkout(FAN1, happyHold.json.holdId, '')).status);
  const key = randomUUID();
  const order = await checkout(FAN1, happyHold.json.holdId, key);
  check('checkout answers 202 PENDING', [202, 'PENDING'], [order.status, order.json?.status]);
  const replay = await checkout(FAN1, happyHold.json.holdId, key);
  check('same key: same order, Idempotent-Replayed', [202, order.json?.orderId, 'true'], [
    replay.status,
    replay.json?.orderId,
    replay.headers.get('idempotent-replayed'),
  ]);
  check(
    'same key with another body',
    409,
    (await checkout(FAN1, happyHold.json.holdId, key, 'tok_other')).status,
  );
  check('order ends CONFIRMED', 'CONFIRMED', await waitFor(() => orderStatus(FAN1, order.json.orderId), 'CONFIRMED'));
  check(`${happySeat} is SOLD in the catalog`, 'SOLD', await waitFor(() => seatStatus(happySeat), 'SOLD'));
  check('a sold seat cannot be held again', 409, (await hold(FAN2, ADM2, [happySeat])).status);
  check("fan2 cannot read fan1's order", 404, (await call('GET', `/v1/orders/${order.json.orderId}`, { token: FAN2 })).status);

  console.log('== 4. Failure path: declined card gives the seat back (ORD-6, RES-7) ==');
  await mock({ declineRate: 1 });
  const failHold = await hold(FAN2, ADM2, [failSeat]);
  const failOrder = await checkout(FAN2, failHold.json.holdId);
  check('order ends FAILED', 'FAILED', await waitFor(() => orderStatus(FAN2, failOrder.json.orderId), 'FAILED'));
  check(
    'failureReason is PAYMENT_DECLINED',
    'PAYMENT_DECLINED',
    (await call('GET', `/v1/orders/${failOrder.json.orderId}`, { token: FAN2 })).json.failureReason,
  );
  check(`${failSeat} is AVAILABLE again`, 'AVAILABLE', await waitFor(() => seatStatus(failSeat), 'AVAILABLE'));
  const again = await hold(FAN1, ADM1, [failSeat]);
  check('and can be held by somebody else', 201, again.status);
  await call('DELETE', `/v1/holds/${again.json.holdId}`, { token: FAN1 });

  console.log('== 5. Double sale: the UNIQUE seat triggers the refund (ORD-5, ORD-7, PAY-5) ==');
  await mock({ declineRate: 0, latencyMinMs: 4000, latencyMaxMs: 4000 });
  const conflictHold = await hold(FAN1, ADM1, [conflictSeat]);
  const conflictOrder = await checkout(FAN1, conflictHold.json.holdId);
  check('a locked hold cannot be released', 409, (await call('DELETE', `/v1/holds/${conflictHold.json.holdId}`, { token: FAN1 })).status);
  // While the slow payment runs, the seat gets sold to another order behind the platform's
  // back (what a lost Redis hold would cause). The PRIMARY KEY must catch it.
  const ghost = randomUUID();
  sql(
    'booking-db',
    `INSERT INTO booking.orders (order_id,user_id,user_email,event_id,hold_id,idempotency_key,request_hash,status,total_amount)
     VALUES ('${ghost}','smoke','smoke@flashtix.test','${EVENT_ID}','${ghost}','${ghost}',REPEAT('0',64),'CONFIRMED',1);
     INSERT INTO booking.sold_seats (event_id,seat_id,order_id) VALUES ('${EVENT_ID}','${conflictSeat}','${ghost}');`,
  );
  check(
    'order ends CANCELLED',
    'CANCELLED',
    await waitFor(() => orderStatus(FAN1, conflictOrder.json.orderId), 'CANCELLED', 30000),
  );
  check(
    'failureReason is SEAT_CONFLICT',
    'SEAT_CONFLICT',
    (await call('GET', `/v1/orders/${conflictOrder.json.orderId}`, { token: FAN1 })).json.failureReason,
  );
  check(
    'the charge was refunded in payment-db',
    'REFUNDED',
    sql('payment-db', `SELECT status FROM payment.payments WHERE order_id='${conflictOrder.json.orderId}'`),
  );
  check(
    'the seat is still sold exactly once',
    '1',
    sql('booking-db', `SELECT COUNT(*) FROM booking.sold_seats WHERE event_id='${EVENT_ID}' AND seat_id='${conflictSeat}'`),
  );

  console.log('== 6. An expired hold is swept and published (RES-5) ==');
  await mock({ latencyMinMs: 200, latencyMaxMs: 600 });
  const sweepHold = await hold(FAN2, ADM2, [sweepSeat]);
  check(`${sweepSeat} is HELD`, 'HELD', await waitFor(() => seatStatus(sweepSeat), 'HELD'));
  // Simulate the TTL running out instead of waiting 10 minutes.
  redis(`DEL hold:${sweepHold.json.holdId} seat:${EVENT_ID}:${sweepSeat}`);
  redis(`ZADD holds:by-expiry 0 ${sweepHold.json.holdId}`);
  check(`${sweepSeat} is AVAILABLE after the sweep`, 'AVAILABLE', await waitFor(() => seatStatus(sweepSeat), 'AVAILABLE', 20000));

  // Back to the realistic defaults of .env.example.
  await mock({ latencyMinMs: 200, latencyMaxMs: 15000, declineRate: 0.05, errorRate: 0.05, timeoutRate: 0.02 });

  console.log('\n== P95 Latency ==');
  const p95Catalog = p95(latencies.catalog);
  const p95Hold = p95(latencies.hold);
  const p95Order = p95(latencies.order);
  const catalogOk = p95Catalog === 0 || p95Catalog < 50;
  const holdOk = p95Hold === 0 || p95Hold < 100;
  const orderOk = p95Order === 0 || p95Order < 300;
  const p95Passed = catalogOk && holdOk && orderOk;
  if (!p95Passed) failed++;
  else passed++;
  console.log(`  catalog p95: ${p95Catalog}ms (target < 50ms) ${catalogOk ? 'PASS' : 'FAIL'}`);
  console.log(`  hold p95:    ${p95Hold}ms (target < 100ms) ${holdOk ? 'PASS' : 'FAIL'}`);
  console.log(`  POST /orders p95: ${p95Order}ms (target < 300ms) ${orderOk ? 'PASS' : 'FAIL'}`);

  console.log(`\npassed: ${passed}   failed: ${failed}`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
