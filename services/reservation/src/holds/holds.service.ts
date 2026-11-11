import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { AppError, type EventPublisher, verifyAdmissionToken } from '@flashtix/shared';
import type Redis from 'ioredis';
import { EVENT_PUBLISHER, REDIS } from '../tokens';
import {
  ACQUIRE_HOLD,
  CONSUME_HOLD,
  LOCK_HOLD,
  RELEASE_FOR_ORDER,
  RELEASE_HOLD,
  SWEEP_EXPIRED,
} from './hold.scripts';
import type { CreateHoldCommand } from './holds.dto';

export type HoldStatus = 'ACTIVE' | 'LOCKED';

export interface HoldRecord {
  holdId: string;
  eventId: string;
  userId: string;
  seatIds: string[];
  status: HoldStatus;
  /** Set once an order locked the hold (RES-4). */
  orderId?: string;
  createdAt: string;
  /** Expiry in ms since epoch. The single source for `expiresAt` in every answer. */
  expiresAtMs: number;
}

export type ReleaseReason = 'CANCELLED_BY_USER' | 'EXPIRED' | 'ORDER_FAILED';

export type LockOutcome = 'OK' | 'ALREADY_LOCKED' | 'NOT_FOUND' | 'EXPIRED' | 'LOCKED' | 'FORBIDDEN';

export interface LockResult {
  outcome: LockOutcome;
  record?: HoldRecord;
}

/** TTL of a hold in seconds (spec.md section 7). */
const DEFAULT_TTL_SECONDS = 600;
/** Minimum life of a hold once an order locks it (proto/reservation/v1, "TTL rule"). */
const DEFAULT_LOCK_SECONDS = 300;

export const HOLDS_INDEX_KEY = 'holds:by-expiry';

@Injectable()
export class HoldsService {
  private readonly logger = new Logger(HoldsService.name);
  private readonly ttlSeconds = Number(process.env.HOLD_TTL_SECONDS ?? DEFAULT_TTL_SECONDS);
  private readonly lockSeconds = Number(process.env.HOLD_LOCK_SECONDS ?? DEFAULT_LOCK_SECONDS);
  private readonly admissionSecret = process.env.ADMISSION_TOKEN_SECRET ?? '';
  /** WR-3: POST /holds requires the Waiting Room token. Only tests may switch it off. */
  private readonly admissionRequired = process.env.ADMISSION_REQUIRED !== 'false';

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

  private refKey(holdId: string): string {
    return `hold-ref:${holdId}`;
  }

  private seatKeys(record: Pick<HoldRecord, 'eventId' | 'seatIds'>): string[] {
    return record.seatIds.map((seatId) => this.seatKey(record.eventId, seatId));
  }

  /** Seat id out of `seat:{eventId}:{seatId}`; the seat id itself has no colons. */
  private seatIdFromKey(key: string): string {
    return key.slice(key.lastIndexOf(':') + 1);
  }

  checkAdmission(userId: string, eventId: string, token: string | undefined): void {
    if (!this.admissionRequired) return;
    const check = verifyAdmissionToken(token, this.admissionSecret, { eventId, userId });
    if (!check.valid) {
      throw new AppError('INVALID_ADMISSION_TOKEN', `Admission token rejected (${check.reason})`);
    }
  }

