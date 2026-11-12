# FlashTix - Complete Implementation Summary (TS-001)

**Wave 2 - Phases 0 through 4 Complete** · **Team TS-001** · **Last Updated: 2026-11-11**

---

## Executive Summary

This document consolidates all implementations completed in Wave 2 for the FlashTix ticket sales platform. The platform addresses five mandatory features (F1-F5) through a microservices architecture with an API Gateway, event-driven communication, and an observability stack.

**Current Status: All 5 Phases Complete (0-4)**

| Phase | Focus | Key Deliverables |
|-------|-------|------------------|
| **Phase 0** | Monorepo skeleton + Infrastructure | npm workspaces, `@flashtix/shared`, Docker Compose (5 MySQL, 2 Redis, RabbitMQ, S3, Mailpit, Payment Mock), Keycloak, Kong, gRPC proto, event envelope, idempotent consumer |
| **Phase 1** | First E2E flow | Keycloak + Kong JWT validation, Reservation Service (atomic Lua holds), Catalog Service (cache-aside + idempotent consumers), smoke test |
| **Phase 2** | Booking + Payment saga | Waiting Room Service, Order Service (checkout saga), Payment Worker (retries, circuit breaker, refunds), concurrency test |
| **Phase 3** | Tickets + Notifications + Admin | Ticket Service (PDF + QR), Notification Worker (email dedup), Organizer endpoints, Gateway role checks (GW-3, GW-4), identity headers |
| **Phase 4** | Observability | Prometheus, Loki, Grafana, Promtail, Node Exporter, cAdvisor, `/metrics` on all 7 services, dashboards |

---

## 1. Architecture Overview

### 1.1 Services and Responsibilities

| Service | Technology | Port | Responsibility | Data Owned |
|---------|------------|------|----------------|------------|
| **Identity Provider** | Keycloak 26 | 8080 | OIDC login, RS256 JWT with `FAN`/`ORGANIZER` roles | own schema |
| **API Gateway** | Kong 3.8 | 8000 | Single entry point: JWT validation, rate limiting, routing, role checks, identity headers | - |
| **Catalog Service** | NestJS | 3001 | Events, seat map, availability (cache-aside) | `catalog-db` (MySQL), `catalog-cache` (Redis) |
| **Waiting Room** | NestJS | 3004 | Virtual queue, batch admission, signed tokens | `hold-store` (Redis) |
| **Reservation** | NestJS | 3002 | Soft seat holds (TTL), atomic Lua, `LockHold` gRPC | `hold-store` (Redis, AOF) |
| **Order Service** | NestJS | 3003 | Checkout saga orchestrator, order state, transactional outbox | `booking-db` (MySQL) |
| **Payment Worker** | NestJS | 3005 | Legacy gateway calls (timeout, retries, circuit breaker), refunds | `payment-db` (MySQL) |
| **Ticket Service** | NestJS | 3006 | PDF + QR per seat, signed download URL (S3) | `ticket-db` (MySQL), `ticket-files` (S3) |
| **Notification Worker** | NestJS | 3007 | Email (Mailpit/SendGrid), push (FCM), deduplication | `notification-db` (MySQL) |

### 1.2 Data Stores

| Store | Technology | Port | Purpose |
|-------|------------|------|---------|
| `catalog-db` | MySQL 8.4 | 3307 | Events, venues, seats, prices |
| `booking-db` | MySQL 8.4 | 3308 | Orders, outbox, `sold_seats` (source of truth) |
| `payment-db` | MySQL 8.4 | 3309 | Payments (unique per `orderId`) |
| `ticket-db` | MySQL 8.4 | 3310 | Issued tickets |
| `notification-db` | MySQL 8.4 | 3311 | Email/push deduplication |
| `catalog-cache` | Redis 7 | 6379 | Read model + availability (LRU, no persistence) |
| `hold-store` | Redis 7 | 6380 | Seat holds (`SET NX EX 600`), virtual queue (AOF, `noeviction`) |
| `rabbitmq` | RabbitMQ 3.13 | 5672/15672 | Async events between services |
| `ticket-files` | Adobe S3Mock | 9090 | S3-compatible ticket PDF storage |
| `mailpit` | axllent/mailpit | 1025/8025 | Email catcher (dev) |

