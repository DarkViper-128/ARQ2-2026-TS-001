# 003 - Asynchronous payment processing with RabbitMQ

- **Status:** Accepted
- **Date:** 2026-10-13 (updated 2026-10-20)
- **Authors:** Carlos Andrés Arteaga, Álvaro Sotelo, Santiago Vallejo, Duvan Leal and Juan Pablo Florez

## In one sentence

Checkout no longer waits for the bank: the Order Service saves the order, leaves a message in RabbitMQ and responds to the user immediately. Meanwhile, a Payment Worker talks to the slow gateway in the background.

## What is the problem

The legacy payment gateway takes up to 15 seconds to respond, and we can't change it. Today the monolith calls it inside the purchase. Each buyer keeps a connection and a lock open for 15 seconds, connections run out and 504 errors appear. If the gateway fails, the purchase is left half-done.

## What we decided

Process payments asynchronously with RabbitMQ, orchestrated as a **saga** by the Order Service (Features 4 and 5):

1. On `POST /orders`, the **Order Service** asks the Reservation Service to lock the hold and extend its TTL, saves the order as `PENDING` and writes `payment.requested` to its outbox in **one MySQL transaction**, then responds `202 Accepted` with the order id.
2. The **Payment Worker** consumes `payment.requested`, calls the gateway and publishes `payment.succeeded` or `payment.failed`.
3. On `payment.succeeded`, the Order Service inserts the seats into `sold_seats` (`UNIQUE (event_id, seat_id)`), sets the order to `CONFIRMED` and publishes `order.confirmed`, all in one transaction.
4. The **Ticket Service** consumes `order.confirmed`, builds the PDF + QR ticket and publishes `ticket.issued`; the **Notification Worker** consumes it and emails the fan (Feature 5).
5. The client follows the order status with `GET /orders/{id}` or live through SSE.

**Why RabbitMQ:** it is built for work queues, comes with acknowledgements, retries and dead-letter queues, and is easy to run in Docker.

## What we gain / what we lose

- ✅ The API responds in milliseconds. A slow gateway no longer takes down the platform. More workers can be added during peaks, and failed payments are retried.
- ⚠️ The user doesn't see "paid" instantly (eventual consistency). A message may arrive twice. The hold may expire during payment. Also, we now depend on RabbitMQ.

## How we solve it

- **No lost events:** the Order Service uses a transactional outbox; messages are persistent and use publisher confirms.
- **Idempotency:** the `orderId` is the payment idempotency key (unique in `payment-db` and sent to the gateway), so a retry never charges twice. Every consumer stores the `eventId` in `processed_events` and ignores repeats.
- **Retries with increasing wait:** gateway calls have a 20 s timeout, 3 retries (2 s, 10 s, 30 s) and a circuit breaker. If they all fail, `payment.failed` is published, the order becomes `FAILED` and the hold is released. Broken messages go to the DLQ.
- **Hold TTL:** when checkout starts, the hold is extended to cover the whole payment (timeout + retries).
- **Compensation:** if the payment succeeds but the seat was already sold (`UNIQUE` violation), the saga publishes `refund.requested`, the Payment Worker refunds the card and the order ends as `CANCELLED`.

## Alternatives considered

- **Synchronous call with a longer timeout:** the 504s remain.
- **Kafka:** heavier to operate and has no native per-message retries or DLQ.
- **Gateway webhooks:** the legacy gateway doesn't support them.
- **Choreography (no orchestrator):** every service would react to the others' events; with refunds and timeouts the flow becomes hard to follow, so the Order Service orchestrates it.

## Conclusion

The 15 s gateway is the slowest piece of FlashTix. The only way to keep it from blocking everyone is to take it out of the user's request. RabbitMQ and the checkout saga do exactly that, keep failed payments safe for retry or refund, and fulfill Features 4 and 5. Event contracts are defined in [spec.md](../spec.md).
