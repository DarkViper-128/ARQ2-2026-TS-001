import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import {
  EventConsumer,
  MySqlProcessedEvents,
  type EventEnvelope,
  queueName,
} from '@flashtix/shared';
import type { Pool } from 'mysql2/promise';
import { MYSQL } from '../tokens';
import { CatalogService } from '../events/catalog.service';

const CONSUMER = 'catalog';

interface SeatEventData {
  eventId: string;
  holdId?: string;
  seatIds?: string[];
  seats?: (string | { seatId: string })[];
}

/** Accepts both `seatIds: ["A-1"]` and `seats: [{ seatId: "A-1" }]`. */
function seatIdsOf(data: SeatEventData): string[] {
  if (Array.isArray(data.seatIds)) return data.seatIds;
  if (Array.isArray(data.seats)) {
    return data.seats.map((seat) => (typeof seat === 'string' ? seat : seat.seatId));
  }
  return [];
}

/**
 * CAT-5. Keeps the availability overlay in catalog-cache in step with what the rest of
 * the platform does to the seats, so reads never need the transactional database.
 *
 * Every consumer is idempotent through `processed_events`, because RabbitMQ delivers
 * at least once.
 */
@Injectable()
export class AvailabilityConsumers implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AvailabilityConsumers.name);
  private readonly consumers: EventConsumer[] = [];

  constructor(
    @Inject(MYSQL) private readonly pool: Pool,
    private readonly catalog: CatalogService,
  ) {}

  async onModuleInit(): Promise<void> {
    const url = process.env.RABBITMQ_URL ?? 'amqp://rabbitmq:5672';
    const processedEvents = new MySqlProcessedEvents(this.pool);

    const subscriptions: [string, (envelope: EventEnvelope<SeatEventData>) => Promise<void>][] = [
      ['seat.held', async (envelope) => this.onSeatsHeld(envelope)],
      ['seat.released', async (envelope) => this.onSeatsReleased(envelope)],
      ['order.confirmed', async (envelope) => this.onOrderConfirmed(envelope)],
    ];

    for (const [eventType, handler] of subscriptions) {
      const queue = queueName(CONSUMER, eventType);
      this.consumers.push(
        await EventConsumer.start<SeatEventData>({
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
    }
  }

  private async onSeatsHeld(envelope: EventEnvelope<SeatEventData>): Promise<void> {
    const seatIds = seatIdsOf(envelope.data);
    await this.catalog.markHeld(envelope.data.eventId, seatIds, envelope.data.holdId ?? '');
    this.logger.log(`${seatIds.length} seat(s) marked HELD for event ${envelope.data.eventId}`);
  }

  private async onSeatsReleased(envelope: EventEnvelope<SeatEventData>): Promise<void> {
    const seatIds = seatIdsOf(envelope.data);
    await this.catalog.clearSeats(envelope.data.eventId, seatIds, envelope.data.holdId ?? '');
    this.logger.log(`${seatIds.length} seat(s) released for event ${envelope.data.eventId}`);
  }

  private async onOrderConfirmed(envelope: EventEnvelope<SeatEventData>): Promise<void> {
    const seatIds = seatIdsOf(envelope.data);
    // SOLD overwrites HELD; the seat never returns to AVAILABLE from here.
    await this.catalog.markSold(envelope.data.eventId, seatIds);
    this.logger.log(`${seatIds.length} seat(s) marked SOLD for event ${envelope.data.eventId}`);
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all(this.consumers.map((consumer) => consumer.close().catch(() => undefined)));
  }
}