### 1.3 Observability Stack (Phase 4)

| Service | Image | Port | Purpose |
|---------|-------|------|---------|
| Prometheus | prom/prometheus:v2.54.1 | 9091 | Metrics collection & storage |
| Loki | grafana/loki:2.9.4 | 3100 | Log aggregation |
| Promtail | grafana/promtail:2.9.4 | - | Log shipper (Docker logs → Loki) |
| Grafana | grafana/grafana:10.2.2 | 3000 | Visualization (dashboards, alerts) |
| Node Exporter | prom/node-exporter:v1.7.0 | 9100 | Host metrics |
| cAdvisor | gcr.io/cadvisor/cadvisor:v0.49.1 | 8081 | Container metrics |

---

## 2. Monorepo Structure

```
.
├── package.json              # npm workspaces root
├── tsconfig.base.json        # Shared compiler options
├── docker-compose.yml        # All services + infrastructure
├── .env.example              # Template for local .env
├── libs/
│   ├── shared/               # @flashtix/shared (events, errors, correlation, idempotency)
│   └── nest-support/         # @flashtix/nest-support (problem+json filter, request identity)
├── services/
│   ├── catalog/
│   ├── waiting-room/
│   ├── reservation/
│   ├── order/
│   ├── payment-worker/
│   ├── ticket/
│   └── notification/
├── tools/
│   └── payment-gateway-mock/ # Legacy gateway stand-in
├── infra/
│   ├── keycloak/             # Realm, roles, test users
│   ├── kong/                 # Declarative Kong config
│   ├── mysql/                # Schemas per database
│   ├── rabbitmq/             # Generated topology (definitions.json)
│   └── prometheus/           # Prometheus scrape config
├── proto/
│   └── reservation/v1/reservation.proto  # LockHold gRPC contract
├── scripts/                  # Smoke & concurrency tests
└── docs/
    ├── spec.md               # API & contract specification (OpenSpec)
    ├── monorepo.md           # Code layout, shared lib, Docker build rule
    ├── infrastructure.md     # Local run & verification guide
    ├── adrs/                 # Architecture Decision Records
    ├── spikes/               # Technical investigation findings
    └── assets/               # C4 diagrams
```

### 2.1 Key Architectural Decisions

**npm Workspaces** - Chosen over pnpm/Nx because the team already has Node 20, no extra tool to install, and `npm install` at root links `@flashtix/shared` automatically.

**Docker Build Context = Repository Root** - Every service's Dockerfile uses `context: .` so it can `COPY libs/shared` into the build. The Dockerfile copies manifests first, runs `npm ci`, then copies sources for optimal layer caching.

**Single Source of Truth for RabbitMQ Topology** - Defined in `libs/shared/src/events/topology.json`, regenerated to `infra/rabbitmq/definitions.json` via `npm run rabbitmq:definitions`. Never edit `definitions.json` by hand.

---

## 3. Phase-by-Phase Implementation Details

### Phase 0: Monorepo Skeleton & Infrastructure (Commit `a2db47c`)

#### 3.1 Monorepo Setup
- **npm workspaces** at root linking `@flashtix/shared` and `@flashtix/nest-support`
- **tsconfig.base.json** with strict TypeScript options extended by all packages
- **Dockerfile pattern**: root context, multi-stage build (deps → build → runtime)

#### 3.2 Shared Library (`@flashtix/shared`)

