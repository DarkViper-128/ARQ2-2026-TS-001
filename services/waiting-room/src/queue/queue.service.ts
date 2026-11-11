import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { AppError, signAdmissionToken } from '@flashtix/shared';
import type Redis from 'ioredis';
import { REDIS } from '../tokens';
import { CatalogClient } from './catalog.client';

/**
 * Joins the queue atomically. A fan has at most one ticket per event, so a refresh or a
 * double click returns the same place in line instead of a new one at the end.
 *
 * KEYS  [1] user key [2] queue zset [3] sequence [4] opened-at
 * ARGV  [1] new ticket id [2] now ms [3] ticket key [4] eventId [5] userId [6] ttl seconds
 *
 * Returns { ticketId, created (1/0) }.
 */
const JOIN_QUEUE = `
local existing = redis.call('GET', KEYS[1])
if existing then
  return { existing, 0 }
end
local seq = redis.call('INCR', KEYS[3])
redis.call('ZADD', KEYS[2], seq, ARGV[1])
redis.call('SET', KEYS[1], ARGV[1], 'EX', tonumber(ARGV[6]))
redis.call('HSET', ARGV[3], 'queueTicketId', ARGV[1], 'eventId', ARGV[4], 'userId', ARGV[5], 'joinedAt', ARGV[2])
redis.call('EXPIRE', ARGV[3], tonumber(ARGV[6]))
redis.call('SET', KEYS[4], ARGV[2], 'NX', 'EX', tonumber(ARGV[6]))
redis.call('EXPIRE', KEYS[2], tonumber(ARGV[6]))
redis.call('EXPIRE', KEYS[3], tonumber(ARGV[6]))
return { ARGV[1], 1 }
`;

export type QueueStatus = 'WAITING' | 'ADMITTED';

export interface QueueView {
  queueTicketId: string;
  eventId: string;
  position: number;
  status: QueueStatus;
  estimatedWaitSeconds?: number;
  pollAfterSeconds?: number;
  admissionToken?: string;
  admissionExpiresAt?: string;
}

interface TicketRecord {
  queueTicketId: string;
  eventId: string;
  userId: string;
  joinedAt: string;
  admittedAt?: string;
}

/**
 * WR-2 to WR-5. Virtual queue kept in hold-store (ADR 001: sorted set per event).
 *
 * Admission is computed, not pushed: since the queue opened, a new batch of
 * `ADMISSION_BATCH_SIZE` positions is admitted every `ADMISSION_INTERVAL_MS`. Every replica
 * gets the same answer from the same two numbers, so there is no background job and no
 * coordination between replicas.
 */
