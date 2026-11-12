// Run with: npm test -w @flashtix/shared  (needs `npm run build -w @flashtix/shared` first)
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';

const { signTicketQr, verifyTicketQr } = createRequire(import.meta.url)('../dist/index.js');

const SECRET = 'test-secret';
const subject = {
  ticketId: '1a2b3c4d-0000-4000-8000-000000000001',
  eventId: '3f0c8a52-0000-4000-8000-000000000001',
  seatId: 'A-12-07',
};

test('a signed QR verifies for its own event and seat', () => {
  const qr = signTicketQr(subject, SECRET);
  assert.match(qr, /^FTX1\.[0-9a-f-]{36}\.[A-Za-z0-9_-]+$/);
  assert.deepEqual(verifyTicketQr(qr, SECRET, subject), { valid: true, ticketId: subject.ticketId });
});

test('a QR does not verify for another seat or event', () => {
  const qr = signTicketQr(subject, SECRET);
  assert.equal(verifyTicketQr(qr, SECRET, { ...subject, seatId: 'A-12-08' }).valid, false);
  assert.equal(verifyTicketQr(qr, SECRET, { ...subject, eventId: 'other' }).valid, false);
});

test('a QR signed with another secret or with a forged id is rejected', () => {
  const qr = signTicketQr(subject, SECRET);
  assert.equal(verifyTicketQr(qr, 'other-secret', subject).valid, false);
  const forged = qr.replace(subject.ticketId, '9z9z9z9z-0000-4000-8000-000000000009');
  assert.deepEqual(verifyTicketQr(forged, SECRET, subject), { valid: false, reason: 'bad-signature' });
});

test('malformed payloads never throw', () => {
  for (const bad of [undefined, '', 'FTX1', 'FTX2.a.b', 'FTX1..sig', 'FTX1.a.b.c']) {
    assert.equal(verifyTicketQr(bad, SECRET, subject).valid, false);
  }
});