| Module | Purpose |
|--------|---------|
| `createEnvelope`, `parseEnvelope` | Common event envelope (spec.md §5) |
| `EventPublisher` | Publisher confirms - `publish()` resolves after broker ACK |
| `EventConsumer` | Idempotent consumption with 1s/10s/60s retry ladder + DLQ |
| `claimEvent`, `MySqlProcessedEvents`, `PROCESSED_EVENTS_DDL` | `processed_events` table for exactly-once semantics |
| `AppError`, `toProblemDetails` | `application/problem+json` errors with spec.md codes |
| `correlationIdMiddleware`, `getCorrelationId` | Correlation ID from HTTP through to every event |
| `queueName`, `queuesFor`, `exchangeForEvent` | Queue/exchange names from topology (no hardcoded strings) |

#### 3.3 Nest Support Library (`@flashtix/nest-support`)
- `ProblemDetailsFilter` - Global exception filter for `application/problem+json`
- `CurrentUser` decorator + `currentUserId()` helper - Extract `X-User-Id` header

#### 3.4 Infrastructure Containers
- **5 MySQL databases** sharing YAML anchor `x-mysql` (catalog, booking, payment, ticket, notification)
- **2 Redis instances** with different policies (ADR 001):
  - `catalog-cache`: `allkeys-lru`, no persistence
  - `hold-store`: `noeviction`, AOF `everysec`
- **RabbitMQ** with full topology: 4 domain exchanges, 14 consumer queues, 14 DLQs, 3 retry tiers
- **S3Mock** (`adobe/s3mock`) instead of MinIO (no pullable community image)
- **Mailpit** for email catching
- **Payment Gateway Mock** - Configurable latency (up to 15s), decline/error/timeout rates, idempotent by `orderId`
- **Keycloak** - Realm `flashtix` with pinned RSA key (survives `docker compose down -v`)
- **Kong** - DB-less mode, declarative config in `infra/kong/kong.yml`

#### 3.5 gRPC Contract
- `proto/reservation/v1/reservation.proto` - `LockHold` service for Order→Reservation TTL extension

---

### Phase 1: First E2E Flow (Commit `0d1ce7e`)

#### 3.6 Keycloak + Kong JWT Validation (F1, GW-1, GW-2)
- **Keycloak realm** `flashtix` with roles `FAN` and `ORGANIZER`, 2 test users per role
- **Pinned RSA keypair** in realm export + Kong config (avoids JWKS rotation complexity)
- **Kong `jwt` plugin** validates RS256 signature, `exp`, `iss` (`http://localhost:8080/realms/flashtix`)
- **Public routes**: `GET /v1/events*` (catalog browsing)
- **Protected routes**: All others require valid JWT → 401 if missing/invalid

#### 3.7 Reservation Service (F3, RES-1 to RES-3, RES-6)
- **POST `/holds`** - Atomic Lua script: `SET seat:{eventId}:{seatId} {holdId} NX EX 600` for all seats (all-or-nothing)
- **DELETE `/holds/{holdId}`** - Ownership check, releases seats, publishes `seat.released`
- **gRPC `LockHold`** - Extends hold TTL to `max(current_expiry, now + 300s)` for checkout
- **Events published**: `seat.held`, `seat.released` (with reason: `EXPIRED`, `CANCELLED_BY_USER`, `ORDER_FAILED`)
- **Performance**: 4-9 ms p95 (target < 100 ms)

#### 3.8 Catalog Service (F2, CAT-1 to CAT-3, CAT-5)
- **Schema + seed**: 1 `ON_SALE` event, 200 seats (VIP: A-01-01 to A-08-10; GENERAL: B-01-01 to B-12-10)
- **GET `/events`** - List events (cache 60s)
- **GET `/events/{eventId}`** - Event details (cache 60s)
- **GET `/events/{eventId}/seats`** - Seat map from cache + status overlay from Redis (cache 5s)
- **Idempotent consumers**: `seat.held`, `seat.released`, `order.confirmed` → update `catalog-cache`
- **Cache headers**: `X-Cache: HIT/MISS`

