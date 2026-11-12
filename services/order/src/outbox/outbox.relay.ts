import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import type { EventEnvelope, EventPublisher } from '@flashtix/shared';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { EVENT_PUBLISHER, MYSQL } from '../tokens';

/**
 * ORD-4. Publishes the outbox to RabbitMQ.
 *
 * - `FOR UPDATE SKIP LOCKED`: several Order Service replicas can run the relay at once;
 *   each one takes rows the others are not working on, so no event is sent twice by two
 *   replicas at the same moment.
 * - Publisher confirms: a row is marked as published only after the broker acknowledged it.
 *   A crash between the confirm and the UPDATE re-sends the event with the SAME eventId,
 *   and consumers discard it through processed_events. Delivery is at-least-once.
 * - Order: rows go out oldest first; on the first failure the batch stops so a later event
 *   of the same order is never published before an earlier one.
 */
@Injectable()
export class OutboxRelay implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxRelay.name);
  private readonly intervalMs = Number(process.env.OUTBOX_POLL_INTERVAL_MS ?? 250);
  private readonly batchSize = Number(process.env.OUTBOX_BATCH_SIZE ?? 50);
  private timer?: NodeJS.Timeout;
  private running = false;
  private again = false;

  constructor(
    @Inject(MYSQL) private readonly pool: Pool,
    @Inject(EVENT_PUBLISHER) private readonly publisher: EventPublisher,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => this.kick(), this.intervalMs);
  }

  /** Runs a pass now (called right after a commit so events leave without waiting). */
  kick(): void {
    if (this.running) {
      this.again = true;
      return;
    }
    void this.drain();
  }

  private async drain(): Promise<void> {
    this.running = true;
    try {
      do {
        this.again = false;
        while ((await this.publishBatch()) === this.batchSize) {
          // a full batch means there may be more waiting
        }
      } while (this.again);
    } catch (error) {
      this.logger.error(`outbox relay failed: ${String(error)}`);
    } finally {
      this.running = false;
    }
  }

  private async publishBatch(): Promise<number> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.query<RowDataPacket[]>(
        `SELECT event_id, envelope FROM outbox
          WHERE published_at IS NULL
          ORDER BY created_at
          LIMIT ? FOR UPDATE SKIP LOCKED`,
        [this.batchSize],
      );

      const published: string[] = [];
      let failure: { eventId: string; error: unknown } | undefined;
      for (const row of rows) {
        const envelope = (typeof row.envelope === 'string' ? JSON.parse(row.envelope) : row.envelope) as EventEnvelope;
        try {
          await this.publisher.publishEnvelope(envelope);
          published.push(row.event_id as string);
        } catch (error) {
          failure = { eventId: row.event_id as string, error };
          break;
        }
      }

      if (published.length > 0) {
        await connection.query(
          'UPDATE outbox SET published_at = CURRENT_TIMESTAMP(3), attempts = attempts + 1 WHERE event_id IN (?)',
          [published],
        );
      }
      if (failure) {
        await connection.execute(
          'UPDATE outbox SET attempts = attempts + 1, last_error = ? WHERE event_id = ?',
          [String(failure.error).slice(0, 255), failure.eventId],
        );
      }
      await connection.commit();

      if (failure) throw failure.error;
      return rows.length;
    } catch (error) {
      await connection.rollback().catch(() => undefined);
      throw error;
    } finally {
      connection.release();
    }
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
