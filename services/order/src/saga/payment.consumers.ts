import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { EventConsumer, type EventEnvelope, claimEvent, queueName } from '@flashtix/shared';
import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';
import { addToOutbox, inTransaction } from '../outbox/outbox';
import { OutboxRelay } from '../outbox/outbox.relay';
import { MYSQL } from '../tokens';

const CONSUMER = 'order';

interface Money {
  amount: number;
  currency: string;
}

interface PaymentSucceeded {
  paymentId: string;
  orderId: string;
  amount: Money;
  gatewayReference: string;
}

interface PaymentFailed {
  paymentId: string;
  orderId: string;
  reason: 'DECLINED' | 'GATEWAY_TIMEOUT' | 'GATEWAY_UNAVAILABLE';
  attempts: number;
}

interface RefundCompleted {
  orderId: string;
  paymentId: string;
  gatewayReference: string;
}

interface OrderRow {
  order_id: string;
  user_id: string;
  user_email: string;
  event_id: string;
  hold_id: string;
  status: string;
  failure_reason: string | null;
  payment_id: string | null;
  total_amount: number;
  currency: string;
  version: number;
}

/** payment.failed reasons, translated to the order's failureReason. */
const FAILURE_REASON: Record<PaymentFailed['reason'], string> = {
  DECLINED: 'PAYMENT_DECLINED',
  GATEWAY_TIMEOUT: 'PAYMENT_TIMEOUT',
  GATEWAY_UNAVAILABLE: 'GATEWAY_UNAVAILABLE',
};

function isSeatConflict(error: unknown): boolean {
  const failure = error as { code?: string; message?: string };
  return failure.code === 'ER_DUP_ENTRY' && (failure.message ?? '').includes('sold_seats');
}

/**
 * ORD-5 to ORD-7. The rest of the checkout saga (ADR 003, spec.md section 3):
 *
 *   payment.succeeded -> sold_seats + CONFIRMED + order.confirmed      (one transaction)
 *                        or, on a duplicate seat: REFUND_PENDING + refund.requested
 *   payment.failed    -> FAILED + order.failed
 *   refund.completed  -> CANCELLED + order.cancelled
 *
 * Every handler claims the event in processed_events INSIDE its transaction, and only acts
 * on the state it expects, so a repeated or late event never changes an order twice.
 */
