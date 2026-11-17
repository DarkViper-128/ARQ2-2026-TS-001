#!/usr/bin/env node
// Phase 3 exit criterion (feature F5 and the organizer console): a confirmed order produces
// one PDF + QR ticket per seat and exactly one email, a duplicate event changes nothing,
// failed and refunded orders are emailed, the organizer endpoints work, and the gateway
// enforces the ORGANIZER role (GW-3) and forwards the caller (GW-4).
//
//   docker compose up -d --build
//   node scripts/smoke-phase3.mjs
//
// Every request goes through the API Gateway. Emails are read from Mailpit's API, tickets
// from ticket-db, and the duplicate-delivery check publishes straight to RabbitMQ.
//
// Environment: GATEWAY (default http://localhost:8000), KEYCLOAK (http://localhost:8080),
// MOCK (http://localhost:8090), MAILPIT (http://localhost:8025), RABBITMQ_URL (read from
// .env when not set), EVENT_ID.
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const GATEWAY = process.env.GATEWAY ?? 'http://localhost:8000';
const KEYCLOAK = process.env.KEYCLOAK ?? 'http://localhost:8080';
const MOCK = process.env.MOCK ?? 'http://localhost:8090';
const MAILPIT = process.env.MAILPIT ?? 'http://localhost:8025';
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
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${description.padEnd(62)} ${ok ? JSON.stringify(actual) : `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`}`);
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
  const text = await response.text();
  let json;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }
  const elapsed = Date.now() - start;
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

const subOf = (token) => JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')).sub;

async function mock(config) {
  await fetch(`${MOCK}/_mock/config`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(config),
  });
}

async function waitFor(fn, expected, timeoutMs = 20000) {
  const until = Date.now() + timeoutMs;
  let value;
  while (Date.now() < until) {
    value = await fn();
    if (JSON.stringify(value) === JSON.stringify(expected)) return value;
    await sleep(400);
  }
  return value;
}

async function admit(token) {
  const joined = await call('POST', `/v1/events/${EVENT_ID}/queue`, { token });
  for (let i = 0; i < 30; i++) {
    const turn = await call('GET', `/v1/events/${EVENT_ID}/queue/${joined.json.queueTicketId}`, { token });
    if (turn.json?.status === 'ADMITTED') return turn.json.admissionToken;
    await sleep(1000);
  }
  throw new Error('never admitted');
}

const hold = (token, admission, seatIds) =>
  call('POST', '/v1/holds', { token, headers: { 'x-admission-token': admission }, body: { eventId: EVENT_ID, seatIds } });

const checkout = (token, holdId) =>
  call('POST', '/v1/orders', {
    token,
    headers: { 'idempotency-key': randomUUID() },
    body: { holdId, paymentMethodToken: 'tok_visa_4242' },
  });

const orderStatus = async (token, orderId) => (await call('GET', `/v1/orders/${orderId}`, { token })).json?.status;

function sql(database, statement) {
  return execFileSync(
    'docker',
    ['compose', 'exec', '-T', database, 'sh', '-c', 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" -N 2>/dev/null'],
    { encoding: 'utf8', input: statement },
  ).trim();
}

async function freeSeats(count, section) {
  const seats = (await call('GET', `/v1/events/${EVENT_ID}/seats`)).json.seats;
  const free = seats.filter((seat) => seat.status === 'AVAILABLE' && seat.section === section);
  if (free.length < count) throw new Error(`not enough free seats in section ${section}`);
  return free.slice(0, count).map((seat) => seat.seatId);
}

/** Emails that mention the order id, from Mailpit's search API. */
async function emailsAbout(orderId) {
  const response = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(orderId)}`);
  const { messages = [] } = await response.json();
  return messages.map((message) => ({
    to: message.To?.[0]?.Address,
    subject: message.Subject,
    attachments: message.Attachments,
  }));
}

