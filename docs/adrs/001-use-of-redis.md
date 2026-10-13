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
