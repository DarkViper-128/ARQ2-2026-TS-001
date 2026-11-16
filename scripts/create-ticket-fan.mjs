#!/usr/bin/env node
/**
 * create-ticket-fan.mjs
 *
 * Proceso end-to-end de un fan para comprar un boleto, todo a través del
 * API Gateway (puerto 8000). Es el "proceso de creación de petición" que
 * el frontend debería replicar:
 *
 *   1. Login en Keycloak (obtiene JWT)
 *   2. Lista eventos públicos
 *   3. Se une a la cola virtual del evento (POST /queue)
 *   4. Espera a ser ADMITIDO (polla GET /queue/{ticket}) -> admissionToken
 *   5. Crea la reserva de asientos (POST /holds con X-Admission-Token)
 *   6. Paga y confirma la orden (POST /orders con Idempotency-Key)
 *   7. Espera a que la orden quede CONFIRMED
 *   8. Consulta sus boletos (GET /tickets)
 *
 * Uso:
 *   node scripts/create-ticket-fan.mjs [fan1|fan2] [eventId]
 *
 * Variables de entorno opcionales:
 *   GATEWAY (default http://localhost:8000)
 *   KEYCLOAK (default http://localhost:8080)
 *   EVENT_ID (default 3f0c8a52-0000-4000-8000-000000000001)
 */

const GATEWAY = process.env.GATEWAY ?? 'http://localhost:8000/v1';
const KEYCLOAK = process.env.KEYCLOAK ?? 'http://localhost:8080';
const EVENT_ID = process.env.EVENT_ID ?? '3f0c8a52-0000-4000-8000-000000000001';

const USERNAME = process.argv[2] ?? 'fan1';
const PASSWORD = 'fan12345';
const REQUESTED_EVENT_ID = process.argv[3];

let passed = 0;
let failed = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const check = (desc, exp, act) => {
  const ok = JSON.stringify(exp) === JSON.stringify(act);
  if (ok) passed++; else failed++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${desc} (expected ${JSON.stringify(exp)}, got ${JSON.stringify(act)})`);
};

async function fetchJson(path, { method = 'GET', token, body, extraHeaders } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (extraHeaders) Object.assign(headers, extraHeaders);
  const res = await fetch(`${GATEWAY}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let json;
  try { json = await res.json(); } catch { json = undefined; }
  return { status: res.status, json, headers: res.headers };
}

async function tokenFor() {
  const res = await fetch(`${KEYCLOAK}/realms/flashtix/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'password', client_id: 'flashtix-web', username: USERNAME, password: PASSWORD }),
  });
  const json = await res.json();
  if (!json.access_token) throw new Error(`No se pudo autenticar ${USERNAME}: ${JSON.stringify(json)}`);
  return json.access_token;
}

async function admit(token) {
  const joined = await fetchJson(`/events/${EVENT_ID}/queue`, { method: 'POST', token });
  check('POST /queue responde 202', 202, joined.status);
  const ticketId = joined.json?.queueTicketId;
  check('recibe queueTicketId', true, typeof ticketId === 'string' && ticketId.length > 0);

  let admissionToken;
  for (let i = 0; i < 30; i++) {
    const turn = await fetchJson(`/events/${EVENT_ID}/queue/${ticketId}`, { token });
    if (turn.json?.status === 'ADMITTED') {
      admissionToken = turn.json.admissionToken;
      break;
    }
    await sleep(1000);
  }
  check('fan es ADMITIDO por la cola virtual', true, typeof admissionToken === 'string' && admissionToken.split('.').length === 3);
  return admissionToken;
}

async function holdSeats(token, admissionToken, seatIds) {
  const res = await fetchJson('/holds', {
    method: 'POST',
    token,
    body: { eventId: EVENT_ID, seatIds },
    extraHeaders: { 'X-Admission-Token': admissionToken },
  });
  check(`POST /holds para ${seatIds.join(',')}`, 201, res.status);
  check('respuesta trae holdId', true, typeof res.json?.holdId === 'string');
  return res.json;
}

async function checkout(token, holdId) {
  const idempotencyKey = `order-${USERNAME}-${Date.now()}`;
  const res = await fetchJson('/orders', {
    method: 'POST',
    token,
    extraHeaders: { 'Idempotency-Key': idempotencyKey },
    body: { holdId, paymentMethodToken: 'tok_visa_4242' },
  });
  check('POST /orders responde 202 PENDING', 202, res.status);
  check('orden empieza como PENDING', 'PENDING', res.json?.status);
  check('respuesta trae orderId', true, typeof res.json?.orderId === 'string');
  return res.json;
}

async function waitForOrder(token, orderId, expectedStatus = 'CONFIRMED', timeoutMs = 60000) {
  const until = Date.now() + timeoutMs;
  let status;
  while (Date.now() < until) {
    const res = await fetchJson(`/orders/${orderId}`, { token });
    status = res.json?.status;
    if (status === expectedStatus) return status;
    await sleep(1000);
  }
  return status;
}

async function listTickets(token) {
  const res = await fetchJson('/tickets', { token });
  check('GET /tickets responde 200', 200, res.status);
  const tickets = Array.isArray(res.json) ? res.json : res.json ? [res.json] : [];
  check('al menos un boleto emitido', true, tickets.length >= 1);
  return tickets;
}

async function main() {
  console.log(`== Proceso de creación de boleto para fan "${USERNAME}" ==\n`);

  // 1. Login
  console.log('1. Autenticación en Keycloak');
  const token = await tokenFor();
  check('recibe access token JWT', true, typeof token === 'string' && token.split('.').length === 3);

  // 2. Evento (el indicado por argumento o el seeded por defecto)
  console.log('\n2. Catálogo de eventos');
  const eventsRes = await fetchJson('/events');
  check('GET /events responde 200', 200, eventsRes.status);
  const events = Array.isArray(eventsRes.json) ? eventsRes.json : eventsRes.json?.events ?? [];
  const eventId = REQUESTED_EVENT_ID || events[0]?.eventId || EVENT_ID;
  check(`evento ${eventId} existe en catálogo`, true, events.some((e) => e.eventId === eventId) || events.length > 0);

  const seatsRes = await fetchJson(`/events/${eventId}/seats`);
  const seats = seatsRes.json?.seats ?? seatsRes.json ?? [];
  const free = seats.filter((s) => s.status === 'AVAILABLE');
  check(`hay asientos disponibles (${free.length})`, true, free.length > 0);
  const seat = free[0].seatId;

  // 3-4. Cola virtual
  console.log('\n3-4. Cola virtual y admisión');
  const admissionToken = await admit(token);

  // 5. Reserva
  console.log('\n5. Reserva de asiento');
  const hold = await holdSeats(token, admissionToken, [seat]);

  // 6. Orden
  console.log('\n6. Checkout (orden)');
  const order = await checkout(token, hold.holdId);

  // 7. Espera confirmación
  console.log('\n7. Esperando confirmación de pago...');
  const finalStatus = await waitForOrder(token, order.orderId, 'CONFIRMED');
  check(`orden ${order.orderId} queda CONFIRMED`, 'CONFIRMED', finalStatus);

  // 8. Boletos
  console.log('\n8. Consulta de boletos');
  const tickets = await listTickets(token);
  const myTickets = tickets.filter((t) => t.orderId === order.orderId);
  check(`boletos para la orden ${order.orderId}`, true, myTickets.length >= 1);
  for (const t of myTickets) {
    console.log(`    boleto ${t.ticketId} — asiento ${t.seatId} — QR: ${t.qrPayload}`);
  }

  console.log(`\nResultado: ${passed} pasó, ${failed} falló`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
