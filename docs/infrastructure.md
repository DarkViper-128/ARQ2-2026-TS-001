# Local infrastructure (Wave 2 - Phases 0 and 1)

How to run the base infrastructure of FlashTix on a developer machine with Docker Compose.
It implements the data and messaging containers of the
[C4 Level 2 diagram](assets/c4-container-diagram.jpg), following
[ADR 001](adrs/001-use-of-redis.md) (two Redis instances) and
[ADR 003](adrs/003-async-payments-rabbitmq.md) (RabbitMQ), plus everything the services
need in order to be built and demoed: object storage, a mail catcher and a stand-in for
the legacy payment gateway.

The microservices, the API Gateway and the observability stack are added in later phases.
For the code layout and how to create a service, see [monorepo.md](monorepo.md).

## Requirements

- Docker Desktop (includes Docker Compose v2). Check with `docker --version` and `docker compose version`.
- Docker Desktop must be running before any `docker compose` command.
- Node.js 20 or newer, only if you want to build the code outside Docker.
- Free ports: `1025`, `3001`-`3005`, `3307`-`3311`, `5672`, `6379`, `6380`, `8000`, `8001`, `8025`, `8080`, `8090`, `9000`, `9090`, `15672`.
- About 6 GB of free RAM when everything is up.

## Quick start

```bash
cp .env.example .env      # Windows PowerShell: copy .env.example .env
# edit .env and replace every "change-me"
docker compose up -d --build
docker compose ps         # every service must be "healthy"
```

The first start downloads the images and builds the payment gateway mock, so it can take
several minutes. Later starts take seconds.

`rabbitmq-init` and `ticket-files-init` are one-shot containers: they set up the broker
topology and the S3 bucket and then exit, so seeing them as `exited (0)` is the expected
result, not a failure.

Stop everything (data is kept in volumes):

```bash
docker compose down
```

Stop and **delete all data** (databases, holds, queues, ticket files):

```bash
docker compose down -v
```

## Configuration

Credentials live in `.env`, which is ignored by Git. `.env.example` is the template that is committed.

| Variable | Used by | Description |
| --- | --- | --- |
| `MYSQL_ROOT_PASSWORD` | the five MySQL databases | Root password shared by every MySQL server |
| `RABBITMQ_USER` / `RABBITMQ_PASSWORD` | `rabbitmq` | Broker credentials |
| `TICKET_BUCKET` | `ticket-files-init` | S3 bucket created at startup for the ticket PDFs |
| `KEYCLOAK_ADMIN` / `KEYCLOAK_ADMIN_PASSWORD` | `keycloak` | Admin console at <http://localhost:8080> |
| `MOCK_LATENCY_MIN_MS` / `MOCK_LATENCY_MAX_MS` | `payment-gateway-mock` | Simulated gateway latency. The real one takes up to 15 s |
| `MOCK_DECLINE_RATE` / `MOCK_ERROR_RATE` / `MOCK_TIMEOUT_RATE` | `payment-gateway-mock` | Share of charges that are declined, fail or never answer |

Use values without spaces, quotes or `$`. MySQL stores the root password the first time its volume is created, so if you change
`MYSQL_ROOT_PASSWORD` later you must recreate the volumes with `docker compose down -v`.

## Services

