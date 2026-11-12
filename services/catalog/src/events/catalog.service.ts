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

  static readonly EVENT_LIST_KEY = 'events:list';

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

  /**
   * Admin: loads an event and its seat map into the cache so the first fans of the sale
   * never hit catalog-db (spec.md, POST /admin/events/{eventId}/publish).
   */
  async preload(eventId: string): Promise<void> {
    const [event, seatMap] = await Promise.all([
      this.repository.findEvent(eventId, true),
      this.repository.findSeatMap(eventId),
    ]);
    await this.redis
      .multi()
      .set(CatalogService.eventKey(eventId), JSON.stringify(event), 'EX', TTL_EVENT_SECONDS)
      .set(CatalogService.seatMapKey(eventId), JSON.stringify(seatMap), 'EX', TTL_SEATMAP_SECONDS)
      .del(CatalogService.EVENT_LIST_KEY)
      .exec();
  }

  /** Admin: forgets the cached event and the list, after its status changed. */
  async evict(eventId: string): Promise<void> {
    await this.redis.del(CatalogService.eventKey(eventId), CatalogService.EVENT_LIST_KEY);
  }

  /** CAT-3: the seat map plus the live availability overlay. */
  async getSeats(eventId: string): Promise<{ seats: SeatView[]; hit: boolean; asOf: string }> {
    // 404 for unknown and DRAFT events before serving a seat map (answered from the cache).
    await this.getEvent(eventId);

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

  /** Hash seatId -> holdId of the hold that made the seat HELD. */
  static holdersKey(eventId: string): string {
    return `availability-holders:${eventId}`;
  }

  /*
   * The overlay is updated with small scripts instead of plain HSET/HDEL because events
   * from different queues can arrive in any order (spec.md section 5, "Ordering"):
   *  - SOLD is final: a late seat.held or seat.released never moves a sold seat back.
   *  - A seat.released only clears the seat if it is still held by THAT hold, so the
   *    sweep of an expired hold cannot erase the HELD of another fan who took the seat since.
   *
   * KEYS [1] availability [2] holders   ARGV [1] holdId, [2..n] seat ids
   */
  private static readonly MARK_HELD = `
for i = 2, #ARGV do
  if redis.call('HGET', KEYS[1], ARGV[i]) ~= 'SOLD' then
    redis.call('HSET', KEYS[1], ARGV[i], 'HELD')
    redis.call('HSET', KEYS[2], ARGV[i], ARGV[1])
  end
end
return 1`;

  private static readonly MARK_SOLD = `
for i = 2, #ARGV do
  redis.call('HSET', KEYS[1], ARGV[i], 'SOLD')
  redis.call('HDEL', KEYS[2], ARGV[i])
end
return 1`;

  private static readonly CLEAR_HELD = `
for i = 2, #ARGV do
  local holder = redis.call('HGET', KEYS[2], ARGV[i])
  if redis.call('HGET', KEYS[1], ARGV[i]) == 'HELD' and ((not holder) or holder == ARGV[1]) then
    redis.call('HDEL', KEYS[1], ARGV[i])
    redis.call('HDEL', KEYS[2], ARGV[i])
  end
end
return 1`;

  private async overlay(script: string, eventId: string, holdId: string, seatIds: string[]): Promise<void> {
    if (seatIds.length === 0) return;
    await this.redis.eval(
      script,
      2,
      CatalogService.availabilityKey(eventId),
      CatalogService.holdersKey(eventId),
      holdId,
      ...seatIds,
    );
  }

  /** Used by the consumers (CAT-5) to move seats in and out of the overlay. */
  markHeld(eventId: string, seatIds: string[], holdId: string): Promise<void> {
    return this.overlay(CatalogService.MARK_HELD, eventId, holdId, seatIds);
  }

  markSold(eventId: string, seatIds: string[]): Promise<void> {
    return this.overlay(CatalogService.MARK_SOLD, eventId, '', seatIds);
  }

  clearSeats(eventId: string, seatIds: string[], holdId: string): Promise<void> {
    return this.overlay(CatalogService.CLEAR_HELD, eventId, holdId, seatIds);
  }
}
