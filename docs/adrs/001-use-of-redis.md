# 001 - Use of Redis

- **Status:** Accepted
- **Date:** 2026-10-12 (updated 2026-10-13)
- **Authors:** Duvan Leal, Santiago Vallejo, Carlos Andrés Arteaga, Álvaro Sotelo and Juan Pablo Florez

## In one sentence

We put Redis (super fast memory) in front of MySQL for catalog reads, the virtual queue and the temporary seat hold.

## What is the problem

FlashTix has a single "cash register" (MySQL):

- 500,000 people querying the catalog saturate the database.
- Every purchase locks the seat for the 15 seconds the payment gateway takes to answer.
- Result: 504 errors and seats sold twice (overbooking).

## What we decided

Use two Redis instances:

| Instance | Use | Configuration |
| --- | --- | --- |
| `catalog-cache` | Catalog and availability (F2) | LRU, no persistence |
| `hold-store` | Holds with TTL and virtual queue (F3) | AOF, `noeviction`, Sentinel |

- The catalog is read from Redis and only goes to MySQL if the data is not in the cache.
- The virtual queue lets users in by batches.
- A seat is held for 10 minutes with `SET NX EX 600`. If several seats are selected, a Lua script holds all of them or none.
- MySQL remains the source of truth for the final sale.

**Why two Redis instances?** A cache may evict data when it fills up, but a hold must not be evicted. If it were, the seat would look free while someone is paying for it.

## What we gain / what we lose

- ✅ Instant reads, short locks instead of 15 s, control over who enters checkout, and MySQL working only on real purchases.
- ⚠️ Risk of showing stale data, dependency on Redis, and holds that can be lost or expire during payment.

## How we solve it

- The cache is refreshed with RabbitMQ events (`seat.held`, `seat.released`, `order.confirmed`).
- Redis has replicas and AOF persistence, so on a restart at most 1 second of data is lost.
- When payment starts, the hold's TTL is extended to cover the gateway time.
- Safety net: `UNIQUE (event_id, seat_id)` in MySQL prevents selling a seat twice. If that rule fires after the customer has been charged, a refund is issued.

## Alternatives considered

- **MySQL replicas:** the 15 s locks would remain.
- **In-memory cache inside each service:** replicas would not share the holds.
- **A single Redis for everything:** the cache could evict holds.

## Conclusion

Redis stops "looking" from taking the database down and makes "holding" instant. MySQL guarantees the sale without duplicates. This solves the FlashTix bottleneck and satisfies Features 2 and 3.