| Service | Image | Host port | C4 container | Purpose |
| --- | --- | --- | --- | --- |
| `catalog-db` | `mysql:8.4` | 3307 | `catalog-db` | Events, venues, seats and prices (Catalog Service) |
| `booking-db` | `mysql:8.4` | 3308 | `booking-db` | Orders, outbox and `sold_seats` (Order Service) |
| `payment-db` | `mysql:8.4` | 3309 | `payment-db` | Payments, unique per `orderId` (Payment Worker) |
| `ticket-db` | `mysql:8.4` | 3310 | `ticket-db` | Issued tickets (Ticket Service) |
| `notification-db` | `mysql:8.4` | 3311 | `notification-db` | Email and push deduplication (Notification Worker) |
| `catalog-cache` | `redis:7-alpine` | 6379 | `catalog-cache` | Read model of the catalog and availability. LRU, no persistence |
| `hold-store` | `redis:7-alpine` | 6380 | `hold-store` | Seat holds (`SET NX EX 600`) and virtual queue. AOF, `noeviction` |
| `rabbitmq` | `rabbitmq:3.13-management-alpine` | 5672 (AMQP), 15672 (UI) | Message Broker | Events between services |
| `rabbitmq-init` | `rabbitmq:3.13-management-alpine` | - | - | Imports the topology once the broker is healthy, then exits |
| `ticket-files` | `adobe/s3mock:3.12.0` | 9090 (S3) | `ticket-files` | S3 storage for the ticket PDFs |
| `ticket-files-init` | `adobe/s3mock:3.12.0` | - | - | Creates the bucket once and exits |
| `mailpit` | `axllent/mailpit:v1.21` | 1025 (SMTP), 8025 (UI) | - | Catches the emails of the Notification Worker. Nothing leaves the machine |
| `payment-gateway-mock` | built from `tools/` | 8090 | Payment Gateway (external) | Stand-in for the legacy gateway |
| `keycloak` | `quay.io/keycloak/keycloak:26.0` | 8080, 9000 | Identity Provider | Realm `flashtix`, roles FAN and ORGANIZER |
| `api-gateway` | `kong:3.8` | 8000 (proxy), 8001 (admin) | API Gateway | Single entry point, validates the JWT |
| `catalog` | built from `services/catalog` | 3001 | Catalog Service | Events and seat availability, read-only |
| `reservation` | built from `services/reservation` | 3002 | Reservation Service | Soft seat holds with TTL |
| `order` | built from `services/order` | 3003 | Order Service | Checkout saga and source of truth for every sale |
| `waiting-room` | built from `services/waiting-room` | 3004 | Waiting Room Service | Virtual queue and admission tokens |
| `payment-worker` | built from `services/payment-worker` | 3005 (health only) | Payment Worker | Charges and refunds against the legacy gateway |

The Reservation Service also listens on `50051` for the `LockHold` gRPC call of the Order
Service. That port is internal to `flashtix-net`: it is not published and Kong does not route it.

`booking-db` and `payment-db` load their schemas from `infra/mysql/booking` and
`infra/mysql/payment` the first time their volume is created. If you already had those volumes
from Phase 0 or 1, recreate them once so the schemas are applied:
`docker compose rm -sf booking-db payment-db && docker volume rm flashtix_booking-db-data flashtix_payment-db-data`,
then `docker compose up -d`.

All services share the network `flashtix-net`, so containers reach each other by service name
(for example `hold-store:6379`, `rabbitmq:5672`). The host ports above are only for tools running on your machine.
Every long-running service has a `healthcheck`, so later services can wait for them with `depends_on: condition: service_healthy`.

The five MySQL services share one YAML anchor (`x-mysql`), so a change to the image or the
healthcheck is made once instead of five times.

### Why two Redis instances (ADR 001)

| Instance | Eviction policy | Persistence | Reason |
| --- | --- | --- | --- |
| `catalog-cache` | `allkeys-lru` | none | A cache can drop old entries when it is full and be rebuilt from MySQL |
| `hold-store` | `noeviction` | AOF, `everysec` | A hold must never be dropped: if it disappeared, the seat would look free while someone is paying. With AOF a restart loses at most 1 second |

### Object storage: an S3 stand-in instead of MinIO

The Tech Spec, the C4 diagram and `spec.md` name **MinIO** as the object store. MinIO no
longer publishes a community image that can be pulled without credentials
(`docker pull minio/minio` fails with *pull access denied*), and the same is now true of
`bitnami/minio`. SeaweedFS was tried next but its master node failed to elect a leader
reliably on restart, which is not something the team should have to debug.