#### 3.9 Smoke Test Phase 1
- `scripts/smoke-phase1.sh` - 18 checks, verifies: login → catalog → hold → catalog shows HELD

---

### Phase 2: Booking + Payment Saga (Commits `ee54bac`, `6dd9814`)

#### 3.10 Waiting Room Service (F3, WR-1 to WR-5)
- **POST `/events/{eventId}/queue`** - Fan joins queue (one ticket per fan/event)
- **GET `/events/{eventId}/queue/{queueTicketId}`** - Poll for admission
- **Batch admission**: Configurable batch size (default 500) every interval (default 10s)
- **Admission token**: JWT signed with shared secret, valid 10 minutes, required for `POST /holds`
- **Data**: `queue:{eventId}` sorted set in Redis by arrival time

#### 3.11 Order Service (F4, ORD-1 to ORD-7)
- **POST `/orders`** (requires `Idempotency-Key`):
  1. Lock hold via gRPC `LockHold` (extends TTL to 300s)
  2. Price seats via Catalog Service (never trust client prices)
  3. **Single MySQL transaction**: Save order `PENDING` + write `payment.requested` to outbox
  4. Return `202 Accepted` with `orderId` (derived from fan + `Idempotency-Key`)
- **Saga orchestrator**: Consumes `payment.succeeded` / `payment.failed` / `refund.completed`
- **Transactional outbox**: `outbox` table + relay publishes to RabbitMQ with publisher confirms
- **Idempotency**: `orderId` = hash(fanId + idempotencyKey) → retry completes same order
- **States**: `PENDING` → `CONFIRMED` / `FAILED` / `REFUND_PENDING` → `CANCELLED`

#### 3.12 Payment Worker (F4, PAY-1 to PAY-5)
- Consumes `payment.requested`, calls legacy gateway mock
- **Gateway call**: 20s timeout, 3 retries (2s, 10s, 30s), circuit breaker (opens at 50% failures in 30s)
- **Idempotent**: `orderId` is payment idempotency key (unique in `payment-db`, sent to gateway)
- Publishes `payment.succeeded` (with `gatewayReference`) or `payment.failed` (reason: `DECLINED`, `GATEWAY_TIMEOUT`, `GATEWAY_UNAVAILABLE`)
- **Refunds**: Consumes `refund.requested`, calls gateway refund, publishes `refund.completed`

#### 3.13 Overbooking Prevention
- **`sold_seats` table**: `PRIMARY KEY (event_id, seat_id)` - MySQL rejects duplicate seat sale
- If `INSERT INTO sold_seats` fails (seat already sold): Order → `REFUND_PENDING`, publish `refund.requested`
- Saga completes refund → Order `CANCELLED`

#### 3.14 Concurrency Test (RES-8)
- `scripts/concurrency-holds.mjs` - 1000 concurrent requests for 1 seat → exactly 1 wins

#### 3.15 Smoke Test Phase 2
- `scripts/smoke-phase2.mjs` - Queue → hold → happy path payment → failure path → double sale → sweeper

---

### Phase 3: Tickets + Notifications + Admin (Commits `7b44fc0`, `77e14ce`, `df7ab70`)

#### 3.16 Ticket Service (F5)
- Consumes `order.confirmed` → creates **1 PDF + QR per seat**
- **QR payload**: `FTX1.<ticketId>.<HMAC>` - HMAC covers ticket + event + seat (`signTicketQr` / `verifyTicketQr` in `@flashtix/shared`)
- **Storage**: PDF in S3 (`ticket-files`), metadata in `ticket-db`
- **Idempotency**: `UNIQUE (order_id, seat_id)` in `ticket-db`
- **GET `/tickets/{ticketId}`** - Returns `qrPayload` + signed download URL (900s expiry)
- Publishes `ticket.issued` with `dedupKey`

