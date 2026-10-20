# ADR 002 - Migration of the transactional database from MySQL to PostgreSQL
 
**Status:** Proposed
**Date:** 2026-10-13
**Authors:** Carlos Andrés Arteaga, Álvaro Sotelo, Santiago Vallejo, Duvan Leal and Juan Pablo Florez
 
## In one sentence
The new microservices store the final sale in PostgreSQL instead of MySQL, because PostgreSQL offers stronger and simpler rules to guarantee that a seat is never sold twice.
 
## What's the problem
Thanks to ADR 001 (Redis), the database is no longer the bottleneck, but it is still the final judge of every sale. It must guarantee a single active sale per seat, even if a payment fails or is retried, and it must support schema changes while the monolith is being split.
 
## What we decided
Use PostgreSQL as the source of truth: seats, orders, payments and tickets. MySQL is only used to copy the data and is then retired.
 
## Why PostgreSQL
- **Partial unique index:** `UNIQUE (seat_id) WHERE status = 'SOLD'` allows only one active sale per seat and keeps the cancellation history. MySQL doesn't have this.
- **`ON CONFLICT DO NOTHING`:** if a payment is retried, no duplicate order is created.
- **Transactional DDL:** if a schema migration fails, everything is rolled back.
## What we gain / what we lose
✅ The "never sell twice" rule lives in the database itself, retries are harmless and migrations are safer.
⚠️ Existing data must be migrated and the team must learn PostgreSQL.
 
## How we address it
Migration with pgloader during a maintenance window, per-table count validation, MySQL in read-only mode as a backup, and gradual retirement of the monolith (strangler pattern).
 
## Discarded alternatives
- Staying with MySQL 8, because it is harder to guarantee uniqueness.
- NoSQL, because relational constraints are lost.
- Distributed SQL, because it is overkill for this case.
## Conclusion
The 504 errors are solved by Redis and asynchronous payments. PostgreSQL is the last line of defense against overselling: even if everything else fails, it never sells the same seat twice.