The compose therefore uses **`adobe/s3mock`**: it speaks the S3 API, starts in about a
second and needs no configuration. The compose service is called `ticket-files`, not
`minio`, precisely so the architecture does not depend on the vendor.

**Two things the team has to decide:**

1. Whether this is acceptable for the demo. It is a stand-in for development, not a real
   object store: the S3 API is unauthenticated and **files do not survive a restart**.
   That is tolerable because a ticket PDF can always be regenerated from `order.confirmed`.
2. If it stays, `spec.md`, the C4 diagram and the ADRs must say "S3-compatible object
   storage" instead of MinIO, and it is worth a short ADR recording why.

## RabbitMQ topology (INF-4)

The whole topology lives in `infra/rabbitmq/definitions.json`, which is **generated**
from `libs/shared/src/events/topology.json`:

```bash
npm run rabbitmq:definitions
```

Both files are committed. Never edit `definitions.json` by hand: change the topology and
regenerate, so the broker and the shared library can never disagree.

The file is imported by the `rabbitmq-init` container over the management API once the
broker is healthy, **not** with RabbitMQ's `load_definitions` setting. That setting looks
simpler but makes RabbitMQ skip the creation of the `RABBITMQ_DEFAULT_USER` account, and
the broker ends up with no account at all and refuses every login. Importing afterwards
keeps the credentials in `.env`, where the rest of the stack has them.

| Element | Value |
| --- | --- |
| Domain exchanges | `reservation`, `order`, `payment`, `ticket` (topic, durable) |
| Consumer queues | `<consumer>.<event>`, quorum, durable - one per consumer and event |
| Dead-letter queues | `<queue>.dlq`, fed by the `flashtix.dlx` exchange |
| Retry queues | `flashtix.retry.1s`, `flashtix.retry.10s`, `flashtix.retry.60s` |

**How a retry works.** When a handler throws, the consumer republishes the message to the
delay exchange of the next tier using **its own queue name as the routing key**. The delay
queue holds it for its TTL, and because that queue sets no
`x-dead-letter-routing-key`, the original routing key survives, so
`flashtix.retry.return` sends the message back to that one queue. The other consumers of
the same event are never disturbed by someone else's retry. After the third attempt the
consumer rejects the message without requeue and the broker routes it to `<queue>.dlq`.

## Verify the infrastructure

```bash
docker compose ps
```

Redis policies (ADR 001):

```bash
docker compose exec hold-store redis-cli config get maxmemory-policy      # noeviction
docker compose exec catalog-cache redis-cli config get maxmemory-policy   # allkeys-lru
docker compose exec hold-store redis-cli config get appendonly            # yes
```

RabbitMQ topology, which is the exit criterion of Phase 0:

```bash
docker compose exec rabbitmq rabbitmqctl list_exchanges name type | grep flashtix
docker compose exec rabbitmq rabbitmqctl list_queues name type | head -20
docker compose exec rabbitmq rabbitmqctl list_queues name | grep -c dlq     # 14
```

Management UI: <http://localhost:15672> (user and password from `.env`).

Payment gateway mock:

```bash
curl -s localhost:8090/health
curl -s localhost:8090/_mock/config

# Force one outcome instead of waiting for the random one
curl -s -X POST localhost:8090/payments \
  -H 'content-type: application/json' -H 'X-Mock-Behavior: succeed' \
  -d '{"orderId":"demo-1","amount":{"amount":90000000,"currency":"COP"}}'

# The same order is never charged twice: the replay is instant
curl -si -X POST localhost:8090/payments \
  -H 'content-type: application/json' \
  -d '{"orderId":"demo-1"}' | grep -i idempotent-replayed

# Make every charge fail, for a failure demo
curl -s -X PUT localhost:8090/_mock/config \
  -H 'content-type: application/json' -d '{"errorRate":1}'
```

