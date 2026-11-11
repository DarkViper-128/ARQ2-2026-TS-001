import { getCorrelationId } from '../context/correlation';

/** Content type required by spec.md section 2 for every error response. */
export const PROBLEM_CONTENT_TYPE = 'application/problem+json';

/** Error codes defined in docs/spec.md. Services must not invent codes outside this list. */
export const ERROR_CODES = {
  VALIDATION_ERROR: 400,
  MISSING_IDEMPOTENCY_KEY: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  INVALID_ADMISSION_TOKEN: 403,
  EVENT_NOT_FOUND: 404,
  HOLD_NOT_FOUND: 404,
  ORDER_NOT_FOUND: 404,
  TICKET_NOT_FOUND: 404,
  QUEUE_TICKET_NOT_FOUND: 404,
  SEAT_UNAVAILABLE: 409,
  HOLD_EXPIRED: 409,
  HOLD_LOCKED: 409,
  IDEMPOTENCY_KEY_REUSED: 409,
  SALE_NOT_OPEN: 409,
  EVENT_ALREADY_EXISTS: 409,
  INVALID_EVENT_STATUS: 409,
  INVALID_ORDER_STATUS: 409,
  QUEUE_TICKET_EXPIRED: 410,
  TOO_MANY_SEATS: 422,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  code: string;
  detail?: string;
  correlationId?: string;
  [extension: string]: unknown;
}

/** Any expected failure. Carries the spec error code and the HTTP status that goes with it. */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly extra: Record<string, unknown>;

  constructor(code: ErrorCode, detail?: string, extra: Record<string, unknown> = {}) {
    super(detail ?? code);
    this.name = 'AppError';
    this.code = code;
    this.status = ERROR_CODES[code];
    this.extra = extra;
    Error.captureStackTrace?.(this, AppError);
  }

  /** Example: `AppError.of('SEAT_UNAVAILABLE', 'Seat A-12-07 is taken', { unavailableSeatIds })`. */
  static of(code: ErrorCode, detail?: string, extra?: Record<string, unknown>): AppError {
    return new AppError(code, detail, extra);
  }
}

function titleOf(code: string): string {
  return code
    .toLowerCase()
    .split('_')
    .map((word, index) => (index === 0 ? word[0]!.toUpperCase() + word.slice(1) : word))
    .join(' ');
}

/** Converts any thrown value into the problem+json body. Unknown errors never leak internals. */
export function toProblemDetails(error: unknown, correlationId?: string): ProblemDetails {
  const traceId = correlationId ?? getCorrelationId();

  if (error instanceof AppError) {
    return {
      type: `https://api.flashtix.com/errors/${error.code.toLowerCase().replace(/_/g, '-')}`,
      title: titleOf(error.code),
      status: error.status,
      code: error.code,
      ...(error.message ? { detail: error.message } : {}),
      ...(traceId ? { correlationId: traceId } : {}),
      ...error.extra,
    };
  }

  return {
    type: 'https://api.flashtix.com/errors/internal-error',
    title: 'Internal error',
    status: 500,
    code: 'INTERNAL_ERROR',
    detail: 'Unexpected error. Check the logs with this correlation id.',
    ...(traceId ? { correlationId: traceId } : {}),
  };
}
