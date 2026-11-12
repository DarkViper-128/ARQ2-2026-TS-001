import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { EventConsumer, MySqlProcessedEvents, queueName } from '@flashtix/shared';
import type { Pool } from 'mysql2/promise';
import { MYSQL } from '../tokens';
import { type OrderConfirmed, TicketsService } from './tickets.service';

const CONSUMER = 'ticket';

/** TKT-2. Consumes order.confirmed (spec.md section 5). */
@Injectable()
export class OrderConsumers implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OrderConsumers.name);
  private readonly consumers: EventConsumer[] = [];

  constructor(
    @Inject(MYSQL) private readonly pool: Pool,
    private readonly tickets: TicketsService,
  ) {}

  async onModuleInit(): Promise<void> {
    const queue = queueName(CONSUMER, 'order.confirmed');
    this.consumers.push(
      await EventConsumer.start<OrderConfirmed>({
        url: process.env.RABBITMQ_URL ?? 'amqp://rabbitmq:5672',
        queue,
        consumer: CONSUMER,
        processedEvents: new MySqlProcessedEvents(this.pool),
        prefetch: Number(process.env.TICKET_CONCURRENCY ?? 10),
        handler: (envelope) => this.tickets.issue(envelope.data, envelope.correlationId),
        onDeadLetter: (envelope, error) =>
          this.logger.error(
            `event ${envelope?.eventId ?? 'unknown'} dead-lettered from ${queue}: ${String(error)}`,
          ),
      }),
    );
    this.logger.log(`consuming ${queue}`);
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all(this.consumers.map((consumer) => consumer.close().catch(() => undefined)));
  }
}
