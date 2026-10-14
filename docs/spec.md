# FlashTix - API and Contract Specification (OpenSpec)

- **Version:** 1.0.0 (Wave 1) · **Date:** 2026-10-13 · **Status:** Draft
- **Related:** [ADR 001 - Use of Redis](adrs/001-use-of-redis.md) · [C4 Level 2 diagram](assets/c4-container-diagram.png)

FlashTix sells concert tickets to up to 500,000 fans at the same time. The platform SHALL
serve the catalog without touching the transactional database, control the crowd with a
virtual queue, hold seats in memory with a TTL, process payments asynchronously against a
slow legacy gateway (up to 15 s) and email the ticket, **never selling the same seat twice**.

---

## 1. Overview: services and responsibilities

| Service | Technology | Responsibility | Data it owns | Feature |
| --- | --- | --- | --- | --- |
| Identity Provider | Keycloak 25 (OIDC) | Login; issues RS256 JWT with roles `FAN` / `ORGANIZER` | own schema | F1 |
| Load Balancer + API Gateway | HAProxy 2.9 + Kong 3 | Single entry point: JWT validation, rate limiting, routing, `Idempotency-Key` | - | F1 |
| Catalog Service | Node.js 20 · NestJS | Events, seat map and availability (cache-aside) | `catalog-db` (MySQL), `catalog-cache` (Redis) | F2 |
| Waiting Room Service | Node.js 20 · NestJS | Virtual queue; admits fans in batches with a signed token | `hold-store` (Redis) | F3 |
| Reservation Service | Node.js 20 · NestJS | Soft seat holds with TTL (atomic Lua script) | `hold-store` (Redis, AOF) | F3 |
| Order Service | Node.js 20 · NestJS | Checkout **saga orchestrator**, order state, transactional outbox | `booking-db` (MySQL, source of truth) | F4 |
| Payment Worker | Node.js 20 · consumer | Calls the legacy gateway with timeout, retries, circuit breaker; refunds | `payment-db` (MySQL) | F4 |
| Ticket Service | Node.js 20 · consumer | PDF + QR ticket, signed download URL | `ticket-db` (MySQL), MinIO | F5 |
| Notification Worker | Node.js 20 · consumer | Email (SendGrid) and push (FCM) with dedup | `notification-db` (MySQL) | F5 |
| Message Broker | RabbitMQ 3.13 | Asynchronous events between services | - | F4, F5 |

Each service only touches its own data; the rest comes through its API or its events.

---

## 2. Conventions

- **Base URL:** `https://api.flashtix.com/v1`
- **Auth:** `Authorization: Bearer <JWT>` from Keycloak (OIDC + PKCE). The gateway validates
  it with Keycloak's JWKS and forwards `X-User-Id` / `X-User-Roles`.
  Levels: **Public**, **FAN**, **ORGANIZER**.
- **Headers:** `X-Correlation-Id` (traced through logs and events) · `Idempotency-Key`
  (required on `POST /orders`) · `X-Admission-Token` (required on `POST /holds`).
- **Formats:** UUID ids · seat id `A-12-07` · ISO-8601 UTC dates · money as
  `{ "amount": 25000000, "currency": "COP" }` (minor units).
- **Errors:** `application/problem+json`, for example
  `{ "status": 409, "code": "SEAT_UNAVAILABLE", "detail": "...", "correlationId": "..." }`.
  Every endpoint may also return `400 VALIDATION_ERROR`, `401 UNAUTHENTICATED`,
  `403 FORBIDDEN`, `429 RATE_LIMITED` (with `Retry-After`), `500` and `503`.

---

## 3. Data schemas (main domains)

| Domain (owner) | Entity | Key fields |
| --- | --- | --- |
| Catalog (Catalog Service) | **Event** | `eventId`, `name`, `artist`, `venue`, `startsAt`, `saleStartsAt`, `status` (`DRAFT`, `ON_SALE`, `SOLD_OUT`, `CANCELLED`), `priceCategories[]` |
| | **Seat** | `seatId`, `section`, `row`, `number`, `category`, `status` (`AVAILABLE`, `HELD`, `SOLD`) |
| Queue (Waiting Room) | **QueueTicket** | `queueTicketId`, `eventId`, `userId`, `position`, `status` (`WAITING`, `ADMITTED`), `admissionToken` (valid 10 min) |
| Hold (Reservation) | **Hold** | `holdId`, `eventId`, `userId`, `seatIds[]` (1-6), `status` (`ACTIVE`, `LOCKED`, `RELEASED`, `CONSUMED`), `orderId`, `expiresAt` |
| Order (Order Service) | **Order** | `orderId`, `userId`, `eventId`, `holdId`, `seats[]`, `total`, `status`, `failureReason`, `version` |
| Payment (Payment Worker) | **Payment** | `paymentId`, `orderId` (unique = idempotency key), `amount`, `status` (`REQUESTED`, `SUCCEEDED`, `FAILED`, `REFUNDED`), `attempts`, `gatewayReference` |
| Ticket (Ticket Service) | **Ticket** | `ticketId`, `orderId`, `eventId`, `seatId`, `qrPayload` (HMAC signed), `pdfObjectKey`, `issuedAt` |

