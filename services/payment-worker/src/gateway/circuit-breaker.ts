export type BreakerState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface BreakerOptions {
  /** Share of failures in the window that opens the circuit (spec.md section 5: 50 %). */
  failureRate: number;
  /** Rolling window in ms (30 s). */
  windowMs: number;
  /** How long the circuit stays open before a trial call (30 s). */
  openMs: number;
  /** Calls needed in the window before the rate is trusted. */
  minimumCalls: number;
}

/**
 * PAY-4. Circuit breaker around the legacy gateway.
 *
 * When half of the calls of the last 30 s failed, the gateway is clearly down: waiting
 * 20 s per call would only pile up payments in flight. The circuit opens and calls fail
 * at once for 30 s; then one trial call decides whether to close it again.
 */
export class CircuitBreaker {
  private state: BreakerState = 'CLOSED';
  private openedAt = 0;
  private trialInFlight = false;
  private calls: { at: number; ok: boolean }[] = [];

  constructor(
    private readonly options: BreakerOptions,
    private readonly onChange: (state: BreakerState) => void = () => undefined,
  ) {}

  get current(): BreakerState {
    return this.state;
  }

  /** false when the call must not be attempted. */
  allow(now = Date.now()): boolean {
    if (this.state === 'OPEN') {
      if (now - this.openedAt < this.options.openMs) return false;
      this.move('HALF_OPEN');
    }
    if (this.state === 'HALF_OPEN') {
      if (this.trialInFlight) return false;
      this.trialInFlight = true;
    }
    return true;
  }

  record(ok: boolean, now = Date.now()): void {
    if (this.state === 'HALF_OPEN') {
      this.trialInFlight = false;
      this.calls = [];
      if (ok) {
        this.move('CLOSED');
      } else {
        this.openedAt = now;
        this.move('OPEN');
      }
      return;
    }

    this.calls.push({ at: now, ok });
    this.calls = this.calls.filter((call) => now - call.at <= this.options.windowMs);
    const failures = this.calls.filter((call) => !call.ok).length;
    if (
      this.state === 'CLOSED' &&
      this.calls.length >= this.options.minimumCalls &&
      failures / this.calls.length >= this.options.failureRate
    ) {
      this.openedAt = now;
      this.calls = [];
      this.move('OPEN');
    }
  }

  private move(state: BreakerState): void {
    if (this.state === state) return;
    this.state = state;
    this.onChange(state);
  }
}