Mailpit UI: <http://localhost:8025>.

Ticket storage (S3 API):

```bash
curl -s localhost:9090/            # must list the "tickets" bucket
```

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| `docker` is not recognized | Restart the terminal or VS Code (the PATH is read at startup). Check that Docker Desktop is running |
| `failed to extract layer ... input/output error` | Docker's disk is full or corrupted. Free disk space, run `docker system prune -f`, restart Docker Desktop and retry |
| `Access denied for user 'root'` | The password differs from the one MySQL was initialized with. Fix `.env`, then `docker compose down -v` and `docker compose up -d` |
| A port is already in use | Another program uses it. Stop it or change the host side of `ports` (for example `"3317:3306"`) |
| Port `8080` is already in use (Keycloak) | Do not just change the port: the token issuer must stay `http://localhost:8080` because Kong pins it. Create a local `docker-compose.override.yml` (never commit it) that publishes `"8081:8080"` with `ports: !override` and sets `KC_HOSTNAME: http://localhost:8080`, then run the scripts with `KEYCLOAK=http://localhost:8081` |
| `ticket-files-init` or `rabbitmq-init` shows `exited (0)` | Expected. They set things up and stop |
| RabbitMQ starts but has no queues | The import failed. Check `docker compose logs rabbitmq-init`, then `docker compose up -d rabbitmq-init` to retry |
| `ACCESS_REFUSED` when a service connects to RabbitMQ | The broker has no users. Check `docker compose exec rabbitmq rabbitmqctl list_users`; if it is empty, make sure `rabbitmq.conf` does **not** set `load_definitions` |
| A charge to the mock never answers | Expected: `MOCK_TIMEOUT_RATE` simulates the gateway hanging. Send `X-Mock-Behavior: succeed` for a deterministic answer |
| `LF will be replaced by CRLF` warning on Windows | Harmless. Git normalizes line endings when committing |
| `docker compose ps` shows `starting` | MySQL and RabbitMQ need up to a minute. Wait and run it again |
| Everything is slow or the machine swaps | The long-running containers need about 6 GB of RAM. Raise Docker Desktop's memory limit, or stop the databases you are not using |

## Current scope and differences from the target architecture

| Target (C4 / ADR / `spec.md`) | In this compose | Status |
| --- | --- | --- |
| `hold-store` with replicas and Sentinel (ADR 001) | Single instance with AOF and `noeviction` | Pending. Single node is enough for development |
| `booking-db` with primary and replica | Single instance | Pending |
| MinIO for the ticket files | `adobe/s3mock`, same S3 API | **Needs a team decision**, see above |
| Object storage with credentials and persistence | Unauthenticated, in-memory | Development only |
| HAProxy in front of Kong | Not included | Phase 3 (GW-6), optional |
| Role checks per route, `X-User-Id` set by the gateway | Not included | Phase 3 (GW-3, GW-4) |
| Waiting Room and the admission token on `POST /holds` | Included | Done (Phase 2) |
| Order Service and Payment Worker (checkout saga) | Included | Done (Phase 2) |
| Ticket Service and Notification Worker | Not included | Phase 3 |
| Prometheus, Loki, Grafana (observability) | Not included | Phase 4 |

If any of these differences becomes a permanent decision (for example, dropping Sentinel or
keeping SeaweedFS), add or update the corresponding ADR and adjust [`spec.md`](spec.md), as
required by the Wave 2 guidelines.

## The first end-to-end flow (Phase 1)

Everything below goes through the gateway on port 8000, which is the only port a client
should ever use.