/** Publishes an event to RabbitMQ the way the Order Service would, to simulate a redelivery. */
async function publishOrderConfirmed(data) {
  const require = createRequire(import.meta.url);
  const amqp = require('amqplib');
  let url = process.env.RABBITMQ_URL;
  if (!url) {
    const env = Object.fromEntries(
      readFileSync(new URL('../.env', import.meta.url), 'utf8')
        .split(/\r?\n/)
        .filter((line) => line.includes('=') && !line.startsWith('#'))
        .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]),
    );
    url = `amqp://${env.RABBITMQ_USER}:${env.RABBITMQ_PASSWORD}@localhost:5672`;
  }
  const connection = await amqp.connect(url);
  const channel = await connection.createConfirmChannel();
  const envelope = {
    eventId: randomUUID(),
    eventType: 'order.confirmed',
    eventVersion: 1,
    occurredAt: new Date().toISOString(),
    producer: 'order-service',
    correlationId: randomUUID(),
    aggregateId: data.orderId,
    aggregateVersion: 1,
    data,
  };
  await new Promise((resolve, reject) =>
    channel.publish('order', 'order.confirmed', Buffer.from(JSON.stringify(envelope)), { persistent: true }, (error) =>
      error ? reject(error) : resolve(),
    ),
  );
  await channel.close();
  await connection.close();
}

function newEventBody(name) {
  const startsAt = new Date(Date.now() + 90 * 24 * 3600 * 1000).toISOString();
  // The sale opens a few seconds from now, so the scheduler is exercised too.
  const saleStartsAt = new Date(Date.now() + 4000).toISOString();
  return {
    name,
    artist: 'Smoke Test Band',
    venue: { name: 'Smoke Arena', city: 'Medellin' },
    startsAt,
    saleStartsAt,
    priceCategories: [{ category: 'VIP', price: { amount: 45000000, currency: 'COP' } }],
    seats: [
      { seatId: 'A-01-01', category: 'VIP' },
      { seatId: 'A-01-02', category: 'VIP' },
    ],
  };
}

