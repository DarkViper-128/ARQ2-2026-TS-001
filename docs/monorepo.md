# Monorepo layout (Wave 2)

How the source code of FlashTix is organised, how a service reuses the shared library and
how an image is built. Read this before creating a new service.

The Wave 2 guidelines require the code of the microservices, the API Gateway and
`docker-compose.yml` to live at the root of this repository, next to `docs/`.

## Layout

```text
.
├── package.json          # npm workspaces root; no application code lives here
├── tsconfig.base.json    # compiler options every package extends
├── docker-compose.yml
├── libs/
│   └── shared/           # @flashtix/shared - used by every service
├── services/             # the seven microservices (added from Phase 1 on)
├── tools/
│   └── payment-gateway-mock/   # stand-in for the legacy gateway (INF-5)
├── infra/
│   └── rabbitmq/         # broker configuration and generated topology
├── proto/                # gRPC contracts between services
└── docs/
```

A package is a workspace when it sits in `libs/*`, `services/*` or `tools/*` and has its
own `package.json`. Nothing else needs to be registered.

## Why npm workspaces

The team already has npm with Node 20, so there is no extra tool to install, and
`npm install` at the root links `@flashtix/shared` into every service automatically.
pnpm is faster and Nx adds caching, but neither pays for itself on seven services, and
both would add a tool that every member has to install before they can build anything.

## Everyday commands

Always run these from the repository root.

```bash
npm install                      # install everything and link the workspaces
npm run build                    # build every package
npm run build -w @flashtix/shared   # build just one
npm run rabbitmq:definitions     # regenerate infra/rabbitmq/definitions.json
```

## Creating a new service

1. `mkdir -p services/<name>/src`
2. Add `services/<name>/package.json` with the name `@flashtix/<name>` and
   `"@flashtix/shared": "0.1.0"` as a dependency.
3. Add `services/<name>/tsconfig.json`:

   ```json
   {
     "extends": "../../tsconfig.base.json",
     "compilerOptions": { "rootDir": "src", "outDir": "dist" },
     "include": ["src/**/*"]
   }
   ```

4. Run `npm install` at the root so the workspace is linked.
5. Copy `tools/payment-gateway-mock/Dockerfile` and change the two package paths.
6. Add the service to `docker-compose.yml` with `build.context: .` (see below).

## The Dockerfile rule

**The build context is always the repository root, never the service folder.**

```yaml
build:
  context: .
  dockerfile: services/<name>/Dockerfile
```

A `Dockerfile` cannot `COPY` anything above its build context, so a context of
`services/<name>` could never reach `libs/shared` and the image would fail to build.
Setting the context to the root is what makes the shared library reachable.

The Dockerfile copies the manifests first and runs `npm ci` before copying the sources,
so Docker reuses the cached dependency layer while only application code changes. The
runtime stage reinstalls with `--omit=dev` and copies only the compiled `dist` folders.

`.dockerignore` at the root keeps `node_modules`, `dist`, `docs/` and `.git` out of the
build context, which keeps image builds fast.

## The shared library

`@flashtix/shared` holds what every service needs and nobody should write twice
(INF-7 and INF-8).

| Module | What it gives you |
| --- | --- |
| `createEnvelope`, `parseEnvelope` | The common event envelope of `spec.md` section 5 |
| `EventPublisher` | Publishing with **publisher confirms**: `publish()` resolves only after the broker acknowledges, which is what makes the outbox relay safe |
| `EventConsumer` | Idempotent consumption with the 1 s / 10 s / 60 s retry ladder and dead-lettering |
| `claimEvent`, `MySqlProcessedEvents`, `PROCESSED_EVENTS_DDL` | The `processed_events` table that makes a repeated delivery harmless |
| `AppError`, `toProblemDetails` | `application/problem+json` errors with the exact codes listed in `spec.md` |
| `correlationIdMiddleware`, `getCorrelationId` | One correlation id from the HTTP request through to every event it produces |
| `queueName`, `queuesFor`, `exchangeForEvent` | Queue and exchange names derived from the topology, so no service hard-codes a string |

Example consumer:

```ts
import { EventConsumer, MySqlProcessedEvents, queueName } from '@flashtix/shared';

await EventConsumer.start({
  url: process.env.RABBITMQ_URL!,
  queue: queueName('catalog', 'seat.held'),
  consumer: 'catalog',
  processedEvents: new MySqlProcessedEvents(pool),
  handler: async (envelope) => {
    await markSeatsHeld(envelope.data);
  },
});
```

Example publisher:

```ts
import { EventPublisher } from '@flashtix/shared';

const publisher = await EventPublisher.connect({
  url: process.env.RABBITMQ_URL!,
  producer: 'order',
});

await publisher.publish({
  eventType: 'order.confirmed',
  aggregateId: order.orderId,
  aggregateVersion: order.version,
  data: { orderId: order.orderId, seats: order.seats },
});
```

The exchange is not passed in: it is looked up in the topology from the event name, and an
unknown event name throws instead of silently publishing nowhere.

## Adding an event

The topology lives in exactly one file: `libs/shared/src/events/topology.json`.

1. Add the event with its exchange, producer and consumers.
2. Run `npm run rabbitmq:definitions`.
3. Commit both the topology and the regenerated `infra/rabbitmq/definitions.json`.
4. Update the event table in [`spec.md`](spec.md) in the same pull request.

Services never declare exchanges or queues at runtime; the broker imports them at boot.
That way a typo cannot create a stray queue that silently swallows events.
