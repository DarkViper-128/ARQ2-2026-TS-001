# 003 - Asynchronous payment processing with RabbitMQ

- **Status:** Proposed
- **Date:** 2026-10-13
- **Authors:** Carlos Andrés Arteaga, Álvaro Sotelo, Santiago Vallejo, Duvan Leal and Juan Pablo Florez

## In one sentence

Checkout no longer waits for the bank: it leaves a message in RabbitMQ and responds to the user immediately. Meanwhile, a payment worker talks to the slow gateway in the background.

## What is the problem

The legacy payment gateway takes up to 15 seconds to respond, and we can't change it. Today the monolith calls it inside the purchase. Each buyer keeps a connection and a lock open for 15 seconds, connections run out and 504 errors appear. If the gateway fails, the purchase is left half-done.

## What we decided

Process payments asynchronously with RabbitMQ (Feature 4):

1. The Reservation Service verifies the hold in Redis, publishes `reservation.created` and responds `202 Accepted` with the order id.
2. The Payment Worker consumes the message, calls the gateway and publishes `payment.result`.
3. The client polls the status of their order.
4. The Ticket / Email Worker generates the ticket and sends it by email (Feature 5).

**Why RabbitMQ:** it is built for work queues, comes with retries and DLQ included, and is easy to run in Docker.

## What we gain / what we lose

- ✅ The API responds in milliseconds. A slow gateway no longer takes down the platform. More workers can be added during peaks, and failed payments are retried.
- ⚠️ The user doesn't see "paid" instantly (eventual consistency). A message may arrive twice. The hold may expire during payment. Also, we now depend on RabbitMQ.

## How we solve it

- **Idempotency:** each order has a unique key and `ON CONFLICT DO NOTHING` (ADR 002) prevents duplicates.
- **Retries with increasing wait:** after N attempts the message goes to the DLQ and the seat is released.
- **Hold TTL:** lasts longer than the maximum payment time.
- **Durable queues and messages:** payments are not lost if RabbitMQ restarts.

## Alternatives considered

- **Synchronous call with a longer timeout:** the 504s remain.
- **Kafka:** heavier to operate and has no native DLQ.
- **Gateway webhooks:** the legacy gateway doesn't support them.

## Conclusion

The 15 s gateway is the slowest piece of FlashTix. The only way to keep it from blocking everyone is to take it out of the user's request. RabbitMQ does exactly that, stores failed payments for retry, and fulfills Features 4 and 5.