async function main() {
  const FAN1 = await tokenFor('fan1', 'fan12345');
  const FAN2 = await tokenFor('fan2', 'fan12345');
  const ORG = await tokenFor('organizer1', 'organizer12345');
  await mock({ latencyMinMs: 200, latencyMaxMs: 600, declineRate: 0, errorRate: 0, timeoutRate: 0 });

  console.log('== 1. The gateway enforces roles (GW-3) ==');
  const eventName = `Smoke ${randomUUID().slice(0, 8)}`;
  const body = newEventBody(eventName);
  check('POST /admin/events without a token', 401, (await call('POST', '/v1/admin/events', { body })).status);
  const asFan = await call('POST', '/v1/admin/events', { token: FAN1, body });
  check('a FAN cannot create events', [403, 'FORBIDDEN'], [asFan.status, asFan.json?.code]);
  check('a FAN cannot publish', 403, (await call('POST', `/v1/admin/events/${randomUUID()}/publish`, { token: FAN1 })).status);
  check(
    'a FAN cannot refund',
    403,
    (await call('POST', `/v1/admin/orders/${randomUUID()}/refund`, { token: FAN1, body: { reason: 'EVENT_CANCELLED' } })).status,
  );

  console.log('== 2. Organizer console: create, publish, open the sale (ADM-1, ADM-2) ==');
  check(
    'an invalid body is a 400 VALIDATION_ERROR',
    [400, 'VALIDATION_ERROR'],
    await call('POST', '/v1/admin/events', { token: ORG, body: { ...body, seats: [] } }).then((r) => [r.status, r.json?.code]),
  );
  const created = await call('POST', '/v1/admin/events', { token: ORG, body });
  check('an ORGANIZER creates the event as DRAFT', [201, 'DRAFT'], [created.status, created.json?.status]);
  const newEventId = created.json?.eventId;
  check('Location points to the event', `/v1/events/${newEventId}`, created.headers.get('location'));
  check(
    'the same event twice is 409 EVENT_ALREADY_EXISTS',
    [409, 'EVENT_ALREADY_EXISTS'],
    await call('POST', '/v1/admin/events', { token: ORG, body }).then((r) => [r.status, r.json?.code]),
  );
  check('a DRAFT event is not public', 404, (await call('GET', `/v1/events/${newEventId}`)).status);
  check('its seat map is not public either', 404, (await call('GET', `/v1/events/${newEventId}/seats`)).status);
  check('publishing an unknown event', 404, (await call('POST', `/v1/admin/events/${randomUUID()}/publish`, { token: ORG })).status);
  const published = await call('POST', `/v1/admin/events/${newEventId}/publish`, { token: ORG });
  check('publish answers 200 PUBLISHED', [200, 'PUBLISHED'], [published.status, published.json?.status]);
  check(
    'publishing twice is 409 INVALID_EVENT_STATUS',
    [409, 'INVALID_EVENT_STATUS'],
    await call('POST', `/v1/admin/events/${newEventId}/publish`, { token: ORG }).then((r) => [r.status, r.json?.code]),
  );
  check('the published event is public', 200, (await call('GET', `/v1/events/${newEventId}`)).status);
  check(
    'the sale opens at saleStartsAt (ON_SALE)',
    'ON_SALE',
    await waitFor(async () => (await call('GET', `/v1/events/${newEventId}`)).json?.status, 'ON_SALE', 20000),
  );

  console.log('== 3. One ticket per seat and one email (F5: TKT-2 to TKT-4, NOT-2) ==');
  const [seatA, seatB, seatC] = await freeSeats(3, 'B');
  const ADM1 = await admit(FAN1);
  const ADM2 = await admit(FAN2);
  const happyHold = await hold(FAN1, ADM1, [seatA, seatB]);
  check('a hold of two seats is created', 201, happyHold.status);
  const order = await checkout(FAN1, happyHold.json.holdId);
  const orderId = order.json?.orderId;
  check('order ends CONFIRMED', 'CONFIRMED', await waitFor(() => orderStatus(FAN1, orderId), 'CONFIRMED'));
  const ticketIds = async () =>
    sql('ticket-db', `SELECT ticket_id FROM ticket.tickets WHERE order_id='${orderId}' ORDER BY seat_id`)
      .split('\n')
      .filter(Boolean);
  check('two tickets are issued', 2, (await waitFor(async () => (await ticketIds()).length, 2)));
  const [ticketId] = await ticketIds();

  const ticket = await call('GET', `/v1/tickets/${ticketId}`, { token: FAN1 });
  check('the holder reads the ticket', [200, ticketId, orderId], [ticket.status, ticket.json?.ticketId, ticket.json?.orderId]);
  check('qrPayload is FTX1.<ticketId>.<signature>', true, ticket.json?.qrPayload?.startsWith(`FTX1.${ticketId}.`));
  check('downloadUrl expires in 900 s', true, ticket.json?.downloadUrl?.includes('X-Amz-Expires=900'));
  const pdf = await fetch(ticket.json.downloadUrl);
  const pdfBytes = Buffer.from(await pdf.arrayBuffer());
  check('the signed link serves a PDF', [200, '%PDF-'], [pdf.status, pdfBytes.subarray(0, 5).toString()]);
  check("another fan cannot read the ticket", 404, (await call('GET', `/v1/tickets/${ticketId}`, { token: FAN2 })).status);
  check('no token is rejected by the gateway', 401, (await call('GET', `/v1/tickets/${ticketId}`)).status);
  check('an unknown ticket', [404, 'TICKET_NOT_FOUND'], await call('GET', `/v1/tickets/${randomUUID()}`, { token: FAN1 }).then((r) => [r.status, r.json?.code]));

  const mails = await waitFor(async () => (await emailsAbout(orderId)).length, 1, 25000);
  check('the fan receives exactly one email', 1, mails);
  const [mail] = await emailsAbout(orderId);
  check('addressed to fan1 with both PDFs attached', ['fan1@flashtix.test', 2], [mail?.to, mail?.attachments]);

  console.log('== 4. A duplicate event creates nothing (F5 "Duplicate event") ==');
  const detail = (await call('GET', `/v1/orders/${orderId}`, { token: FAN1 })).json;
  await publishOrderConfirmed({
    orderId,
    userId: subOf(FAN1),
    userEmail: 'fan1@flashtix.test',
    eventId: EVENT_ID,
    holdId: detail.holdId,
    seats: detail.seats.map((seat) => ({ seatId: seat.seatId, category: seat.category })),
  });
  await sleep(6000);
  check('still two tickets', 2, (await ticketIds()).length);
  check('still one email', 1, (await emailsAbout(orderId)).length);

  console.log('== 5. A failed order is emailed (NOT-3) ==');
  await mock({ declineRate: 1 });
  const failHold = await hold(FAN2, ADM2, [seatC]);
  const failOrder = await checkout(FAN2, failHold.json.holdId);
  check('order ends FAILED', 'FAILED', await waitFor(() => orderStatus(FAN2, failOrder.json.orderId), 'FAILED'));
  check('fan2 receives one email', 1, await waitFor(async () => (await emailsAbout(failOrder.json.orderId)).length, 1, 25000));
  const [failMail] = await emailsAbout(failOrder.json.orderId);
  check('it says the purchase could not be completed', ['fan2@flashtix.test', true], [
    failMail?.to,
    /could not complete/i.test(failMail?.subject ?? ''),
  ]);
  await mock({ declineRate: 0 });

  console.log('== 6. Organizer refund (ADM-3) ==');
  check('fan2 cannot read the order of fan1', 404, (await call('GET', `/v1/orders/${orderId}`, { token: FAN2 })).status);
  check('an ORGANIZER can read any order', 200, (await call('GET', `/v1/orders/${orderId}`, { token: ORG })).status);
  check(
    'refund with an unknown reason',
    [400, 'VALIDATION_ERROR'],
    await call('POST', `/v1/admin/orders/${orderId}/refund`, { token: ORG, body: { reason: 'BECAUSE' } }).then((r) => [r.status, r.json?.code]),
  );
  check(
    'a FAILED order cannot be refunded',
    [409, 'INVALID_ORDER_STATUS'],
    await call('POST', `/v1/admin/orders/${failOrder.json.orderId}/refund`, { token: ORG, body: { reason: 'EVENT_CANCELLED' } }).then((r) => [r.status, r.json?.code]),
  );
  check('an unknown order', 404, (await call('POST', `/v1/admin/orders/${randomUUID()}/refund`, { token: ORG, body: { reason: 'EVENT_CANCELLED' } })).status);
  const refund = await call('POST', `/v1/admin/orders/${orderId}/refund`, { token: ORG, body: { reason: 'EVENT_CANCELLED' } });
  check('refund answers 202 REFUND_PENDING', [202, 'REFUND_PENDING'], [refund.status, refund.json?.status]);
  check('asking again is a 409, never a second refund', 409, (await call('POST', `/v1/admin/orders/${orderId}/refund`, { token: ORG, body: { reason: 'EVENT_CANCELLED' } })).status);
  check('the order ends CANCELLED', 'CANCELLED', await waitFor(() => orderStatus(FAN1, orderId), 'CANCELLED'));
  check('the card was refunded in payment-db', 'REFUNDED', sql('payment-db', `SELECT status FROM payment.payments WHERE order_id='${orderId}'`));
  check('fan1 receives the cancellation email too', 2, await waitFor(async () => (await emailsAbout(orderId)).length, 2, 25000));
  check(
    'the second email is the refund notice',
    true,
    (await emailsAbout(orderId)).some((m) => /cancelled and refunded/i.test(m.subject ?? '')),
  );

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