**Order states:** `PENDING` → `CONFIRMED` (payment OK) · `PENDING` → `FAILED` (payment
rejected / hold expired) · `PENDING` or `CONFIRMED` → `REFUND_PENDING` → `CANCELLED`
(seat conflict or organizer refund).

**Storage (ADR 001):**

| Store | Key / table | Content |
| --- | --- | --- |
| `hold-store` (Redis) | `seat:{eventId}:{seatId}` | `holdId`, `SET NX EX 600` |
| `hold-store` (Redis) | `queue:{eventId}` | sorted set by arrival time |
| `catalog-cache` (Redis) | `event:{eventId}` (60 s), `availability:{eventId}` (5 s) | catalog read model |
| `booking-db` (MySQL) | `orders`, `outbox`, `sold_seats` | orders, pending events, sold seats |

```sql
-- Final safety net against overbooking: a seat can be sold only once per event
CREATE TABLE sold_seats (
  event_id CHAR(36)    NOT NULL,
  seat_id  VARCHAR(20) NOT NULL,
  order_id CHAR(36)    NOT NULL,
  sold_at  DATETIME(3) NOT NULL,
  PRIMARY KEY (event_id, seat_id)
) ENGINE=InnoDB;
```

---

## 4. REST APIs

### F1 - Identity (Keycloak)
Login uses the standard OIDC endpoints of Keycloak (`/realms/flashtix/protocol/openid-connect/auth`,
`/token`, `/certs`). FlashTix services never handle passwords; they only receive the validated JWT.

### `GET /events/{eventId}/seats` - Catalog (F2)
- **Auth:** Public
- **Request body:** none
- **Responses:** `200 OK` seat map from `catalog-cache` · `404 EVENT_NOT_FOUND` · `429` · `503`
- **Example `200`:**

```json
{ "eventId": "3f0c8a52-...", "seats": [
  { "seatId": "A-12-07", "category": "VIP", "status": "AVAILABLE" },
  { "seatId": "A-12-08", "category": "VIP", "status": "HELD" } ] }
```

### `POST /events/{eventId}/queue` - Waiting Room (F3)
- **Auth:** FAN
- **Request body:** none
- **Responses:** `202 Accepted` fan added to the queue (one ticket per fan and event) · `404 EVENT_NOT_FOUND` · `409 SALE_NOT_OPEN`
- **Example `202`:** `{ "queueTicketId": "9d2b...", "position": 18452, "status": "WAITING", "pollAfterSeconds": 10 }`

### `GET /events/{eventId}/queue/{queueTicketId}` - Waiting Room (F3)
- **Auth:** FAN (owner)
- **Responses:** `200 OK` (`WAITING` with position, or `ADMITTED` with `admissionToken`) · `404 QUEUE_TICKET_NOT_FOUND` · `410 QUEUE_TICKET_EXPIRED`
- **Example `200`:** `{ "status": "ADMITTED", "admissionToken": "eyJhbGci...", "admissionExpiresAt": "2026-10-20T15:16:00Z" }`

### `POST /holds` - Reservation (F3)
- **Auth:** FAN + `X-Admission-Token`
- **Request body:** `{ "eventId": "uuid", "seatIds": ["A-12-07", "A-12-08"] }` (1 to 6 seats)
- **Behavior:** a Lua script runs `SET seat:{eventId}:{seatId} {holdId} NX EX 600` for all seats: all are held or none.
- **Responses:** `201 Created` · `403 INVALID_ADMISSION_TOKEN` · `409 SEAT_UNAVAILABLE` (lists `unavailableSeatIds`) · `422 TOO_MANY_SEATS` · `503` (Redis down)
- **Example `201`:** `{ "holdId": "c71e...", "seatIds": ["A-12-07", "A-12-08"], "status": "ACTIVE", "expiresAt": "2026-10-20T15:16:00Z" }`

### `DELETE /holds/{holdId}` - Reservation (F3)
- **Auth:** FAN (owner)
- **Responses:** `204 No Content` seats released · `404 HOLD_NOT_FOUND` · `409 HOLD_LOCKED` (already in an order)

