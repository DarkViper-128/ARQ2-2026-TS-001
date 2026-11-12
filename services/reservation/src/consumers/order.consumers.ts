import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { EventConsumer, type EventEnvelope, queueName } from '@flashtix/shared';
import type Redis from 'ioredis';
import { HoldsService } from '../holds/holds.service';
import { REDIS } from '../tokens';
import { RedisProcessedEvents } from './redis-processed-events';

const CONSUMER = 'reservation';

interface OrderConfirmedData {
  orderId: string;
  eventId: string;
  holdId: string;
  seats: { seatId: string }[];
}

interface OrderFailedData {
  orderId: string;
  holdId: string;
}

/**
 * RES-7. The end of the saga decides what happens to the hold (spec.md section 5):
 *   order.confirmed -> the seats become permanently sold in hold-store
 *   order.failed    -> the seats are given back immediately
 *
 * Both operations are idempotent by themselves, and RedisProcessedEvents skips repeats.
 */
@Injectable()
export class OrderConsumers implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OrderConsumers.name);
  private readonly consumers: EventConsumer[] = [];

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    private readonly holds: HoldsService,
  ) {}

  async onModuleInit(): Promise<void> {
    const url = process.env.RABBITMQ_URL ?? 'amqp://rabbitmq:5672';
    const processedEvents = new RedisProcessedEvents(this.redis);

    const start = async <T>(eventType: string, handler: (envelope: EventEnvelope<T>) => Promise<void>) => {
      const queue = queueName(CONSUMER, eventType);
      this.consumers.push(
        await EventConsumer.start<T>({
          url,
          queue,
          consumer: CONSUMER,
          processedEvents,
          handler,
          onDeadLetter: (envelope, error) =>
            this.logger.error(
              `event ${envelope?.eventId ?? 'unknown'} dead-lettered from ${queue}: ${String(error)}`,
            ),
        }),
      );
      this.logger.log(`consuming ${queue}`);
    };

    await start<OrderConfirmedData>('order.confirmed', async ({ data }) => {
      await this.holds.consumeForOrder(
        data.holdId,
        data.orderId,
        data.eventId,
        data.seats.map((seat) => seat.seatId),
      );
    });

    await start<OrderFailedData>('order.failed', async ({ data }) => {
      await this.holds.releaseForFailedOrder(data.holdId);
    });
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all(this.consumers.map((consumer) => consumer.close().catch(() => undefined)));
  }
}