@Injectable()
export class PaymentConsumers implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PaymentConsumers.name);
  private readonly consumers: EventConsumer[] = [];

  constructor(
    @Inject(MYSQL) private readonly pool: Pool,
    private readonly relay: OutboxRelay,
  ) {}

  async onModuleInit(): Promise<void> {
    const url = process.env.RABBITMQ_URL ?? 'amqp://rabbitmq:5672';
    const start = async <T>(eventType: string, handler: (envelope: EventEnvelope<T>) => Promise<void>) => {
      const queue = queueName(CONSUMER, eventType);
      this.consumers.push(
        await EventConsumer.start<T>({
          url,
          queue,
          consumer: CONSUMER,
          handler: async (envelope) => {
            await handler(envelope);
            this.relay.kick();
          },
          onDeadLetter: (envelope, error) =>
            this.logger.error(
              `event ${envelope?.eventId ?? 'unknown'} dead-lettered from ${queue}: ${String(error)}`,
            ),
        }),
      );
      this.logger.log(`consuming ${queue}`);
    };

    await start<PaymentSucceeded>('payment.succeeded', (envelope) => this.onPaymentSucceeded(envelope));
    await start<PaymentFailed>('payment.failed', (envelope) => this.onPaymentFailed(envelope));
    await start<RefundCompleted>('refund.completed', (envelope) => this.onRefundCompleted(envelope));
  }

  private async lockOrder(connection: PoolConnection, orderId: string): Promise<OrderRow | undefined> {
    const [rows] = await connection.query<RowDataPacket[]>(
      'SELECT * FROM orders WHERE order_id = ? FOR UPDATE',
      [orderId],
    );
    return rows[0] as OrderRow | undefined;
  }

  /** ORD-5. */
  private async onPaymentSucceeded(envelope: EventEnvelope<PaymentSucceeded>): Promise<void> {
    const { data } = envelope;
    try {
      await inTransaction(this.pool, async (connection) => {
        if (!(await claimEvent(connection, CONSUMER, envelope.eventId))) return;
        const order = await this.lockOrder(connection, data.orderId);
        if (!order || order.status !== 'PENDING') return;

        const [seats] = await connection.query<RowDataPacket[]>(
          'SELECT seat_id, category FROM order_seats WHERE order_id = ?',
          [order.order_id],
        );
        // The overbooking safety net: PRIMARY KEY (event_id, seat_id).
        await connection.query('INSERT INTO sold_seats (event_id, seat_id, order_id) VALUES ?', [
          seats.map((seat) => [order.event_id, seat.seat_id, order.order_id]),
        ]);

        const version = order.version + 1;
        await connection.execute(
          `UPDATE orders SET status = 'CONFIRMED', payment_id = ?, gateway_reference = ?, version = ?
            WHERE order_id = ?`,
          [data.paymentId, data.gatewayReference, version, order.order_id],
        );
        await addToOutbox(connection, {
          eventType: 'order.confirmed',
          aggregateId: order.order_id,
          aggregateVersion: version,
          data: {
            orderId: order.order_id,
            userId: order.user_id,
            userEmail: order.user_email,
            eventId: order.event_id,
            holdId: order.hold_id,
            seats: seats.map((seat) => ({ seatId: seat.seat_id as string, category: seat.category as string })),
          },
        });
        this.logger.log(`order ${order.order_id} CONFIRMED`);
      });
    } catch (error) {
      if (!isSeatConflict(error)) throw error;
      await this.startRefund(envelope);
    }
  }

  /** Compensation: the card was charged but a seat was already sold to somebody else. */
  private async startRefund(envelope: EventEnvelope<PaymentSucceeded>): Promise<void> {
    const { data } = envelope;
    await inTransaction(this.pool, async (connection) => {
      if (!(await claimEvent(connection, CONSUMER, envelope.eventId))) return;
      const order = await this.lockOrder(connection, data.orderId);
      if (!order || order.status !== 'PENDING') return;

      const version = order.version + 1;
      await connection.execute(
        `UPDATE orders SET status = 'REFUND_PENDING', failure_reason = 'SEAT_CONFLICT',
                payment_id = ?, gateway_reference = ?, version = ?
          WHERE order_id = ?`,
        [data.paymentId, data.gatewayReference, version, order.order_id],
      );
      await addToOutbox(connection, {
        eventType: 'refund.requested',
        aggregateId: order.order_id,
        aggregateVersion: version,
        data: {
          orderId: order.order_id,
          paymentId: data.paymentId,
          amount: { amount: Number(order.total_amount), currency: order.currency },
          reason: 'SEAT_CONFLICT',
        },
      });
      this.logger.warn(`order ${order.order_id} hit a sold seat after payment: REFUND_PENDING`);
    });
  }

  /** ORD-6. */
  private async onPaymentFailed(envelope: EventEnvelope<PaymentFailed>): Promise<void> {
    const { data } = envelope;
    await inTransaction(this.pool, async (connection) => {
      if (!(await claimEvent(connection, CONSUMER, envelope.eventId))) return;
      const order = await this.lockOrder(connection, data.orderId);
      if (!order || order.status !== 'PENDING') return;

      const reason = FAILURE_REASON[data.reason] ?? 'PAYMENT_DECLINED';
      const version = order.version + 1;
      await connection.execute(
        "UPDATE orders SET status = 'FAILED', failure_reason = ?, version = ? WHERE order_id = ?",
        [reason, version, order.order_id],
      );
      await addToOutbox(connection, {
        eventType: 'order.failed',
        aggregateId: order.order_id,
        aggregateVersion: version,
        data: {
          orderId: order.order_id,
          userId: order.user_id,
          userEmail: order.user_email,
          eventId: order.event_id,
          holdId: order.hold_id,
          reason,
        },
      });
      this.logger.log(`order ${order.order_id} FAILED (${reason})`);
    });
  }

  /** ORD-7. */
  private async onRefundCompleted(envelope: EventEnvelope<RefundCompleted>): Promise<void> {
    const { data } = envelope;
    await inTransaction(this.pool, async (connection) => {
      if (!(await claimEvent(connection, CONSUMER, envelope.eventId))) return;
      const order = await this.lockOrder(connection, data.orderId);
      if (!order || order.status !== 'REFUND_PENDING') return;

      const version = order.version + 1;
      await connection.execute(
        "UPDATE orders SET status = 'CANCELLED', version = ? WHERE order_id = ?",
        [version, order.order_id],
      );
      await addToOutbox(connection, {
        eventType: 'order.cancelled',
        aggregateId: order.order_id,
        aggregateVersion: version,
        data: {
          orderId: order.order_id,
          userId: order.user_id,
          userEmail: order.user_email,
          eventId: order.event_id,
          reason: order.failure_reason ?? 'EVENT_CANCELLED',
          refunded: { amount: Number(order.total_amount), currency: order.currency },
        },
      });
      this.logger.log(`order ${order.order_id} CANCELLED after refund`);
    });
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all(this.consumers.map((consumer) => consumer.close().catch(() => undefined)));
  }
}