  async createHold(
    userId: string,
    command: CreateHoldCommand,
    admissionToken?: string,
  ): Promise<HoldRecord> {
    this.checkAdmission(userId, command.eventId, admissionToken);

    const holdId = randomUUID();
    const now = Date.now();
    const record: HoldRecord = {
      holdId,
      eventId: command.eventId,
      userId,
      seatIds: command.seatIds,
      status: 'ACTIVE',
      createdAt: new Date(now).toISOString(),
      expiresAtMs: now + this.ttlSeconds * 1000,
    };

    const seatKeys = this.seatKeys(record);
    const conflicts = (await this.redis.eval(
      ACQUIRE_HOLD,
      seatKeys.length,
      ...seatKeys,
      holdId,
      String(this.ttlSeconds),
      this.holdKey(holdId),
      JSON.stringify(record),
      HOLDS_INDEX_KEY,
      this.refKey(holdId),
      String(record.expiresAtMs),
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
        expiresAt: new Date(record.expiresAtMs).toISOString(),
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
    const result = (await this.redis.eval(
      RELEASE_HOLD,
      record.seatIds.length + 1,
      this.holdKey(holdId),
      ...this.seatKeys(record),
      holdId,
      userId,
      HOLDS_INDEX_KEY,
      this.refKey(holdId),
    )) as number;

    if (result === 0) {
      throw new AppError('HOLD_NOT_FOUND', `Hold ${holdId} does not exist or expired`);
    }
    if (result === -1) {
      throw new AppError('FORBIDDEN', 'This hold belongs to another fan');
    }
    if (result === -2) {
      throw new AppError('HOLD_LOCKED', 'This hold is already part of an order');
    }

    await this.publishReleased(record, 'CANCELLED_BY_USER');
    this.logger.log(`hold ${holdId} released by the fan`);
  }

  /** RES-4. Called by the Order Service through gRPC. */
  async lockHold(holdId: string, orderId: string, userId: string): Promise<LockResult> {
    const raw = await this.redis.get(this.holdKey(holdId));
    // The seat list is needed to build the KEYS; it is re-checked atomically in the script.
    const seats = raw ? (JSON.parse(raw) as HoldRecord) : undefined;
    const keys = seats ? this.seatKeys(seats) : [];

    const [outcome, encoded] = (await this.redis.eval(
      LOCK_HOLD,
      keys.length + 1,
      this.holdKey(holdId),
      ...keys,
      holdId,
      orderId,
      userId,
      String(Date.now()),
      String(this.lockSeconds * 1000),
      HOLDS_INDEX_KEY,
      this.refKey(holdId),
    )) as [LockOutcome, string];

    const record = encoded ? (JSON.parse(encoded) as HoldRecord) : undefined;
    if (outcome === 'OK') {
      this.logger.log(`hold ${holdId} locked by order ${orderId}`);
    }
    return { outcome, ...(record ? { record } : {}) };
  }

  /** RES-5. Publishes seat.released for every hold whose TTL ran out. Returns how many. */
  async sweepExpired(batchSize = 100): Promise<number> {
    const claimed = (await this.redis.eval(
      SWEEP_EXPIRED,
      0,
      HOLDS_INDEX_KEY,
      String(Date.now()),
      String(batchSize),
    )) as string[];

    for (const raw of claimed) {
      const record = JSON.parse(raw) as HoldRecord;
      try {
        await this.publishReleased(record, 'EXPIRED');
      } catch (error) {
        // Put it back so the next sweep retries the event instead of losing it.
        await this.redis
          .multi()
          .set(this.refKey(record.holdId), raw)
          .zadd(HOLDS_INDEX_KEY, Date.now(), record.holdId)
          .exec();
        throw error;
      }
    }
    if (claimed.length > 0) this.logger.log(`${claimed.length} expired hold(s) released`);
    return claimed.length;
  }

  /** RES-7, order.confirmed: the seats are now sold for good. */
  async consumeForOrder(holdId: string, orderId: string, eventId: string, seatIds: string[]): Promise<void> {
    const keys = seatIds.map((seatId) => this.seatKey(eventId, seatId));
    await this.redis.eval(
      CONSUME_HOLD,
      keys.length + 1,
      this.holdKey(holdId),
      ...keys,
      holdId,
      `sold:${orderId}`,
      HOLDS_INDEX_KEY,
      this.refKey(holdId),
    );
    this.logger.log(`hold ${holdId} consumed by order ${orderId}`);
  }

  /** RES-7, order.failed: give the seats back now instead of waiting for the TTL. */
  async releaseForFailedOrder(holdId: string): Promise<void> {
    const raw = await this.redis.get(this.holdKey(holdId));
    if (!raw) return; // already expired: the sweeper published seat.released
    const record = JSON.parse(raw) as HoldRecord;

    const released = (await this.redis.eval(
      RELEASE_FOR_ORDER,
      record.seatIds.length + 1,
      this.holdKey(holdId),
      ...this.seatKeys(record),
      holdId,
      HOLDS_INDEX_KEY,
      this.refKey(holdId),
    )) as number;

    if (released === 1) {
      await this.publishReleased(record, 'ORDER_FAILED');
      this.logger.log(`hold ${holdId} released after a failed order`);
    }
  }

  private async publishReleased(
    record: Pick<HoldRecord, 'holdId' | 'eventId' | 'seatIds'>,
    reason: ReleaseReason,
  ): Promise<void> {
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
