import { Inject, Injectable, Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS } from '../tokens';
import {
  CatalogRepository,
  type EventDetail,
  type EventSummary,
  type SeatRow,
} from './catalog.repository';

export type SeatStatus = 'AVAILABLE' | 'HELD' | 'SOLD';

export interface SeatView extends SeatRow {
  status: SeatStatus;
}

/** Cache TTLs, from the storage table in spec.md section 3. */
const TTL_EVENT_SECONDS = 60;
const TTL_SEATMAP_SECONDS = 300;

/**
 * Serves the catalog with a cache-aside strategy (CAT-2, CAT-3).
 *
 * Seat AVAILABILITY never comes from a database: it lives in the `availability:{eventId}`
 * hash, which the event consumers keep up to date (CAT-5). The seat MAP (which seats
 * exist) does come from catalog-db on a cache miss, because it is static data this
 * service owns.
 */
@Injectable()
export class CatalogService {
  private readonly logger = new Logger(CatalogService.name);

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    private readonly repository: CatalogRepository,
  ) {}

  static eventKey(eventId: string): string {
    return `event:${eventId}`;
  }

  static seatMapKey(eventId: string): string {
    return `seatmap:${eventId}`;
  }

  /** Hash seatId -> HELD | SOLD. Seats missing from it are AVAILABLE. */
  static availabilityKey(eventId: string): string {
    return `availability:${eventId}`;
  }

  private static readonly EVENT_LIST_KEY = 'events:list';

  /** Reads through the cache; `loader` only runs on a miss. */
  private async cacheAside<T>(key: string, ttl: number, loader: () => Promise<T>): Promise<{ value: T; hit: boolean }> {
    const cached = await this.redis.get(key);
    if (cached) return { value: JSON.parse(cached) as T, hit: true };

    const value = await loader();
    await this.redis.set(key, JSON.stringify(value), 'EX', ttl);
    this.logger.debug(`cache miss for ${key}, repopulated`);
    return { value, hit: false };
  }

  listEvents(): Promise<{ value: EventSummary[]; hit: boolean }> {
    return this.cacheAside(CatalogService.EVENT_LIST_KEY, TTL_EVENT_SECONDS, () =>
      this.repository.listPublishedEvents(),
    );
  }

  getEvent(eventId: string): Promise<{ value: EventDetail; hit: boolean }> {
    return this.cacheAside(CatalogService.eventKey(eventId), TTL_EVENT_SECONDS, () =>
      this.repository.findEvent(eventId),
    );
  }

  /** CAT-3: the seat map plus the live availability overlay. */
  async getSeats(eventId: string): Promise<{ seats: SeatView[]; hit: boolean; asOf: string }> {
    const { value: seatMap, hit } = await this.cacheAside(
      CatalogService.seatMapKey(eventId),
      TTL_SEATMAP_SECONDS,
      () => this.repository.findSeatMap(eventId),
    );

    const overlay = await this.redis.hgetall(CatalogService.availabilityKey(eventId));

    return {
      hit,
      asOf: new Date().toISOString(),
      seats: seatMap.map((seat) => ({
        ...seat,
        status: (overlay[seat.seatId] as SeatStatus | undefined) ?? 'AVAILABLE',
      })),
    };
  }

  /** Used by the consumers (CAT-5) to move seats in and out of the overlay. */
  async markSeats(eventId: string, seatIds: string[], status: 'HELD' | 'SOLD'): Promise<void> {
    if (seatIds.length === 0) return;
    const pairs = seatIds.flatMap((seatId) => [seatId, status]);
    await this.redis.hset(CatalogService.availabilityKey(eventId), ...pairs);
  }

  async clearSeats(eventId: string, seatIds: string[]): Promise<void> {
    if (seatIds.length === 0) return;
    await this.redis.hdel(CatalogService.availabilityKey(eventId), ...seatIds);
  }
}
