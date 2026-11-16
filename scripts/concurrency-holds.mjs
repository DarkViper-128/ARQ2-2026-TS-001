#!/usr/bin/env node
// RES-8. Core invariant under concurrency: N requests for the SAME seat at the same moment,
// and exactly one wins. Everything goes through the API Gateway, like real fans.
//
//   node scripts/concurrency-holds.mjs            # 1000 requests
//   REQUESTS=5000 node scripts/concurrency-holds.mjs
//
// Environment: GATEWAY, KEYCLOAK, EVENT_ID, REQUESTS (default 1000), SEAT (default: a free one).
const GATEWAY = process.env.GATEWAY ?? 'http://localhost:8000';
const KEYCLOAK = process.env.KEYCLOAK ?? 'http://localhost:8080';
const EVENT_ID = process.env.EVENT_ID ?? '3f0c8a52-0000-4000-8000-000000000001';
const REQUESTS = Number(process.env.REQUESTS ?? 1000);

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

async function tokenFor(username) {
  const response = await fetch(`${KEYCLOAK}/realms/flashtix/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'password', client_id: 'flashtix-web', username, password: 'fan12345' }),
  });
  return (await response.json()).access_token;
}

async function admit(token) {
  const auth = { authorization: `Bearer ${token}` };
  const joined = await (await fetch(`${GATEWAY}/v1/events/${EVENT_ID}/queue`, { method: 'POST', headers: auth })).json();
  for (let i = 0; i < 30; i++) {
    const turn = await (await fetch(`${GATEWAY}/v1/events/${EVENT_ID}/queue/${joined.queueTicketId}`, { headers: auth })).json();
    if (turn.status === 'ADMITTED') return turn.admissionToken;
    await sleep(1000);
  }
  throw new Error('never admitted');
}

async function main() {
  const seats = (await (await fetch(`${GATEWAY}/v1/events/${EVENT_ID}/seats`)).json()).seats;
  const seat = process.env.SEAT ?? seats.find((item) => item.status === 'AVAILABLE')?.seatId;
  if (!seat) throw new Error('no free seat left');

  const fans = await Promise.all(
    ['fan1', 'fan2'].map(async (name) => {
      const token = await tokenFor(name);
      return { token, admission: await admit(token) };
    }),
  );

  console.log(`${REQUESTS} concurrent POST /v1/holds for seat ${seat} (2 fans)...`);
  const started = Date.now();
  const results = await Promise.all(
    Array.from({ length: REQUESTS }, (_, i) => {
      const fan = fans[i % fans.length];
      return fetch(`${GATEWAY}/v1/holds`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${fan.token}`,
          'x-admission-token': fan.admission,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ eventId: EVENT_ID, seatIds: [seat] }),
      }).then(async (response) => ({ status: response.status, body: await response.json().catch(() => ({})), fan }));
    }),
  );
  const elapsed = Date.now() - started;

  const byStatus = results.reduce((acc, { status }) => ({ ...acc, [status]: (acc[status] ?? 0) + 1 }), {});
  const winners = results.filter((result) => result.status === 201);
  console.log(`answers in ${elapsed} ms:`, byStatus);

  // Give the seat back so the run can be repeated.
  for (const winner of winners) {
    await fetch(`${GATEWAY}/v1/holds/${winner.body.holdId}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${winner.fan.token}` },
    });
  }

  const ok = winners.length === 1 && byStatus[409] === REQUESTS - 1;
  console.log(ok ? 'PASS  exactly one hold won, every other request got 409' : 'FAIL  the invariant was broken');
  process.exit(ok ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