```bash
# 1. A fan logs in and gets a token
TOKEN=$(curl -s -X POST \
  http://localhost:8080/realms/flashtix/protocol/openid-connect/token \
  -d grant_type=password -d client_id=flashtix-web \
  -d username=fan1 -d password=fan12345 | sed -n 's/.*"access_token":"\([^"]*\)".*/\1/p')

# 2. Browsing the catalog needs no token
curl -s "http://localhost:8000/v1/events" | head -c 200

# 3. Holding a seat without a token is rejected by the gateway
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:8000/v1/holds \
  -H 'content-type: application/json' \
  -d '{"eventId":"3f0c8a52-0000-4000-8000-000000000001","seatIds":["A-01-01"]}'   # 401

# 4. With the token AND the admission token of the virtual queue it succeeds
#    (POST /v1/events/{id}/queue, then GET .../queue/{ticket} until ADMITTED; see Phase 2)
curl -s -X POST http://localhost:8000/v1/holds \
  -H "Authorization: Bearer $TOKEN" -H "X-Admission-Token: $ADMISSION" \
  -H 'content-type: application/json' \
  -d '{"eventId":"3f0c8a52-0000-4000-8000-000000000001","seatIds":["A-01-01"]}'

# 5. The catalog shows that seat as HELD, without ever touching booking-db
curl -s "http://localhost:8000/v1/events/3f0c8a52-0000-4000-8000-000000000001/seats" \
  | grep -o '"seatId":"A-01-01","[^}]*' | head -1
```

`scripts/smoke-phase1.sh` runs this whole flow and checks the results.

### Test users

| Username | Password | Realm role |
| --- | --- | --- |
| `fan1`, `fan2` | `fan12345` | `FAN` |
| `organizer1`, `organizer2` | `organizer12345` | `ORGANIZER` |

### Seeded catalog

`catalog-db` starts with one `ON_SALE` event, `3f0c8a52-0000-4000-8000-000000000001`,
with 200 seats: `A-01-01` to `A-08-10` (VIP) and `B-01-01` to `B-12-10` (GENERAL).
The seed only runs when the volume is created, so after changing it you need
`docker compose down -v`.

## The checkout saga (Phase 2)

Phase 2 adds the Waiting Room, the Order Service and the Payment Worker, so a fan can go
from the queue to a confirmed order:

```text
POST /v1/events/{id}/queue -> GET .../queue/{ticket} (ADMITTED + admissionToken)
POST /v1/holds  (X-Admission-Token)                    -> hold ACTIVE, seat.held
POST /v1/orders (Idempotency-Key)  -> LockHold (gRPC)  -> order PENDING + payment.requested (outbox)
Payment Worker -> legacy gateway (20 s timeout, retries 2/10/30 s, circuit breaker)
payment.succeeded -> sold_seats + CONFIRMED + order.confirmed -> seat SOLD, hold consumed
payment.failed    -> FAILED + order.failed                    -> seats released
duplicate seat    -> REFUND_PENDING + refund.requested -> refund.completed -> CANCELLED
```

Check it with:

```bash
node scripts/smoke-phase2.mjs        # queue, holds, happy path, failure path, double sale, sweeper
node scripts/concurrency-holds.mjs   # RES-8: 1000 requests for one seat, exactly one wins
```

`smoke-phase2.mjs` drives the payment gateway mock through `PUT /_mock/config` (fast, always
declining, slow) and writes directly to `booking-db` and `hold-store` only to simulate the
failures it needs (a seat sold behind the platform's back, a hold whose TTL ran out). It sets
the mock back to the `.env.example` defaults at the end.

| Setting | Where | Default |
| --- | --- | --- |
| `ADMISSION_BATCH_SIZE`, `ADMISSION_INTERVAL_MS` | `.env` | 500 fans every 10 s |
| `ADMISSION_TOKEN_SECRET` | `.env`, shared by Waiting Room and Reservation | must be set |
| `PAYMENT_RETRY_DELAYS_MS` | `.env` | `2000,10000,30000` |
| `HOLD_TTL_SECONDS`, `HOLD_LOCK_SECONDS`, `HOLD_SWEEP_INTERVAL_MS` | `docker-compose.yml` (reservation) | 600, 300, 5000 |
