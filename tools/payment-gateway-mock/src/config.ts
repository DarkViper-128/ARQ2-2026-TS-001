/** Runtime behaviour of the mock. Every value can be changed live through `PUT /_mock/config`. */
export interface MockConfig {
  /** Fastest answer, in milliseconds. */
  latencyMinMs: number;
  /** Slowest answer. The real legacy gateway takes up to 15 s (docs/spec.md). */
  latencyMaxMs: number;
  /** Share of charges answered with `402 CARD_DECLINED`. 0 to 1. */
  declineRate: number;
  /** Share of charges answered with `500`. 0 to 1. */
  errorRate: number;
  /** Share of charges that never answer, so the caller hits its own timeout. 0 to 1. */
  timeoutRate: number;
}

function number(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

export function configFromEnv(): MockConfig {
  return {
    latencyMinMs: number('MOCK_LATENCY_MIN_MS', 200),
    latencyMaxMs: number('MOCK_LATENCY_MAX_MS', 15_000),
    declineRate: number('MOCK_DECLINE_RATE', 0.05),
    errorRate: number('MOCK_ERROR_RATE', 0.05),
    timeoutRate: number('MOCK_TIMEOUT_RATE', 0.02),
  };
}

const RATE_KEYS = ['declineRate', 'errorRate', 'timeoutRate'] as const;

/** Validates and applies a partial update coming from `PUT /_mock/config`. */
export function applyConfigPatch(current: MockConfig, patch: Record<string, unknown>): MockConfig {
  const next: MockConfig = { ...current };

  for (const key of ['latencyMinMs', 'latencyMaxMs'] as const) {
    if (patch[key] === undefined) continue;
    const value = Number(patch[key]);
    if (!Number.isFinite(value) || value < 0) throw new Error(`${key} must be a number >= 0`);
    next[key] = value;
  }

  for (const key of RATE_KEYS) {
    if (patch[key] === undefined) continue;
    const value = Number(patch[key]);
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw new Error(`${key} must be a number between 0 and 1`);
    }
    next[key] = value;
  }

  if (next.latencyMinMs > next.latencyMaxMs) {
    throw new Error('latencyMinMs must be <= latencyMaxMs');
  }
  return next;
}
