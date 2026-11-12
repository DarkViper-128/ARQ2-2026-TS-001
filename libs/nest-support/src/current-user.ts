import { AppError } from '@flashtix/shared';
import type { Request } from 'express';

/**
 * Identifies the fan making the request.
 *
 * The API Gateway is the single entry point and has already validated the JWT signature,
 * so this only needs to read the subject. It prefers `X-User-Id` (which GW-4 will make the
 * gateway set in Phase 3) and otherwise decodes the `sub` claim of the bearer token.
 *
 * It deliberately does NOT verify the signature: doing that here would duplicate the
 * gateway and tempt someone to expose this service directly.
 */
export function currentUserId(request: Request): string {
  const header = request.headers['x-user-id'];
  const fromGateway = Array.isArray(header) ? header[0] : header;
  if (fromGateway && fromGateway.trim().length > 0) return fromGateway.trim();

  const authorization = request.headers.authorization ?? '';
  const [scheme, token] = authorization.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) {
    throw new AppError('UNAUTHENTICATED', 'Missing bearer token');
  }

  const payload = token.split('.')[1];
  if (!payload) throw new AppError('UNAUTHENTICATED', 'Malformed bearer token');

  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      sub?: string;
    };
    if (!claims.sub) throw new Error('no sub');
    return claims.sub;
  } catch {
    throw new AppError('UNAUTHENTICATED', 'Bearer token has no subject');
  }
}

/**
 * Email of the fan, taken from the `email` claim of the token the gateway already validated.
 * The Order Service needs it because order.confirmed, order.failed and order.cancelled carry
 * `userEmail` (spec.md section 5). Prefers `X-User-Email` once the gateway sets it (GW-4).
 */
export function currentUserEmail(request: Request): string {
  const header = request.headers['x-user-email'];
  const fromGateway = Array.isArray(header) ? header[0] : header;
  if (fromGateway && fromGateway.trim().length > 0) return fromGateway.trim();

  const token = (request.headers.authorization ?? '').split(' ')[1] ?? '';
  try {
    const claims = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8')) as {
      email?: string;
    };
    if (claims.email) return claims.email;
  } catch {
    // fall through
  }
  throw new AppError('UNAUTHENTICATED', 'The access token has no email claim');
}
