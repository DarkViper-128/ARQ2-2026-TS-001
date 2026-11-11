import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

/** Header carried by every HTTP request and copied into every event envelope (spec.md section 2). */
export const CORRELATION_ID_HEADER = 'x-correlation-id';

interface CorrelationStore {
  correlationId: string;
}

const storage = new AsyncLocalStorage<CorrelationStore>();

/** Runs `fn` so that every async operation inside it can read this correlation id. */
export function runWithCorrelationId<T>(correlationId: string, fn: () => T): T {
  return storage.run({ correlationId }, fn);
}

/** Correlation id of the request or message being handled, if any. */
export function getCorrelationId(): string | undefined {
  return storage.getStore()?.correlationId;
}

/** Returns the first usable correlation id, or a new one. Never throws. */
export function ensureCorrelationId(candidate?: string | string[] | null): string {
  const value = Array.isArray(candidate) ? candidate[0] : candidate;
  return value && value.trim().length > 0 ? value.trim() : randomUUID();
}

export interface MinimalRequest {
  headers: Record<string, string | string[] | undefined>;
}

export interface MinimalResponse {
  setHeader(name: string, value: string): unknown;
}

/**
 * Framework-agnostic middleware (works with Express and NestJS).
 * Takes the incoming correlation id or creates one, echoes it back and makes it
 * available to the whole request through `getCorrelationId()`.
 */
export function correlationIdMiddleware() {
  return (req: MinimalRequest, res: MinimalResponse, next: () => void): void => {
    const correlationId = ensureCorrelationId(req.headers[CORRELATION_ID_HEADER]);
    req.headers[CORRELATION_ID_HEADER] = correlationId;
    res.setHeader(CORRELATION_ID_HEADER, correlationId);
    runWithCorrelationId(correlationId, next);
  };
}
