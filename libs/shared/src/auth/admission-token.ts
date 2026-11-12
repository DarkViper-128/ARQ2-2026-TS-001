import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Admission token of the virtual queue (WR-3, spec.md section 4).
 *
 * The Waiting Room Service signs it when a fan's turn arrives and the Reservation Service
 * checks it on `POST /holds`. Both share `ADMISSION_TOKEN_SECRET`, so the check is a local
 * HMAC verification with no network call and no shared state: Reservation never has to ask
 * the Waiting Room "is this fan admitted?".
 *
 * Format: a compact JWT signed with HS256, so it can be inspected with any JWT tool.
 */
export interface AdmissionClaims {
  /** Fan (Keycloak `sub`). A token is useless for anybody else. */
  sub: string;
  /** Event the fan queued for. A token is useless for any other event. */
  eventId: string;
  /** Queue ticket that produced the token. */
  queueTicketId: string;
  /** Issued at, seconds since epoch. */
  iat: number;
  /** Expiry, seconds since epoch. */
  exp: number;
}

export type AdmissionCheck =
  | { valid: true; claims: AdmissionClaims }
  | { valid: false; reason: 'malformed' | 'bad-signature' | 'expired' | 'wrong-event' | 'wrong-user' };

const HEADER = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');

function sign(input: string, secret: string): string {
  return createHmac('sha256', secret).update(input).digest('base64url');
}

export function signAdmissionToken(claims: AdmissionClaims, secret: string): string {
  if (!secret) throw new Error('ADMISSION_TOKEN_SECRET is not set');
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const input = `${HEADER}.${payload}`;
  return `${input}.${sign(input, secret)}`;
}

/**
 * Verifies signature, expiry, event and user. Never throws: the caller turns a failure into
 * `403 INVALID_ADMISSION_TOKEN`.
 */
export function verifyAdmissionToken(
  token: string | undefined,
  secret: string,
  expected: { eventId: string; userId: string; nowSeconds?: number },
): AdmissionCheck {
  if (!token || !secret) return { valid: false, reason: 'malformed' };
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== HEADER) return { valid: false, reason: 'malformed' };

  const expectedSignature = Buffer.from(sign(`${parts[0]}.${parts[1]}`, secret));
  const actualSignature = Buffer.from(parts[2]!);
  if (
    expectedSignature.length !== actualSignature.length ||
    !timingSafeEqual(expectedSignature, actualSignature)
  ) {
    return { valid: false, reason: 'bad-signature' };
  }

  let claims: AdmissionClaims;
  try {
    claims = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8')) as AdmissionClaims;
  } catch {
    return { valid: false, reason: 'malformed' };
  }

  const now = expected.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (typeof claims.exp !== 'number' || claims.exp <= now) return { valid: false, reason: 'expired' };
  if (claims.eventId !== expected.eventId) return { valid: false, reason: 'wrong-event' };
  if (claims.sub !== expected.userId) return { valid: false, reason: 'wrong-user' };
  return { valid: true, claims };
}
