import * as amqp from 'amqplib';
import { createEnvelope, type CreateEnvelopeInput, type EventEnvelope } from './envelope';
import { exchangeForEvent } from './topology';

export interface PublisherOptions {
  /** `amqp://user:pass@rabbitmq:5672`. */
  url: string;
  /** Service name written into every envelope, for example `order`. */
  producer: string;
}

export type PublishInput<TData> = Omit<CreateEnvelopeInput<TData>, 'producer'>;

/**
 * Publishes domain events with **publisher confirms**: `publish()` only resolves once the
 * broker has acknowledged the message, so the outbox relay can safely mark it as sent.
 *
 * The topology is owned by infra/rabbitmq/definitions.json; this class never declares it.
 */
export class EventPublisher {
  private constructor(
    private readonly connection: amqp.ChannelModel,
    private readonly channel: amqp.ConfirmChannel,
    private readonly producer: string,
  ) {}

  static async connect(options: PublisherOptions): Promise<EventPublisher> {
    const connection = await amqp.connect(options.url);
    const channel = await connection.createConfirmChannel();
    return new EventPublisher(connection, channel, options.producer);
  }

  /** Builds the envelope and publishes it. Resolves after the broker confirm. */
  async publish<TData>(input: PublishInput<TData>): Promise<EventEnvelope<TData>> {
    const envelope = createEnvelope<TData>({ ...input, producer: this.producer });
    await this.publishEnvelope(envelope);
    return envelope;
  }

  /** Publishes an envelope that already exists, for example one read from the outbox table. */
  async publishEnvelope<TData>(envelope: EventEnvelope<TData>): Promise<void> {
    const exchange = exchangeForEvent(envelope.eventType);
    const body = Buffer.from(JSON.stringify(envelope), 'utf8');

    await new Promise<void>((resolve, reject) => {
      this.channel.publish(
        exchange,
        envelope.eventType,
        body,
        {
          persistent: true,
          contentType: 'application/json',
          messageId: envelope.eventId,
          correlationId: envelope.correlationId,
          type: envelope.eventType,
          appId: envelope.producer,
          timestamp: Math.floor(new Date(envelope.occurredAt).getTime() / 1000),
        },
        (error) => (error ? reject(error) : resolve()),
      );
    });
  }

  async close(): Promise<void> {
    await this.channel.close();
    await this.connection.close();
  }
}
