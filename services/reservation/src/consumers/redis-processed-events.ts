import type { ProcessedEvents } from '@flashtix/shared';
import type Redis from 'ioredis';

/**
 * `processed_events` for a service without MySQL. The Reservation Service only owns
 * hold-store, so the record of handled events lives there too, with a TTL far longer than
 * any redelivery window (the broker gives up after 3 attempts within ~71 s).
 */
export class RedisProcessedEvents implements ProcessedEvents {
  constructor(
    private readonly redis: Redis,
    private readonly ttlSeconds = 7 * 24 * 3600,
  ) {}

  private key(consumer: string, eventId: string): string {
    return `processed:${consumer}:${eventId}`;
  }

  async isProcessed(consumer: string, eventId: string): Promise<boolean> {
    return (await this.redis.exists(this.key(consumer, eventId))) === 1;
  }

  async markProcessed(consumer: string, eventId: string): Promise<void> {
    await this.redis.set(this.key(consumer, eventId), '1', 'EX', this.ttlSeconds);
  }
}
