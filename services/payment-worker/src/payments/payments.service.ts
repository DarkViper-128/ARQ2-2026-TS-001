import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { EventPublisher } from '@flashtix/shared';
import { paymentsTotal } from '@flashtix/shared';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { type CallResult, GatewayClient, type GatewayCharge } from '../gateway/gateway.client';
import { EVENT_PUBLISHER, MYSQL } from '../tokens';

export interface Money {
  amount: number;
  currency: string;
}

export interface PaymentRequested {
  orderId: string;
  userId: string;
  amount: Money;
  paymentMethodToken: string;
}

export interface RefundRequested {
  orderId: string;
  paymentId: string;
  amount: Money;
  reason: string;
}

type FailureReason = 'DECLINED' | 'GATEWAY_TIMEOUT' | 'GATEWAY_UNAVAILABLE';

interface PaymentRow {
  payment_id: string;
  order_id: string;
  amount: number;
  currency: string;
  status: 'REQUESTED' | 'SUCCEEDED' | 'FAILED' | 'REFUNDED';
  failure_reason: FailureReason | null;
  attempts: number;
  gateway_payment_id: string | null;
  gateway_reference: string | null;
}

const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

/** PAY-3. Waits between attempts: 2 s, 10 s, 30 s (spec.md section 7). */
function retryDelays(): number[] {
  return (process.env.PAYMENT_RETRY_DELAYS_MS ?? '2000,10000,30000')
    .split(',')
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isFinite(value) && value >= 0);
}

