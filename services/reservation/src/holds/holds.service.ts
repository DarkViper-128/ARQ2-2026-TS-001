import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { AppError, type EventPublisher } from '@flashtix/shared';
import type Redis from 'ioredis';
import { EVENT_PUBLISHER, REDIS } from '../tokens';
import { ACQUIRE_HOLD, RELEASE_HOLD } from './hold.scripts';
import type { CreateHoldCommand } from './holds.dto';

export interface HoldRecord {
  holdId: string;
  eventId: string;
  userId: string;
  seatIds: string[];
  createdAt: string;
  expiresAt: string;
}

export type ReleaseReason = 'CANCELLED_BY_USER' | 'EXPIRED' | 'ORDER_FAILED';

/** TTL of a hold in seconds (spec.md section 7). */
const DEFAULT_TTL_SECONDS = 600;

@Injectable()
export class HoldsService {
  private readonly logger = new Logger(HoldsService.name);
  private readonly ttlSeconds = Number(process.env.HOLD_TTL_SECONDS ?? DEFAULT_TTL_SECONDS);

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(EVENT_PUBLISHER) private readonly publisher: EventPublisher,
  ) {}

  private seatKey(eventId: string, seatId: string): string {
    return `seat:${eventId}:${seatId}`;
  }

  private holdKey(holdId: string): string {
    return `hold:${holdId}`;
  }

  /** Seat id out of `seat:{eventId}:{seatId}`; the seat id itself has no colons. */
  private seatIdFromKey(key: string): string {
    return key.slice(key.lastIndexOf(':') + 1);
  }

  async createHold(userId: string, command: CreateHoldCommand): Promise<HoldRecord> {
    const holdId = randomUUID();
    const now = new Date();
    const record: HoldRecord = {
      holdId,
      eventId: command.eventId,
      userId,
      seatIds: command.seatIds,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + this.ttlSeconds * 1000).toISOString(),
    };

    const seatKeys = command.seatIds.map((seatId) => this.seatKey(command.eventId, seatId));

    const conflicts = (await this.redis.eval(
      ACQUIRE_HOLD,
      seatKeys.length,
      ...seatKeys,
      holdId,
      String(this.ttlSeconds),
      this.holdKey(holdId),
      JSON.stringify(record),
    )) as string[];

    if (conflicts.length > 0) {
      throw new AppError('SEAT_UNAVAILABLE', 'One or more seats are no longer available', {
        unavailableSeatIds: conflicts.map((key) => this.seatIdFromKey(key)),
      });
    }

    // Publishing after the hold exists: a lost event only delays the read model, while
    // publishing first could advertise a hold that was never taken.
    await this.publisher.publish({
      eventType: 'seat.held',
      aggregateId: holdId,
      data: {
        holdId,
        eventId: record.eventId,
        seatIds: record.seatIds,
        expiresAt: record.expiresAt,
      },
    });

    this.logger.log(`hold ${holdId} created for ${record.seatIds.length} seat(s)`);
    return record;
  }

  async getHold(holdId: string): Promise<HoldRecord> {
    const raw = await this.redis.get(this.holdKey(holdId));
    if (!raw) throw new AppError('HOLD_NOT_FOUND', `Hold ${holdId} does not exist or expired`);
    return JSON.parse(raw) as HoldRecord;
  }

  async releaseHold(userId: string, holdId: string): Promise<void> {
    const record = await this.getHold(holdId);
    const seatKeys = record.seatIds.map((seatId) => this.seatKey(record.eventId, seatId));

    const result = (await this.redis.eval(
      RELEASE_HOLD,
      seatKeys.length + 1,
      this.holdKey(holdId),
      ...seatKeys,
      holdId,
      userId,
    )) as number;

    if (result === 0) {
      throw new AppError('HOLD_NOT_FOUND', `Hold ${holdId} does not exist or expired`);
    }
    if (result === -1) {
      throw new AppError('FORBIDDEN', 'This hold belongs to another fan');
    }

    await this.publishReleased(record, 'CANCELLED_BY_USER');
    this.logger.log(`hold ${holdId} released by the fan`);
  }

  private async publishReleased(record: HoldRecord, reason: ReleaseReason): Promise<void> {
    await this.publisher.publish({
      eventType: 'seat.released',
      aggregateId: record.holdId,
      data: {
        holdId: record.holdId,
        eventId: record.eventId,
        seatIds: record.seatIds,
        reason,
      },
    });
  }
}