@Injectable()
export class QueueService {
  private readonly logger = new Logger(QueueService.name);
  private readonly batchSize = Number(process.env.ADMISSION_BATCH_SIZE ?? 500);
  private readonly intervalMs = Number(process.env.ADMISSION_INTERVAL_MS ?? 10_000);
  private readonly tokenTtlSeconds = Number(process.env.ADMISSION_TOKEN_TTL_SECONDS ?? 600);
  private readonly secret = process.env.ADMISSION_TOKEN_SECRET ?? '';
  /** Queue keys outlive any sale; they are only a safety net against leftovers. */
  private readonly keyTtlSeconds = 24 * 3600;

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    private readonly catalog: CatalogClient,
  ) {}

  private queueKey(eventId: string): string {
    return `queue:${eventId}`;
  }

  private ticketKey(ticketId: string): string {
    return `queue-ticket:${ticketId}`;
  }

  /** WR-5: the queue only exists while the event is on sale. */
  private async assertSaleOpen(eventId: string): Promise<void> {
    const event = await this.catalog.getEvent(eventId);
    if (event.status !== 'ON_SALE' || new Date(event.saleStartsAt).getTime() > Date.now()) {
      throw new AppError('SALE_NOT_OPEN', `Event ${eventId} is not on sale (status ${event.status})`);
    }
  }

  /** WR-2. POST /events/{eventId}/queue. */
  async join(eventId: string, userId: string): Promise<QueueView> {
    await this.assertSaleOpen(eventId);

    const candidate = randomUUID();
    const [ticketId, created] = (await this.redis.eval(
      JOIN_QUEUE,
      4,
      `queue-user:${eventId}:${userId}`,
      this.queueKey(eventId),
      `queue:${eventId}:seq`,
      `queue:${eventId}:opened-at`,
      candidate,
      String(Date.now()),
      this.ticketKey(candidate),
      eventId,
      userId,
      String(this.keyTtlSeconds),
    )) as [string, number];

    if (created === 1) this.logger.log(`fan joined the queue of ${eventId}`);
    return this.view(ticketId, eventId, userId);
  }

  /** WR-3. GET /events/{eventId}/queue/{queueTicketId}. */
  async status(eventId: string, ticketId: string, userId: string): Promise<QueueView> {
    return this.view(ticketId, eventId, userId);
  }

  /** WR-4: how many positions are admitted right now. */
  private admittedCount(openedAtMs: number, nowMs: number): number {
    const batches = Math.floor(Math.max(0, nowMs - openedAtMs) / this.intervalMs) + 1;
    return batches * this.batchSize;
  }

  private async view(ticketId: string, eventId: string, userId: string): Promise<QueueView> {
    const record = (await this.redis.hgetall(this.ticketKey(ticketId))) as unknown as TicketRecord;
    // Another fan's ticket answers exactly like a missing one: no information leaks.
    if (!record.queueTicketId || record.eventId !== eventId || record.userId !== userId) {
      throw new AppError('QUEUE_TICKET_NOT_FOUND', `Queue ticket ${ticketId} does not exist`);
    }

    const now = Date.now();
    const [rank, openedAt] = await Promise.all([
      this.redis.zrank(this.queueKey(eventId), ticketId),
      this.redis.get(`queue:${eventId}:opened-at`),
    ]);
    if (rank === null || !openedAt) {
      throw new AppError('QUEUE_TICKET_NOT_FOUND', `Queue ticket ${ticketId} does not exist`);
    }

    const position = rank + 1;
    const admitted = this.admittedCount(Number(openedAt), now);

    if (rank >= admitted) {
      const batchesAhead = Math.ceil((position - admitted) / this.batchSize);
      return {
        queueTicketId: ticketId,
        eventId,
        position,
        status: 'WAITING',
        estimatedWaitSeconds: Math.ceil((batchesAhead * this.intervalMs) / 1000),
        pollAfterSeconds: Math.max(1, Math.min(10, Math.ceil(this.intervalMs / 1000))),
      };
    }

    // First time the fan is seen as admitted: the token window starts now, once.
    await this.redis.hsetnx(this.ticketKey(ticketId), 'admittedAt', String(now));
    const admittedAt = Number((await this.redis.hget(this.ticketKey(ticketId), 'admittedAt')) ?? now);
    const expiresAt = admittedAt + this.tokenTtlSeconds * 1000;
    if (expiresAt <= now) {
      // Free the fan's slot so POST /queue gives them a new ticket at the end of the line.
      await this.redis
        .multi()
        .del(`queue-user:${eventId}:${userId}`)
        .zrem(this.queueKey(eventId), ticketId)
        .del(this.ticketKey(ticketId))
        .exec();
      throw new AppError('QUEUE_TICKET_EXPIRED', 'The admission window is over; join the queue again');
    }

    const admissionToken = signAdmissionToken(
      {
        sub: userId,
        eventId,
        queueTicketId: ticketId,
        iat: Math.floor(admittedAt / 1000),
        exp: Math.floor(expiresAt / 1000),
      },
      this.secret,
    );

    return {
      queueTicketId: ticketId,
      eventId,
      position,
      status: 'ADMITTED',
      admissionToken,
      admissionExpiresAt: new Date(expiresAt).toISOString(),
    };
  }
}