#### 3.17 Notification Worker (F5)
- Consumes `ticket.issued` → **ONE email with all PDFs attached** (Mailpit UI: http://localhost:8025)
- Consumes `order.failed`, `order.cancelled` → email to fan
- **Deduplication**: `notification-db` with dedup keys (`ticket.issued:<orderId>`, `order.failed:<orderId>`, `order.cancelled:<orderId>`) + row lock
- **Retry ladder**: SMTP failures → RabbitMQ retry (1s/10s/60s) → DLQ → later delivery retries (row still `PENDING`)

#### 3.18 Organizer Endpoints (Admin Console)
| Endpoint | Auth | Purpose |
|----------|------|---------|
| `POST /admin/events` | ORGANIZER | Create event as `DRAFT` (hidden from public) |
| `POST /admin/events/{eventId}/publish` | ORGANIZER | Make `PUBLISHED`, preload cache, opens sale at `saleStartsAt` |
| `POST /admin/orders/{orderId}/refund` | ORGANIZER | Start refund saga (`reason: EVENT_CANCELLED` etc.) |

#### 3.19 API Gateway Role Checks (GW-3, GW-4)
- **Post-JWT validation**: `post-function` plugin sets headers `X-User-Id`, `X-User-Email`, `X-User-Roles` from token (overwrites client headers)
- **Route-level enforcement**: `/v1/admin/*` → 403 if no `ORGANIZER` role
- **Fan routes**: Require valid token (any role), not specifically `FAN` (organizer may read orders)
- **Services**: Read identity from headers; organizer endpoints double-check role

#### 3.20 Smoke Test Phase 3
- `scripts/smoke-phase3.mjs` - Roles, organizer console, tickets, one email, duplicate event, refund

---

### Phase 4: Observability Stack (Commits `0c2ce6e`, `3ec397a`, plus fixes)

#### 3.21 Prometheus Metrics (`@flashtix/shared` metrics library)
- **All 7 microservices** expose `/metrics` on port 3000 (health + metrics)
- **Standard metrics**: HTTP request duration, count, errors; RabbitMQ consumer lag; Redis ops; DB pool
- **Business metrics**: Order volume, hold volume, payment outcomes, checkout latency, gateway latency, event consumption rates
- **Scrape interval**: 15s
- **Targets**: 7 services + Kong (8001) + Node Exporter + cAdvisor + RabbitMQ + Prometheus self

#### 3.22 Loki + Promtail
- **Promtail** ships Docker container logs to Loki
- **Labels**: `service` (compose service name), `container`, `project=flashtix`
- **Retention**: 30 days

#### 3.23 Grafana Dashboards (pre-provisioned)
- **FlashTix - Platform Overview**: Service health, request rates, latency (p50/p95/p99), error rates, queue depths, system resources
- **FlashTix - Business Metrics**: Order volume, hold volume, payment outcomes, checkout latency, gateway latency, event consumption rates
- **Access**: http://localhost:3000 (admin/admin from `.env`)

#### 3.24 Infrastructure Metrics
- **Node Exporter**: Host CPU, memory, disk, network
- **cAdvisor**: Container CPU, memory, network, disk I/O
- **RabbitMQ**: Queue depths, message rates (via management API on port 15692)

---

## 4. API Specification Summary (from `docs/spec.md`)

### 4.1 Conventions
- **Base URL**: `https://api.flashtix.com/v1` (local: `http://localhost:8000/v1`)
- **Auth**: `Authorization: Bearer <JWT>` → Gateway validates, forwards `X-User-Id`, `X-User-Email`, `X-User-Roles`
- **Headers**: `X-Correlation-Id` (tracing), `Idempotency-Key` (required on `POST /orders`), `X-Admission-Token` (required on `POST /holds`)
- **Formats**: UUID ids, seat id `A-12-07`, ISO-8601 UTC, money as `{ "amount": 25000000, "currency": "COP" }` (minor units)
- **Errors**: `application/problem+json` with codes from spec.md

### 4.2 Key Endpoints

| Method | Path | Auth | Feature |
|--------|------|------|---------|
| `GET` | `/events` | Public | F2 |
| `GET` | `/events/{eventId}` | Public | F2 |
| `GET` | `/events/{eventId}/seats` | Public | F2 |
| `POST` | `/events/{eventId}/queue` | FAN | F3 |
| `GET` | `/events/{eventId}/queue/{queueTicketId}` | FAN (owner) | F3 |
| `POST` | `/holds` | FAN + `X-Admission-Token` | F3 |
| `DELETE` | `/holds/{holdId}` | FAN (owner) | F3 |
| `POST` | `/orders` | FAN + `Idempotency-Key` | F4 |
| `GET` | `/orders/{orderId}` | FAN (owner) or ORGANIZER | F4 |
| `GET` | `/orders/{orderId}/events` | FAN (owner) | F4 (SSE - pending) |
| `GET` | `/tickets/{ticketId}` | FAN (holder) | F5 |
| `POST` | `/admin/events` | ORGANIZER | Admin |
| `POST` | `/admin/events/{eventId}/publish` | ORGANIZER | Admin |
| `POST` | `/admin/orders/{orderId}/refund` | ORGANIZER | Admin |

### 4.3 Event Contracts (RabbitMQ)

| Event | Exchange | Producer | Consumers | Idempotency Key |
|-------|----------|----------|-----------|-----------------|
| `seat.held` | reservation | Reservation | Catalog | `eventId` |
| `seat.released` | reservation | Reservation | Catalog | `eventId` |
| `payment.requested` | order | Order | Payment Worker | `orderId` |
| `payment.succeeded` | payment | Payment Worker | Order | `orderId` |
| `payment.failed` | payment | Payment Worker | Order | `orderId` |
| `order.confirmed` | order | Order | Ticket, Catalog, Reservation | `eventId` (+ `orderId, seatId` for Ticket) |
| `order.failed` | order | Order | Reservation, Notification | `eventId` |
| `refund.requested` | order | Order | Payment Worker | `orderId` |
| `refund.completed` | payment | Payment Worker | Order | `orderId` |
| `order.cancelled` | order | Order | Notification | `dedupKey` |
| `ticket.issued` | ticket | Ticket | Notification | `dedupKey` |

**Delivery Guarantees**: At-least-once (persistent + publisher confirms + outbox), idempotent consumers (`processed_events`), ordering not guaranteed (consumers check `aggregateVersion`), 3 retries (1s/10s/60s) then DLQ.

---

## 5. Operational Parameters

| Parameter | Value |
|-----------|-------|
| Hold TTL / after `LockHold` | 600 s / 300 s |
| Admission token validity | 10 min |
| Max seats per hold | 6 |
| Gateway timeout / retries | 20 s / 3 (2s, 10s, 30s) |
| Event retries | 3 (1s, 10s, 60s), then DLQ |
| Rate limit | 20 req/s per user · 100 req/s per IP (pending) |
| Target p95 | catalog < 50 ms · hold < 100 ms · `POST /orders` < 300 ms |

---

## 6. Running & Verification

### 6.1 Quick Start
```bash
cp .env.example .env      # Windows: copy .env.example .env
# Edit .env, replace every "change-me"
docker compose up -d --build
docker compose ps         # All services must be "healthy"
```

### 6.2 Test Users
| Username | Password | Role |
|----------|----------|------|
| `fan1`, `fan2` | `fan12345` | FAN |
| `organizer1`, `organizer2` | `organizer12345` | ORGANIZER |

### 6.3 Smoke Tests
```bash
./scripts/smoke-phase1.sh          # Phase 1: gateway, holds, catalog
node scripts/smoke-phase2.mjs      # Phase 2: queue, saga, failure, refund
node scripts/smoke-phase3.mjs      # Phase 3: tickets, emails, organizer, roles
node scripts/concurrency-holds.mjs # 1000 requests for 1 seat, exactly 1 wins
```

### 6.4 Observability URLs
- **Grafana**: http://localhost:3000 (admin/admin)
- **Prometheus**: http://localhost:9091
- **Loki**: http://localhost:3100
- **Kong Admin**: http://localhost:8001
- **Keycloak**: http://localhost:8080
- **RabbitMQ**: http://localhost:15672
- **Mailpit**: http://localhost:8025

### 6.5 Infrastructure Verification
```bash
# Redis policies
docker compose exec hold-store redis-cli config get maxmemory-policy      # noeviction
docker compose exec catalog-cache redis-cli config get maxmemory-policy   # allkeys-lru
docker compose exec hold-store redis-cli config get appendonly            # yes

# RabbitMQ topology (Phase 0 exit criterion)
docker compose exec rabbitmq rabbitmqctl list_exchanges name type | grep flashtix
docker compose exec rabbitmq rabbitmqctl list_queues name | grep -c dlq     # 14

# Prometheus targets
curl -s http://localhost:9091/api/v1/targets | jq '.data.activeTargets[] | {job: .labels.job, health: .health}'
```

---

## 7. Architecture Decision Records

| ADR | Title | Status | Key Decision |
|-----|-------|--------|--------------|
| [001](adrs/001-use-of-redis.md) | Use of Redis | **Accepted** | Two Redis instances: `catalog-cache` (LRU) + `hold-store` (AOF, noeviction, Sentinel) |
| [002](adrs/002-Migration-of-the-DB.md) | MySQL → PostgreSQL | **Rejected** | Keep MySQL 8: `sold_seats` PK + idempotent payments + saga refund already prevent overbooking |
| [003](adrs/003-async-payments-rabbitmq.md) | Async payments with RabbitMQ | **Accepted** | Checkout saga orchestrated by Order Service, transactional outbox, Payment Worker with retries/circuit breaker |

---

## 8. Known Gaps / Pending Items

| Item | Status | Notes |
|------|--------|-------|
| HAProxy in front of Kong | Pending | Phase 3 (GW-6), optional |
| Rate limiting (20/s user, 100/s IP) | Pending | Not implemented |
| SSE live order status (`GET /orders/{id}/events`) | Pending | `GET /orders/{id}` works |
| Push notifications (FCM) | Pending | Email only; needs provider credentials |
| MinIO → S3Mock decision | **Needs team decision** | MinIO no longer has pullable community image; S3Mock is unauthenticated, in-memory, no persistence across restarts. Spec.md, C4 diagram, ADRs still say "MinIO". |
| Redis Sentinel / replicas | Pending | Single node with AOF sufficient for dev |
| MySQL replicas | Pending | Single instance for dev |

---

## 9. Team & Attribution

**Team TS-001**:
- Carlos Andrés Arteaga
- Álvaro Sotelo
- Santiago Vallejo
- Duvan Leal
- Juan Pablo Florez

**Wave 2 Phase Contributors** (from commit history):
- Phase 0: Duvan Leal
- Phase 1: Duvan Leal
- Phase 2: Carlos Andrés Arteaga
- Phase 3: Álvaro Sotelo
- Phase 4: Multiple (observability stack)

---

## 10. References

- **Tech Spec (Google Docs)**: [TS-001](https://docs.google.com/document/d/1-AFlBlVcvafUERSNm0P2-3Cm0WpNemYI0IGmoMNPLa0/edit?usp=sharing)
- **API Spec**: `docs/spec.md`
- **Infrastructure Guide**: `docs/infrastructure.md`
- **Monorepo Guide**: `docs/monorepo.md`
- **C4 Container Diagram**: `docs/assets/c4-container-diagram.jpg`
- **ADRs**: `docs/adrs/`
- **Spikes**: `docs/spikes/`

---

*This document reflects the state of the repository at commit `5c58732` (Merge PR #4 - Phase 3 complete, Phase 4 observability complete). All phases 0-4 are implemented and verified via smoke tests.*