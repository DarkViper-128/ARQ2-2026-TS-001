import { createEnvelope, type EventEnvelope } from '@flashtix/shared';
import type { Pool, PoolConnection } from 'mysql2/promise';

/** Runs `work` in one MySQL transaction and always releases the connection. */
export async function inTransaction<T>(pool: Pool, work: (connection: PoolConnection) => Promise<T>): Promise<T> {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await work(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback().catch(() => undefined);
    throw error;
  } finally {
    connection.release();
  }
}

export interface OutboxEvent<TData> {
  eventType: string;
  aggregateId: string;
  aggregateVersion: number;
  data: TData;
}

/**
 * Writes an event to the outbox inside the caller's transaction (ADR 003). If the business
 * change rolls back, the event disappears with it; if it commits, the relay publishes it.
 * That is what makes "save the order AND publish the event" atomic without a distributed
 * transaction.
 */
export async function addToOutbox<TData>(
  connection: PoolConnection,
  event: OutboxEvent<TData>,
): Promise<EventEnvelope<TData>> {
  const envelope = createEnvelope<TData>({ ...event, producer: 'order' });
  await connection.execute(
    'INSERT INTO outbox (event_id, event_type, aggregate_id, envelope) VALUES (?, ?, ?, ?)',
    [envelope.eventId, envelope.eventType, envelope.aggregateId, JSON.stringify(envelope)],
  );
  return envelope;
}