### `POST /orders` - Order (F4)
- **Auth:** FAN + `Idempotency-Key`
- **Request body:** `{ "holdId": "uuid", "paymentMethodToken": "tok_..." }` (card tokenized by the gateway SDK; FlashTix never sees card data)
- **Behavior (saga start):** locks the hold through Reservation (gRPC `LockHold`, TTL extended to 300 s),
  then in ONE MySQL transaction saves the order as `PENDING` and `payment.requested` in the outbox.
  It does **not** wait for the payment gateway.
- **Responses:** `202 Accepted` · `202` + `Idempotent-Replayed: true` (same key repeated) · `400 MISSING_IDEMPOTENCY_KEY` · `404 HOLD_NOT_FOUND` · `409 HOLD_EXPIRED` · `409 IDEMPOTENCY_KEY_REUSED` · `503`
- **Example `202`:**

```json
{ "orderId": "e4a7...", "status": "PENDING",
  "total": { "amount": 90000000, "currency": "COP" },
  "statusUrl": "/v1/orders/e4a7..." }
```

### `GET /orders/{orderId}` - Order (F4)
- **Auth:** FAN (owner) or ORGANIZER
- **Responses:** `200 OK` · `404 ORDER_NOT_FOUND`. The same state is also pushed live with SSE at `GET /orders/{orderId}/events`.
- **Example `200`:** `{ "orderId": "e4a7...", "status": "CONFIRMED", "seats": [{ "seatId": "A-12-07" }, { "seatId": "A-12-08" }], "version": 2 }`

### `GET /tickets/{ticketId}` - Ticket (F5)
- **Auth:** FAN (holder)
- **Responses:** `200 OK` · `404 TICKET_NOT_FOUND`
- **Example `200`:** `{ "ticketId": "1a2b...", "seatId": "A-12-07", "qrPayload": "FTX1.1a2b...", "downloadUrl": "https://files.flashtix.com/...pdf?X-Amz-Expires=900" }`

---

## 5. Asynchronous events (RabbitMQ)

**Topology:** one durable topic exchange per domain (`reservation`, `order`, `payment`,
`ticket`), routing key = event name, one quorum queue per consumer (`<consumer>.<event>`)
with retry queue and dead-letter queue (`<queue>.dlq`).

**Delivery guarantees (all events):**
- **At-least-once:** persistent messages, publisher confirms, `ack` after processing. The Order Service publishes through a transactional **outbox**, so no event is lost.
- **Idempotency:** consumers save the `eventId` (or the business key in the table) and ignore repeats.
- **Ordering:** not guaranteed between consumers; consumers check `aggregateVersion` and the current state, and ignore older events.
- **Retries:** 3 with backoff (1 s, 10 s, 60 s), then DLQ + alert.

**Common envelope:**

```json
{ "eventId": "uuid", "eventType": "order.confirmed", "eventVersion": 1,
  "occurredAt": "2026-10-20T15:07:19Z", "producer": "order-service",
  "correlationId": "uuid", "aggregateId": "uuid", "aggregateVersion": 2,
  "data": { } }
```

| Event (exchange) | Producer | Consumers | `data` payload | Idempotency key |
| --- | --- | --- | --- | --- |
| `seat.held` (reservation) | Reservation | Catalog | `holdId`, `eventId`, `seatIds[]`, `expiresAt` | `eventId` |
| `seat.released` (reservation) | Reservation | Catalog | `holdId`, `eventId`, `seatIds[]`, `reason` (`EXPIRED`, `CANCELLED_BY_USER`, `ORDER_FAILED`) | `eventId` |
| `payment.requested` (order) | Order | Payment Worker | `orderId`, `userId`, `amount`, `paymentMethodToken` | `orderId` (also sent to the gateway) |
| `payment.succeeded` (payment) | Payment Worker | Order | `paymentId`, `orderId`, `amount`, `gatewayReference` | `orderId` |
| `payment.failed` (payment) | Payment Worker | Order | `paymentId`, `orderId`, `reason` (`DECLINED`, `GATEWAY_TIMEOUT`, `GATEWAY_UNAVAILABLE`), `attempts` | `orderId` |
| `order.confirmed` (order) | Order | Ticket, Catalog, Reservation | `orderId`, `userId`, `userEmail`, `eventId`, `holdId`, `seats[]` | `eventId`; Ticket also `(orderId, seatId)` |
| `order.failed` (order) | Order | Reservation, Notification | `orderId`, `userEmail`, `eventId`, `holdId`, `reason` | `eventId` |
| `refund.requested` (order) | Order | Payment Worker | `orderId`, `paymentId`, `amount`, `reason` (`SEAT_CONFLICT`, `EVENT_CANCELLED`) | `orderId` (refund once) |
| `refund.completed` (payment) | Payment Worker | Order | `orderId`, `paymentId`, `gatewayReference` | `orderId` |
| `order.cancelled` (order) | Order | Notification | `orderId`, `userEmail`, `eventId`, `reason`, `refunded` | `dedupKey` |
| `ticket.issued` (ticket) | Ticket | Notification | `orderId`, `userEmail`, `eventId`, `tickets[]` (`ticketId`, `seatId`, `pdfObjectKey`) | `dedupKey` |

