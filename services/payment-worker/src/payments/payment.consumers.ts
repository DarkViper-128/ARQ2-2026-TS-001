import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { EventConsumer, MySqlProcessedEvents, queueName } from '@flashtix/shared';
import type { Pool } from 'mysql2/promise';
import { MYSQL } from '../tokens';
import { type PaymentRequested, PaymentsService, type RefundRequested } from './payments.service';

const CONSUMER = 'payment-worker';

/**
 * Consumes payment.requested and refund.requested (spec.md section 5).
 *
 * `prefetch` is how many payments one worker handles at the same time. A payment can take
 * up to ~2 minutes (4 calls of 20 s plus 42 s of backoff), so the worker keeps many in
 * flight instead of one after another; more workers can be started during a peak.
 */
@Injectable()
export class PaymentConsumers implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PaymentConsumers.name);
  private readonly consumers: EventConsumer[] = [];

  constructor(
    @Inject(MYSQL) private readonly pool: Pool,
    private readonly payments: PaymentsService,
  ) {}

  async onModuleInit(): Promise<void> {
    const url = process.env.RABBITMQ_URL ?? 'amqp://rabbitmq:5672';
    const processedEvents = new MySqlProcessedEvents(this.pool);
    const prefetch = Number(process.env.PAYMENT_CONCURRENCY ?? 50);

    const start = async <T>(eventType: string, handler: (data: T) => Promise<void>) => {
      const queue = queueName(CONSUMER, eventType);
      this.consumers.push(
        await EventConsumer.start<T>({
          url,
          queue,
          consumer: CONSUMER,
          processedEvents,
          prefetch,
          handler: (envelope) => handler(envelope.data),
          onDeadLetter: (envelope, error) =>
            this.logger.error(
              `event ${envelope?.eventId ?? 'unknown'} dead-lettered from ${queue}: ${String(error)}`,
            ),
        }),
      );
      this.logger.log(`consuming ${queue} (prefetch ${prefetch})`);
    };

    await start<PaymentRequested>('payment.requested', (data) => this.payments.charge(data));
    await start<RefundRequested>('refund.requested', (data) => this.payments.refund(data));
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all(this.consumers.map((consumer) => consumer.close().catch(() => undefined)));
  }
}
