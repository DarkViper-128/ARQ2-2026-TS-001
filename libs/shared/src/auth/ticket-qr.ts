import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * QR payload of a ticket (spec.md section 3: `qrPayload`, HMAC signed).
 *
 * Format: `FTX1.<ticketId>.<signature>`, where the signature is an HMAC-SHA256 over the
 * ticket id, the event and the seat. A gate scanner reads the ticket id from the QR, loads
 * the ticket and calls `verifyTicketQr` with the event and seat it has on record, so a QR
 * copied onto another seat, or one whose row was edited, no longer validates.
 *
 * It is NOT a bearer credential on its own: the ticket id is a random UUID and the secret
 * (`TICKET_QR_SECRET`) never leaves the Ticket Service and the gate backend.
 */
export const TICKET_QR_PREFIX = 'FTX1';

export interface TicketQrSubject {
  ticketId: string;
  eventId: string;
  seatId: string;
}

export type TicketQrCheck =
  | { valid: true; ticketId: string }
  | { valid: false; reason: 'malformed' | 'bad-signature' };

function signature(subject: TicketQrSubject, secret: string): string {
  return createHmac('sha256', secret)
    .update(`${TICKET_QR_PREFIX}.${subject.ticketId}.${subject.eventId}.${subject.seatId}`)
    .digest('base64url');
}

export function signTicketQr(subject: TicketQrSubject, secret: string): string {
  if (!secret) throw new Error('TICKET_QR_SECRET is not set');
  return `${TICKET_QR_PREFIX}.${subject.ticketId}.${signature(subject, secret)}`;
}

/** Never throws: a scanner turns `valid: false` into "reject the ticket". */
export function verifyTicketQr(
  payload: string | undefined,
  secret: string,
  expected: { eventId: string; seatId: string },
): TicketQrCheck {
  if (!payload || !secret) return { valid: false, reason: 'malformed' };
  const parts = payload.split('.');
  if (parts.length !== 3 || parts[0] !== TICKET_QR_PREFIX || !parts[1] || !parts[2]) {
    return { valid: false, reason: 'malformed' };
  }

  const expectedSignature = Buffer.from(signature({ eventId: expected.eventId, seatId: expected.seatId, ticketId: parts[1] }, secret));
  const actualSignature = Buffer.from(parts[2]);
  if (
    expectedSignature.length !== actualSignature.length ||
    !timingSafeEqual(expectedSignature, actualSignature)
  ) {
    return { valid: false, reason: 'bad-signature' };
  }
  return { valid: true, ticketId: parts[1] };
}
