import * as amqp from 'amqplib';
import { runWithCorrelationId } from '../context/correlation';
import { parseEnvelope, type EventEnvelope } from './envelope';
import type { ProcessedEvents } from './processed-events';
import { RETRY_TIERS } from './topology';

/** Header used to carry the retry counter across the delay queues. */
export const ATTEMPT_HEADER = 'x-flashtix-attempt';

export interface ConsumerContext {
  /** 0 on the first delivery, 1 after the first retry, and so on. */
  attempt: number;
  queue: string;
  raw: amqp.ConsumeMessage;
}

export type EventHandler<TData = Record<string, unknown>> = (
  envelope: EventEnvelope<TData>,
  context: ConsumerContext,
) => Promise<void>;

export interface ConsumerOptions<TData = Record<string, unknown>> {
  url: string;
  /** Queue to consume, built with `queueName(consumer, eventType)`. */
  queue: string;
  /** Service name, used as the `consumer` column of `processed_events`. */
  consumer: string;
  handler: EventHandler<TData>;
  /**
   * Skips events already recorded. Optional only when the handler claims the event
   * itself inside its own transaction with `claimEvent()`.
   */
  processedEvents?: ProcessedEvents;
  /** Unacked messages in flight. Default 10. */
  prefetch?: number;
  /** Total deliveries before the message goes to the DLQ. Default 3, as in spec.md. */
  maxAttempts?: number;
  /** Called when a message is dead-lettered, so the service can raise an alert. */
  onDeadLetter?: (envelope: EventEnvelope<TData> | undefined, error: unknown) => void;
}

/**
 * Idempotent consumer with the retry ladder of docs/spec.md section 5:
 * 3 attempts with 1 s, 10 s and 60 s of backoff, then dead-letter queue.
 *
 * A failed message is republished to a delay exchange with the queue name as routing key;
 * when its TTL expires the broker returns it to this exact queue, so the other consumers
 * of the same event are never disturbed.
 */
export class EventConsumer {
  private constructor(
    private readonly connection: amqp.ChannelModel,
    private readonly channel: amqp.Channel,
  ) {}

  static async start<TData>(options: ConsumerOptions<TData>): Promise<EventConsumer> {
    const maxAttempts = options.maxAttempts ?? 3;
    const connection = await amqp.connect(options.url);
    const channel = await connection.createChannel();
    await channel.prefetch(options.prefetch ?? 10);

    await channel.consume(options.queue, (message) => {
      if (!message) return;
      void EventConsumer.handle(channel, message, options, maxAttempts);
    });

    return new EventConsumer(connection, channel);
  }

  private static async handle<TData>(
    channel: amqp.Channel,
    message: amqp.ConsumeMessage,
    options: ConsumerOptions<TData>,
    maxAttempts: number,
  ): Promise<void> {
    const attempt = Number(message.properties.headers?.[ATTEMPT_HEADER] ?? 0);
    let envelope: EventEnvelope<TData> | undefined;

    try {
      envelope = parseEnvelope<TData>(message.content);

      if (options.processedEvents) {
        const seen = await options.processedEvents.isProcessed(options.consumer, envelope.eventId);
        if (seen) {
          channel.ack(message);
          return;
        }
      }

      const current = envelope;
      await runWithCorrelationId(current.correlationId, () =>
        options.handler(current, { attempt, queue: options.queue, raw: message }),
      );

      await options.processedEvents?.markProcessed(options.consumer, current.eventId);
      channel.ack(message);
    } catch (error) {
      const nextAttempt = attempt + 1;

      if (nextAttempt >= maxAttempts) {
        // No retries left: reject without requeue so the broker routes it to <queue>.dlq.
        options.onDeadLetter?.(envelope, error);
        channel.nack(message, false, false);
        return;
      }

      const tier = RETRY_TIERS[attempt] ?? RETRY_TIERS[RETRY_TIERS.length - 1]!;
      channel.publish(tier.exchange, options.queue, message.content, {
        ...message.properties,
        persistent: true,
        headers: { ...message.properties.headers, [ATTEMPT_HEADER]: nextAttempt },
      });
      channel.ack(message);
    }
  }

  async close(): Promise<void> {
    await this.channel.close();
    await this.connection.close();
  }
}
