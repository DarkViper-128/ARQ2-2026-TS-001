/**
 * Idempotency support for consumers (docs/spec.md section 5: "consumers save the eventId
 * and ignore repeats"). Delivery is at-least-once, so every consumer MUST use this.
 */

/** Table every service that consumes events has to create in its own database. */
export const PROCESSED_EVENTS_DDL = `
CREATE TABLE IF NOT EXISTS processed_events (
  consumer     VARCHAR(64) NOT NULL,
  event_id     CHAR(36)    NOT NULL,
  processed_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (consumer, event_id)
) ENGINE=InnoDB;`;

export interface ProcessedEvents {
  isProcessed(consumer: string, eventId: string): Promise<boolean>;
  markProcessed(consumer: string, eventId: string): Promise<void>;
}

/** Anything that can run a parameterised query: a mysql2 pool, connection or transaction. */
export interface QueryExecutor {
  execute(sql: string, values?: unknown[]): Promise<unknown>;
}

/**
 * Preferred pattern: claim the event inside the SAME transaction as the business write.
 * Returns `false` when the event was already processed, so the handler can stop.
 *
 * ```ts
 * await connection.beginTransaction();
 * if (!(await claimEvent(connection, 'order', envelope.eventId))) {
 *   await connection.rollback();
 *   return;
 * }
 * // ... business write ...
 * await connection.commit();
 * ```
 */
export async function claimEvent(
  executor: QueryExecutor,
  consumer: string,
  eventId: string,
): Promise<boolean> {
  const result = (await executor.execute(
    'INSERT IGNORE INTO processed_events (consumer, event_id) VALUES (?, ?)',
    [consumer, eventId],
  )) as [{ affectedRows?: number }, unknown];
  const header = Array.isArray(result) ? result[0] : (result as { affectedRows?: number });
  return (header?.affectedRows ?? 0) > 0;
}

/** MySQL implementation, for consumers that cannot share the business transaction. */
export class MySqlProcessedEvents implements ProcessedEvents {
  constructor(private readonly executor: QueryExecutor) {}

  async isProcessed(consumer: string, eventId: string): Promise<boolean> {
    const result = (await this.executor.execute(
      'SELECT 1 FROM processed_events WHERE consumer = ? AND event_id = ? LIMIT 1',
      [consumer, eventId],
    )) as [unknown[], unknown];
    const rows = Array.isArray(result) ? result[0] : [];
    return Array.isArray(rows) && rows.length > 0;
  }

  async markProcessed(consumer: string, eventId: string): Promise<void> {
    await this.executor.execute(
      'INSERT IGNORE INTO processed_events (consumer, event_id) VALUES (?, ?)',
      [consumer, eventId],
    );
  }
}

/** For unit tests and local experiments. Not for production use. */
export class InMemoryProcessedEvents implements ProcessedEvents {
  private readonly seen = new Set<string>();

  async isProcessed(consumer: string, eventId: string): Promise<boolean> {
    return this.seen.has(`${consumer}:${eventId}`);
  }

  async markProcessed(consumer: string, eventId: string): Promise<void> {
    this.seen.add(`${consumer}:${eventId}`);
  }
}
