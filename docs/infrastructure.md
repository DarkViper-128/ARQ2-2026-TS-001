# Local infrastructure (Wave 2 - base)

How to run the base infrastructure of FlashTix on a developer machine with Docker Compose.
It implements the data and messaging containers of the
[C4 Level 2 diagram](assets/c4-container-diagram.jpg), following
[ADR 001](adrs/001-use-of-redis.md) (two Redis instances) and
[ADR 003](adrs/003-async-payments-rabbitmq.md) (RabbitMQ). The microservices, the API Gateway
and the observability stack are added in later steps.

## Requirements

- Docker Desktop (includes Docker Compose v2). Check with `docker --version` and `docker compose version`.
- Docker Desktop must be running before any `docker compose` command.
- Free ports: `3307`, `3308`, `6379`, `6380`, `5672`, `15672`.

## Quick start

```bash
cp .env.example .env      # Windows PowerShell: copy .env.example .env
# edit .env and replace every "change-me"
docker compose up -d
docker compose ps         # every service must be "healthy"
```

The first start downloads the images and can take several minutes. Later starts take seconds.

Stop everything (data is kept in volumes):

```bash
docker compose down
```

Stop and **delete all data** (databases, holds, queues):

```bash
docker compose down -v
```

## Configuration

Credentials live in `.env`, which is ignored by Git. `.env.example` is the template that is committed.

| Variable | Used by | Description |
| --- | --- | --- |
| `MYSQL_ROOT_PASSWORD` | `catalog-db`, `booking-db` | Root password of both MySQL servers |
| `RABBITMQ_USER` | `rabbitmq` | Broker user |
| `RABBITMQ_PASSWORD` | `rabbitmq` | Broker password |

Use values without spaces, quotes or `$`. MySQL stores the root password the first time its volume is created, so if you change
`MYSQL_ROOT_PASSWORD` later you must recreate the volumes with `docker compose down -v`.

## Services

| Service | Image | Host port | C4 container | Purpose |
| --- | --- | --- | --- | --- |
| `catalog-db` | `mysql:8.4` | 3307 | `catalog-db` | Events, venues, seats and prices (Catalog Service). Database `catalog` |
| `booking-db` | `mysql:8.4` | 3308 | `booking-db` | Orders, outbox and `sold_seats` (Order Service). Database `booking` |
| `catalog-cache` | `redis:7-alpine` | 6379 | `catalog-cache` | Read model of the catalog and availability. LRU, no persistence |
| `hold-store` | `redis:7-alpine` | 6380 | `hold-store` | Seat holds (`SET NX EX 600`) and virtual queue. AOF, `noeviction` |
| `rabbitmq` | `rabbitmq:3.13-management-alpine` | 5672 (AMQP), 15672 (UI) | Message Broker | Asynchronous events between services |

All services share the network `flashtix-net`, so containers reach each other by service name
(for example `hold-store:6379`, `rabbitmq:5672`). The host ports above are only for tools running on your machine.
Every service has a `healthcheck`, so later services can wait for them with `depends_on: condition: service_healthy`.

### Why two Redis instances (ADR 001)

| Instance | Eviction policy | Persistence | Reason |
| --- | --- | --- | --- |
| `catalog-cache` | `allkeys-lru` | none | A cache can drop old entries when it is full and be rebuilt from MySQL |
| `hold-store` | `noeviction` | AOF, `everysec` | A hold must never be dropped: if it disappeared, the seat would look free while someone is paying. With AOF a restart loses at most 1 second |

## Verify the infrastructure

```bash
docker compose ps
docker compose exec hold-store redis-cli config get maxmemory-policy      # noeviction
docker compose exec catalog-cache redis-cli config get maxmemory-policy   # allkeys-lru
docker compose exec hold-store redis-cli config get appendonly            # yes
```

RabbitMQ management UI: <http://localhost:15672> (user and password from `.env`).

MySQL (run these inside the container, which avoids shell quoting problems on Windows):

```bash
docker compose exec booking-db sh
mysql -uroot -p"$MYSQL_ROOT_PASSWORD" -e "SHOW DATABASES;"    # must list "booking"
exit
```

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| `docker` is not recognized | Restart the terminal or VS Code (the PATH is read at startup). Check that Docker Desktop is running |
| `failed to extract layer ... input/output error` | Docker's disk is full or corrupted. Free disk space, run `docker system prune -f`, restart Docker Desktop and retry |
| `Access denied for user 'root'` | The password differs from the one MySQL was initialized with. Fix `.env`, then `docker compose down -v` and `docker compose up -d` |
| A port is already in use | Another program uses it. Stop it or change the host side of `ports` (for example `"3317:3306"`) |
| `LF will be replaced by CRLF` warning on Windows | Harmless. Git normalizes line endings when committing |
| `docker compose ps` shows `starting` | MySQL and RabbitMQ need up to a minute. Wait and run it again |

## Current scope and differences from the target architecture

This is the first step of Wave 2, so it is intentionally smaller than the C4 diagram.

| Target (C4 / ADR / `spec.md`) | In this compose | Status |
| --- | --- | --- |
| `hold-store` with replicas and Sentinel (ADR 001) | Single instance with AOF and `noeviction` | Pending. Single node is enough for development |
| `booking-db` with primary and replica | Single instance | Pending |
| `payment-db`, `ticket-db`, `notification-db`, `ticket-files` (MinIO) | Not included | Added with their services |
| RabbitMQ topology (exchanges, quorum queues, DLQs) | Broker only, no exchanges or queues yet | Created by the services or by a bootstrap script |
| Microservices, HAProxy, Kong, Keycloak | Not included | Next steps |
| Prometheus, Loki, Grafana (observability) | Not included | Planned early in Wave 2 |

If any of these differences becomes a permanent decision (for example, dropping Sentinel), add or update the corresponding ADR and
adjust [`spec.md`](spec.md), as required by the Wave 2 guidelines.
