import { Injectable, Logger } from '@nestjs/common';
import { CORRELATION_ID_HEADER, getCorrelationId, circuitBreakerStateGauge, paymentGatewayDurationSeconds } from '@flashtix/shared';
import { CircuitBreaker } from './circuit-breaker';

export interface GatewayCharge {
  paymentId: string;
  gatewayReference: string;
}

/** Result of one call. `retryable` failures are timeouts, 5xx and network errors. */
export type CallResult<T> =
  | { kind: 'ok'; value: T }
  | { kind: 'declined' }
  | { kind: 'retryable'; failure: 'TIMEOUT' | 'ERROR' | 'CIRCUIT_OPEN'; detail: string };

/**
 * PAY-2. HTTP client of the legacy payment gateway (tools/payment-gateway-mock locally).
 * Every call has its own 20 s timeout and goes through the circuit breaker (PAY-4).
 * Retrying is the caller's job, so one place owns the 2 s / 10 s / 30 s ladder.
 *
 * Emits Prometheus metrics:
 *   - circuit_breaker_state (gauge): 0=closed, 1=open, 2=half-open
 *   - payment_gateway_duration_seconds (histogram): duration of each gateway call
 */
@Injectable()
export class GatewayClient {
  private readonly logger = new Logger(GatewayClient.name);
  private readonly baseUrl = process.env.PAYMENT_GATEWAY_URL ?? 'http://payment-gateway-mock:8080';
  private readonly timeoutMs = Number(process.env.PAYMENT_GATEWAY_TIMEOUT_MS ?? 20_000);

  readonly breaker = new CircuitBreaker(
    {
      failureRate: Number(process.env.BREAKER_FAILURE_RATE ?? 0.5),
      windowMs: Number(process.env.BREAKER_WINDOW_MS ?? 30_000),
      openMs: Number(process.env.BREAKER_OPEN_MS ?? 30_000),
      minimumCalls: Number(process.env.BREAKER_MINIMUM_CALLS ?? 5),
    },
    (state) => {
      this.logger.warn(`circuit breaker is now ${state}`);
      const stateNumber = { CLOSED: 0, OPEN: 1, HALF_OPEN: 2 }[state];
      circuitBreakerStateGauge.set({ service: 'payment-worker' }, stateNumber);
    },
  );

  constructor() {
    // Initialize gauge to the starting state (CLOSED = 0)
    circuitBreakerStateGauge.set({ service: 'payment-worker' }, 0);
  }

  charge(orderId: string, amount: { amount: number; currency: string }, paymentMethodToken: string) {
    return this.call<GatewayCharge>('POST', '/payments', { orderId, amount, paymentMethodToken });
  }

  refund(gatewayPaymentId: string) {
    return this.call<GatewayCharge>('POST', `/payments/${encodeURIComponent(gatewayPaymentId)}/refund`, {});
  }

  private async call<T>(method: string, path: string, body: unknown): Promise<CallResult<T>> {
    if (!this.breaker.allow()) {
      return { kind: 'retryable', failure: 'CIRCUIT_OPEN', detail: 'circuit breaker is open' };
    }

    const start = Date.now();
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: { 'content-type': 'application/json', [CORRELATION_ID_HEADER]: getCorrelationId() ?? '' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });

      const duration = (Date.now() - start) / 1000;

      if (response.status === 402) {
        // A decline is a valid answer from a healthy gateway, not a failure of the gateway.
        this.breaker.record(true);
        paymentGatewayDurationSeconds.observe({ result: 'declined' }, duration);
        return { kind: 'declined' };
      }
      if (response.status >= 500) {
        this.breaker.record(false);
        paymentGatewayDurationSeconds.observe({ result: 'error' }, duration);
        return { kind: 'retryable', failure: 'ERROR', detail: `gateway answered ${response.status}` };
      }
      if (!response.ok) {
        this.breaker.record(true);
        throw new Error(`gateway rejected the request with ${response.status}: ${await response.text()}`);
      }

      this.breaker.record(true);
      paymentGatewayDurationSeconds.observe({ result: 'ok' }, duration);
      return { kind: 'ok', value: (await response.json()) as T };
    } catch (error) {
      const duration = (Date.now() - start) / 1000;
      const name = (error as Error).name;
      if (name === 'TimeoutError' || name === 'AbortError') {
        this.breaker.record(false);
        paymentGatewayDurationSeconds.observe({ result: 'timeout' }, duration);
        return { kind: 'retryable', failure: 'TIMEOUT', detail: `no answer in ${this.timeoutMs} ms` };
      }
      if ((error as Error).message?.startsWith('gateway rejected')) throw error;
      this.breaker.record(false);
      paymentGatewayDurationSeconds.observe({ result: 'error' }, duration);
      return { kind: 'retryable', failure: 'ERROR', detail: String(error) };
    }
  }
}