**Payment gateway calls** (Payment Worker): timeout 20 s, 3 retries (2 s, 10 s, 30 s),
circuit breaker (opens at 50 % failures in 30 s). After the last failure it publishes
`payment.failed` with `GATEWAY_UNAVAILABLE`.

---

## 6. Requirements and scenarios

### Requirement: F1 - Authentication at the API Gateway
The API Gateway SHALL validate the JWT (signature, `exp`, `iss`, `aud`) and the role of every protected route before routing.

#### Scenario: Valid token
- **WHEN** a fan calls `POST /v1/holds` with a valid JWT with role `FAN`
- **THEN** the gateway forwards the request with `X-User-Id` and the Reservation Service processes it

#### Scenario: Missing or expired token
- **WHEN** a request reaches a protected route without a JWT or with an expired one
- **THEN** the gateway answers `401 UNAUTHENTICATED` and no service receives it

### Requirement: F2 - Catalog without touching the transactional database
The Catalog Service SHALL answer catalog and availability reads from `catalog-cache` and SHALL never read `booking-db`.

#### Scenario: Cache hit
- **WHEN** a fan calls `GET /v1/events/{eventId}/seats` and the data is in Redis
- **THEN** the service answers `200 OK` from Redis (p95 < 50 ms) with no MySQL query

#### Scenario: Availability updated by events
- **WHEN** `order.confirmed` is consumed for seat `A-12-07`
- **THEN** the seat appears as `SOLD` in the next seat map request

### Requirement: F3 - Virtual queue and soft reservation in memory
The Waiting Room SHALL admit fans in batches, and the Reservation Service SHALL hold all requested seats or none in `hold-store` with a 600 s TTL.

#### Scenario: Admission
- **WHEN** the fan's turn arrives in the virtual queue
- **THEN** `GET /queue/{queueTicketId}` returns `ADMITTED` with an `admissionToken` valid for 10 minutes

#### Scenario: Two fans want the same seat
- **WHEN** two admitted fans call `POST /v1/holds` for seat `A-12-07` at the same moment
- **THEN** only one gets `201 Created`; the other gets `409 SEAT_UNAVAILABLE`

#### Scenario: Hold expires
- **WHEN** 600 s pass and the hold was not used in an order
- **THEN** Redis deletes it, the seat can be held again and `seat.released` (`EXPIRED`) is published

### Requirement: F4 - Asynchronous payment and confirmation
The Order Service SHALL answer the checkout without calling the payment gateway, and SHALL confirm or fail the order only from payment events.

#### Scenario: Checkout accepted
- **WHEN** a fan calls `POST /v1/orders` with an active hold and an `Idempotency-Key`
- **THEN** the order is saved as `PENDING`, `payment.requested` is published and the fan receives `202 Accepted` in less than 300 ms

#### Scenario: Payment approved
- **WHEN** `payment.succeeded` arrives for a `PENDING` order
- **THEN** in one MySQL transaction the seats are inserted in `sold_seats`, the order becomes `CONFIRMED` and `order.confirmed` is published

#### Scenario: Overbooking prevented
- **WHEN** the payment succeeds but `sold_seats` rejects the seat as a duplicate
- **THEN** the order goes to `REFUND_PENDING`, the payment is refunded and the order ends `CANCELLED`; the seat is sold only once

### Requirement: F5 - Ticket generated and delivered by events
The Ticket Service SHALL issue one ticket per seat from `order.confirmed`, and the Notification Worker SHALL email it once.

#### Scenario: Ticket delivered
- **WHEN** `order.confirmed` is consumed for an order with two seats
- **THEN** two PDF + QR tickets are stored, `ticket.issued` is published and the fan receives one email with both tickets

#### Scenario: Duplicate event
- **WHEN** `order.confirmed` or `ticket.issued` is delivered twice
- **THEN** no duplicate ticket is created and no second email is sent

---

## 7. Operational parameters

| Parameter | Value |
| --- | --- |
| Hold TTL / after `LockHold` | 600 s / 300 s |
| Admission token validity | 10 min |
| Max seats per hold | 6 |
| Gateway timeout / retries | 20 s / 3 (2 s, 10 s, 30 s) |
| Event retries | 3 (1 s, 10 s, 60 s), then DLQ |
| Rate limit | 20 req/s per user · 100 req/s per IP |
| Target p95 | catalog < 50 ms · hold < 100 ms · `POST /orders` < 300 ms |
