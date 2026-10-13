# 001 - Use of Redis

- **Status:** Accepted
- **Date:** 2026-10-12
- **Authors:** Duvan Leal, Santiago Vallejo, Carlos Andrés Arteaga

## In one sentence
Instead of thousands of people asking MySQL everything directly, we put Redis
(super fast memory) in front for reads and to "hold" seats for a few minutes.

## What is the problem (in plain words)
Imagine FlashTix is a store with a SINGLE cash register (MySQL).
- Everyone who just wants to LOOK at the catalog lines up at that register. With
  500,000 people, the line explodes and nobody moves.
- When someone BUYS, the register puts a lock on that seat and does not release it
  until the bank (legacy payment gateway) answers... and the bank takes 15 seconds.
  Meanwhile, everyone waits with the lock held.
- Result: 504 errors, angry users and, worse, seats sold twice (overbooking).

## What we decided
Use *Redis* (RAM memory, very fast) to:
1. Serve the catalog and seat availability WITHOUT touching MySQL. [Feature 2]
2. Store the temporary seat "hold" with a TTL (if you do not pay within X minutes,
   the seat is released by itself). [Feature 3]

MySQL stays the *source of truth*: the final sale is stored there.

## Why TTL (Time To Live)
It is like a shopping cart that empties itself. You reserve the seat, a timer
starts, and if you do not finish the payment, the seat is released automatically
for someone else. That way no seat stays "frozen" forever.
## What we gain
- Reads are almost instant (they do not drive MySQL crazy).
- Locks last very little (TTL) instead of 15 seconds.
- It handles huge spikes of users.
- MySQL only works when a purchase is actually confirmed.

## What we lose / risks
- We have to think carefully about how to clean the cache so we do not show old data.
- Now we depend on Redis being up and running.
- If Redis restarts, some holds can be lost.

## How we solve it
- We turn on persistence (AOF) so Redis does not forget everything on restart.
- Before confirming the purchase, we re-check that the seat is still held.
- In MySQL we add a rule (`UNIQUE` on the seat): so, even if something fails, the
  same seat can NEVER be sold twice. This is the final safety net against
  overbooking.
- When someone really buys, we send a `catalog.updated` event to refresh the cache.