/**
 * PAY-1 to PAY-5. Talks to the legacy gateway so nobody else has to wait for it.
 *
 * Idempotency has two layers:
 *  1. payment-db: one row per orderId. A redelivered payment.requested reads the row;
 *     if the payment already finished it only re-publishes the result.
 *  2. the gateway: the orderId is sent as its idempotency key, so a retry after a timeout
 *     that actually went through returns the existing charge instead of charging again.
 */
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);
  private readonly delays = retryDelays();

  constructor(
    @Inject(MYSQL) private readonly pool: Pool,
    @Inject(EVENT_PUBLISHER) private readonly publisher: EventPublisher,
    private readonly gateway: GatewayClient,
  ) {}

  private async load(orderId: string): Promise<PaymentRow | undefined> {
    const [rows] = await this.pool.query<RowDataPacket[]>('SELECT * FROM payments WHERE order_id = ?', [orderId]);
    return rows[0] as PaymentRow | undefined;
  }

  /** First attempt plus one retry per configured delay; decline is final, never retried. */
  private async withRetries<T>(
    orderId: string,
    call: () => Promise<CallResult<T>>,
  ): Promise<{ result: CallResult<T>; attempts: number }> {
    let attempts = 0;
    let result: CallResult<T> = { kind: 'retryable', failure: 'ERROR', detail: 'not attempted' };
    for (let attempt = 0; attempt <= this.delays.length; attempt++) {
      if (attempt > 0) await sleep(this.delays[attempt - 1]!);
      result = await call();
      if (result.kind !== 'retryable' || result.failure !== 'CIRCUIT_OPEN') attempts++;
      if (result.kind !== 'retryable') break;
      this.logger.warn(`order ${orderId}: attempt ${attempt + 1} failed (${result.failure}: ${result.detail})`);
    }
    return { result, attempts };
  }

  /** PAY-2 and PAY-3: payment.requested -> payment.succeeded | payment.failed. */
  async charge(request: PaymentRequested): Promise<void> {
    await this.pool.execute(
      `INSERT IGNORE INTO payments (payment_id, order_id, user_id, amount, currency, status)
       VALUES (?, ?, ?, ?, ?, 'REQUESTED')`,
      [randomUUID(), request.orderId, request.userId, request.amount.amount, request.amount.currency],
    );
    const existing = (await this.load(request.orderId))!;

    // A redelivery after the work was done: only make sure the result reaches the saga.
    if (existing.status !== 'REQUESTED') {
      await this.publishResult(existing);
      return;
    }

    const { result, attempts } = await this.withRetries(request.orderId, () =>
      this.gateway.charge(request.orderId, request.amount, request.paymentMethodToken),
    );

    if (result.kind === 'ok') {
      await this.pool.execute(
        `UPDATE payments SET status = 'SUCCEEDED', attempts = attempts + ?, gateway_payment_id = ?,
                gateway_reference = ?, last_error = NULL
          WHERE order_id = ?`,
        [attempts, result.value.paymentId, result.value.gatewayReference, request.orderId],
      );
      paymentsTotal.inc({ outcome: 'succeeded', reason: '' });
    } else {
      const reason: FailureReason =
        result.kind === 'declined'
          ? 'DECLINED'
          : result.failure === 'TIMEOUT'
            ? 'GATEWAY_TIMEOUT'
            : 'GATEWAY_UNAVAILABLE';
      await this.pool.execute(
        `UPDATE payments SET status = 'FAILED', failure_reason = ?, attempts = attempts + ?, last_error = ?
          WHERE order_id = ?`,
        [reason, attempts, result.kind === 'retryable' ? result.detail.slice(0, 255) : 'card declined', request.orderId],
      );
      paymentsTotal.inc({ outcome: 'failed', reason });
    }

    await this.publishResult((await this.load(request.orderId))!);
  }

  private async publishResult(payment: PaymentRow): Promise<void> {
    if (payment.status === 'SUCCEEDED' || payment.status === 'REFUNDED') {
      await this.publisher.publish({
        eventType: 'payment.succeeded',
        aggregateId: payment.payment_id,
        data: {
          paymentId: payment.payment_id,
          orderId: payment.order_id,
          amount: { amount: Number(payment.amount), currency: payment.currency },
          gatewayReference: payment.gateway_reference,
        },
      });
      this.logger.log(`order ${payment.order_id}: payment SUCCEEDED`);
      return;
    }
    if (payment.status === 'FAILED') {
      await this.publisher.publish({
        eventType: 'payment.failed',
        aggregateId: payment.payment_id,
        data: {
          paymentId: payment.payment_id,
          orderId: payment.order_id,
          reason: payment.failure_reason ?? 'GATEWAY_UNAVAILABLE',
          attempts: payment.attempts,
        },
      });
      this.logger.log(`order ${payment.order_id}: payment FAILED (${payment.failure_reason})`);
    }
  }

  /** PAY-5: refund.requested -> refund.completed. A payment can be refunded only once. */
  async refund(request: RefundRequested): Promise<void> {
    const payment = await this.load(request.orderId);
    if (!payment || !payment.gateway_payment_id) {
      throw new Error(`order ${request.orderId} has no successful charge to refund`);
    }

    if (payment.status === 'SUCCEEDED') {
      const { result, attempts } = await this.withRetries<GatewayCharge>(request.orderId, () =>
        this.gateway.refund(payment.gateway_payment_id!),
      );
      if (result.kind !== 'ok') {
        // Leave it to the broker: retry ladder and then the DLQ, where a refund that keeps
        // failing waits for a human (spec.md section 5).
        throw new Error(`refund of order ${request.orderId} failed after ${attempts} attempt(s)`);
      }
      await this.pool.execute(
        "UPDATE payments SET status = 'REFUNDED', attempts = attempts + ? WHERE order_id = ?",
        [attempts, request.orderId],
      );
    } else if (payment.status !== 'REFUNDED') {
      throw new Error(`order ${request.orderId} cannot be refunded from status ${payment.status}`);
    }

    await this.publisher.publish({
      eventType: 'refund.completed',
      aggregateId: payment.payment_id,
      data: {
        orderId: request.orderId,
        paymentId: payment.payment_id,
        gatewayReference: payment.gateway_reference,
      },
    });
    this.logger.log(`order ${request.orderId}: payment REFUNDED`);
  }
}
