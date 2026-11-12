import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { EventConsumer, type EventEnvelope, MySqlProcessedEvents, queueName } from '@flashtix/shared';
import type { Pool } from 'mysql2/promise';
import { MYSQL } from '../tokens';
import {
  NotificationsService,
  type OrderCancelled,
  type OrderFailed,
  type TicketIssued,
} from './notifications.service';

const CONSUMER = 'notification';

/** NOT-1. Consumes ticket.issued, order.failed and order.cancelled (spec.md section 5). */
@Injectable()
export class EventConsumers implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EventConsumers.name);
  private readonly consumers: EventConsumer[] = [];

  constructor(
    @Inject(MYSQL) private readonly pool: Pool,
    private readonly notifications: NotificationsService,
  ) {}

  async onModuleInit(): Promise<void> {
    const url = process.env.RABBITMQ_URL ?? 'amqp://rabbitmq:5672';
    const processedEvents = new MySqlProcessedEvents(this.pool);

    const start = async <T>(eventType: string, handler: (data: T) => Promise<void>) => {
      const queue = queueName(CONSUMER, eventType);
      this.consumers.push(
        await EventConsumer.start<T>({
          url,
          queue,
          consumer: CONSUMER,
          processedEvents,
          handler: (envelope: EventEnvelope<T>) => handler(envelope.data),
          onDeadLetter: (envelope, error) =>
            this.logger.error(
              `event ${envelope?.eventId ?? 'unknown'} dead-lettered from ${queue}: ${String(error)}`,
            ),
        }),
      );
      this.logger.log(`consuming ${queue}`);
    };

    await start<TicketIssued>('ticket.issued', (data) => this.notifications.onTicketIssued(data));
    await start<OrderFailed>('order.failed', (data) => this.notifications.onOrderFailed(data));
    await start<OrderCancelled>('order.cancelled', (data) => this.notifications.onOrderCancelled(data));
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all(this.consumers.map((consumer) => consumer.close().catch(() => undefined)));
  }
}
