# ARQ2-2026-TS-001

**FlashTix - Ticket Sales Platform** · Software Architecture II Project · Team TS-001

## Tech Spec

The official Tech Spec lives in Google Docs (it is not copied into this repository):

**[TS-001 - Tech Spec (Google Docs)](https://docs.google.com/document/d/1-AFlBlVcvafUERSNm0P2-3Cm0WpNemYI0IGmoMNPLa0/edit?usp=sharing)**

The ADRs in `docs/adrs` and the Tech Spec are kept consistent with each other.

## Team

- Carlos Andrés Arteaga
- Álvaro Sotelo
- Santiago Vallejo
- Duvan Leal
- Juan Pablo Florez

## About the project

This repository holds the design, specification and (later) the implementation of the solution for **Case 1: FlashTix**.

FlashTix sells tickets for global concerts. On a launch day, 500,000 users hit a Node.js monolith backed by a single MySQL database. Catalog reads exhaust the connection pool, row-level locks stay open while a legacy payment gateway takes up to 15 seconds to answer, users get `504 Gateway Timeout`, and failed transactions cause overbooking.

The solution has to cover five mandatory features:

1. User authentication and session validation through the API Gateway.
2. Ultra-fast catalog and seat availability queries without touching the main transactional database.
3. A soft reservation (virtual queue) that temporarily holds the selected seat in low-latency in-memory storage.
4. Payment processing and reservation confirmation delegated to an asynchronous worker.
5. Asynchronous, event-driven generation and delivery of the digital ticket by email.

## Repository structure

```text
.
├── README.md
└── docs/
    ├── spec.md      # API and contract specification (OpenSpec format)
    ├── adrs/        # Architecture Decision Records
    │   ├── 000-template.md
    │   └── 001-use-of-redis.md
    └── assets/      # C4 architecture diagrams (.png / .jpg)
```

For Wave 2 the source code of the microservices, the API Gateway and `docker-compose.yml` will be added at the root of this repository (monorepo), keeping `docs/` intact.

## Architecture Decision Records

| ADR | Title | Status |
| --- | --- | --- |
| [001](docs/adrs/001-use-of-redis.md) | Use of Redis (catalog read cache and seat soft reservation with TTL) | Accepted |

New ADRs start from [`docs/adrs/000-template.md`](docs/adrs/000-template.md).

## Project phases

- **Wave 1 - Planning, Design and Specification (in progress):** Tech Spec (DDD analysis, C4 container diagram, ADRs) and `docs/spec.md`.
- **Wave 2 - Execution and Implementation:** containerized services with Docker and Docker Compose, an API Gateway as the single entry point, databases, a message broker, a cache (Redis) and an observability stack (Prometheus, Loki, Grafana).

## Conventions

- All deliverables (Tech Spec, `spec.md`, ADRs, diagram labels, code, comments, README and commit messages) are written in English.
- Every team member must have commits in this repository in both waves.

