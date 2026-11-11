import rawTopology from './topology.json';

export interface RetryTier {
  exchange: string;
  queue: string;
  delayMs: number;
}

export interface EventDefinition {
  /** Routing key, for example `order.confirmed`. */
  name: string;
  /** Topic exchange that owns the event. */
  exchange: string;
  /** Service allowed to publish it. */
  producer: string;
  /** Services that get their own queue for it. */
  consumers: string[];
}

export interface Topology {
  vhost: string;
  dlx: string;
  retryReturnExchange: string;
  retryTiers: RetryTier[];
  domainExchanges: string[];
  events: EventDefinition[];
}

/** Canonical topology, mirrored by infra/rabbitmq/definitions.json. */
export const TOPOLOGY: Topology = rawTopology as unknown as Topology;

export const DLX = TOPOLOGY.dlx;
export const RETRY_RETURN_EXCHANGE = TOPOLOGY.retryReturnExchange;
export const RETRY_TIERS: readonly RetryTier[] = TOPOLOGY.retryTiers;

/** Every event name, as a typed lookup: `EVENTS['order.confirmed']`. */
export const EVENTS: Readonly<Record<string, EventDefinition>> = Object.freeze(
  Object.fromEntries(TOPOLOGY.events.map((event) => [event.name, event])),
);

/** Queue that receives `eventType` for `consumer`. Naming rule: `<consumer>.<event>`. */
export function queueName(consumer: string, eventType: string): string {
  return `${consumer}.${eventType}`;
}

/** Dead-letter queue of a consumer queue. */
export function deadLetterQueueName(queue: string): string {
  return `${queue}.dlq`;
}

/** Exchange an event must be published to. Throws when the event is not in the topology. */
export function exchangeForEvent(eventType: string): string {
  const event = EVENTS[eventType];
  if (!event) {
    throw new Error(
      `Unknown event "${eventType}". Add it to libs/shared/src/events/topology.json and regenerate ` +
        'infra/rabbitmq/definitions.json with "npm run rabbitmq:definitions".',
    );
  }
  return event.exchange;
}

/** All queues a service must consume from. */
export function queuesFor(consumer: string): string[] {
  return TOPOLOGY.events
    .filter((event) => event.consumers.includes(consumer))
    .map((event) => queueName(consumer, event.name));
}
