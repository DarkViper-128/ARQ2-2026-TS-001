#!/usr/bin/env node
/**
 * Generates infra/rabbitmq/definitions.json from the canonical topology in
 * libs/shared/src/events/topology.json, so the broker and the shared library can never drift.
 *
 * Run it after changing the topology:  npm run rabbitmq:definitions
 *
 * Retry design (docs/spec.md section 5):
 *   consumer queue --(nack, no requeue)--> flashtix.dlx --> <queue>.dlq
 *   consumer code  --(publish, rk = queue name)--> flashtix.retry.<tier>
 *                  --> flashtix.retry.<tier> queue (x-message-ttl)
 *                  --(expires, original routing key kept)--> flashtix.retry.return
 *                  --> back to that one consumer queue
 * The routing key is the queue name, so a retry never re-delivers the event to the
 * other consumers that already handled it successfully.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const topologyPath = resolve(here, '../../libs/shared/src/events/topology.json');
const outputPath = resolve(here, 'definitions.json');

const topology = JSON.parse(readFileSync(topologyPath, 'utf8'));
const vhost = topology.vhost;

const exchange = (name, type) => ({
  name,
  vhost,
  type,
  durable: true,
  auto_delete: false,
  internal: false,
  arguments: {},
});

const queue = (name, args) => ({
  name,
  vhost,
  durable: true,
  auto_delete: false,
  arguments: { 'x-queue-type': 'quorum', ...args },
});

const binding = (source, destination, routingKey) => ({
  source,
  vhost,
  destination,
  destination_type: 'queue',
  routing_key: routingKey,
  arguments: {},
});

const exchanges = [
  ...topology.domainExchanges.map((name) => exchange(name, 'topic')),
  ...topology.retryTiers.map((tier) => exchange(tier.exchange, 'topic')),
  exchange(topology.retryReturnExchange, 'direct'),
  exchange(topology.dlx, 'direct'),
];

const queues = [];
const bindings = [];

// One delay queue per retry tier, shared by every consumer queue.
for (const tier of topology.retryTiers) {
  queues.push(
    queue(tier.queue, {
      'x-message-ttl': tier.delayMs,
      // No x-dead-letter-routing-key on purpose: the original routing key
      // (the consumer queue name) must survive the delay.
      'x-dead-letter-exchange': topology.retryReturnExchange,
    }),
  );
  bindings.push(binding(tier.exchange, tier.queue, '#'));
}

// One queue (plus its DLQ) per consumer and event.
for (const event of topology.events) {
  for (const consumer of event.consumers) {
    const name = `${consumer}.${event.name}`;
    const dlq = `${name}.dlq`;

    queues.push(
      queue(name, {
        'x-dead-letter-exchange': topology.dlx,
        'x-dead-letter-routing-key': dlq,
      }),
      queue(dlq, {}),
    );

    bindings.push(
      binding(event.exchange, name, event.name),
      binding(topology.retryReturnExchange, name, name),
      binding(topology.dlx, dlq, dlq),
    );
  }
}

const definitions = {
  rabbit_version: '3.13.7',
  rabbitmq_version: '3.13.7',
  product_name: 'RabbitMQ',
  product_version: '3.13.7',
  // The vhost must be here, or the import fails with
  // "Please create virtual host / prior to importing definitions".
  vhosts: [{ name: vhost }],
  // No "users" or "permissions" sections on purpose: importing them would replace the
  // account that RABBITMQ_DEFAULT_USER creates from .env and leave the broker with no
  // way to log in. This file owns the topology, credentials stay in .env.
  parameters: [],
  global_parameters: [],
  policies: [],
  exchanges,
  queues,
  bindings,
};

writeFileSync(outputPath, `${JSON.stringify(definitions, null, 2)}\n`, 'utf8');

console.log(
  `definitions.json written: ${exchanges.length} exchanges, ${queues.length} queues, ${bindings.length} bindings`,
);
