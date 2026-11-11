import { randomUUID } from 'node:crypto';
import { getCorrelationId } from '../context/correlation';

/** Common envelope for every message on the bus (docs/spec.md section 5). */
export interface EventEnvelope<TData = Record<string, unknown>> {
  eventId: string;
  eventType: string;
  eventVersion: number;
  occurredAt: string;
  producer: string;
  correlationId: string;
  aggregateId: string;
  aggregateVersion?: number;
  data: TData;
}

export interface CreateEnvelopeInput<TData> {
  eventType: string;
  producer: string;
  aggregateId: string;
  data: TData;
  correlationId?: string;
  aggregateVersion?: number;
  eventVersion?: number;
  occurredAt?: Date;
}

/** Builds an envelope, reusing the correlation id of the current request when there is one. */
export function createEnvelope<TData>(input: CreateEnvelopeInput<TData>): EventEnvelope<TData> {
  return {
    eventId: randomUUID(),
    eventType: input.eventType,
    eventVersion: input.eventVersion ?? 1,
    occurredAt: (input.occurredAt ?? new Date()).toISOString(),
    producer: input.producer,
    correlationId: input.correlationId ?? getCorrelationId() ?? randomUUID(),
    aggregateId: input.aggregateId,
    ...(input.aggregateVersion !== undefined ? { aggregateVersion: input.aggregateVersion } : {}),
    data: input.data,
  };
}

export function isEnvelope(value: unknown): value is EventEnvelope {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<EventEnvelope>;
  return (
    typeof candidate.eventId === 'string' &&
    typeof candidate.eventType === 'string' &&
    typeof candidate.occurredAt === 'string' &&
    typeof candidate.correlationId === 'string' &&
    typeof candidate.aggregateId === 'string' &&
    typeof candidate.data === 'object'
  );
}

/** Parses a message body. Throws when it is not a valid envelope, so it goes to the DLQ. */
export function parseEnvelope<TData>(body: Buffer | string): EventEnvelope<TData> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(typeof body === 'string' ? body : body.toString('utf8'));
  } catch {
    throw new Error('Message body is not valid JSON');
  }
  if (!isEnvelope(parsed)) {
    throw new Error('Message body is not a valid FlashTix event envelope');
  }
  return parsed as EventEnvelope<TData>;
}
