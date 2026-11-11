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
├── package.json         # npm workspaces root
├── tsconfig.base.json   # compiler options shared by every package
├── docker-compose.yml   # local infrastructure and services
├── .env.example         # template for the local .env (never commit .env)
├── libs/
│   ├── shared/          # @flashtix/shared: events, errors, correlation id
│   └── nest-support/    # @flashtix/nest-support: problem+json filter, request identity
├── services/
│   ├── catalog/         # events and seat availability (read-only)
│   ├── reservation/     # soft seat holds with TTL
│   └── order/           # checkout saga, source of truth for every sale
├── tools/
│   └── payment-gateway-mock/   # stand-in for the legacy payment gateway
├── infra/
│   ├── keycloak/        # realm, roles and test users
│   ├── kong/            # API Gateway declarative configuration
│   ├── mysql/           # schema and seed data per database
│   └── rabbitmq/        # broker config and generated topology
├── proto/               # gRPC contracts between services
├── scripts/             # smoke tests
└── docs/
    ├── spec.md             # API and contract specification (OpenSpec format)
    ├── monorepo.md         # code layout, shared library and Docker build rule
    ├── infrastructure.md   # how to run and verify everything locally
    ├── adrs/               # Architecture Decision Records
    ├── spikes/             # findings that justify a technical choice
    └── assets/             # C4 architecture diagrams (.png / .jpg)
```

For Wave 2 the source code of the microservices, the API Gateway and `docker-compose.yml` will be added at the root of this repository (monorepo), keeping `docs/` intact.

## Run locally

Requires Docker Desktop, and Node.js 20+ only if you want to build the code outside Docker.
From the root of the repository:

```bash
cp .env.example .env      # Windows PowerShell: copy .env.example .env
# edit .env and replace every "change-me"
docker compose up -d --build
docker compose ps         # every service must be "healthy"
```

This starts the infrastructure (five MySQL databases, two Redis instances, RabbitMQ with
its full topology, S3 storage, Mailpit and the payment gateway mock) and the first
services: Keycloak, the Kong API Gateway, the Catalog Service and the Reservation Service.
The containers ending in `-init` set things up and exit, so `exited (0)` is expected.
Stop everything with `docker compose down`.

**All client traffic goes through the gateway on <http://localhost:8000>.** Check the
first end-to-end flow with:

```bash
./scripts/smoke-phase1.sh
```

To build the code:

```bash
npm install
npm run build
```

See [docs/infrastructure.md](docs/infrastructure.md) for ports, verification commands and
troubleshooting, and [docs/monorepo.md](docs/monorepo.md) for the code layout and how to
add a service.

## Architecture Decision Records

| ADR | Title | Status |
| --- | --- | --- |
| [001](docs/adrs/001-use-of-redis.md) | Use of Redis (catalog read cache and seat soft reservation with TTL) | Accepted |
| [002](docs/adrs/002-Migration-of-the-DB.md) | Migration of the transactional database from MySQL to PostgreSQL | Rejected |
| [003](docs/adrs/003-async-payments-rabbitmq.md) | Asynchronous payment processing with RabbitMQ (checkout saga) | Accepted |

New ADRs start from [`docs/adrs/000-template.md`](docs/adrs/000-template.md).

## Project phases

- **Wave 1 - Planning, Design and Specification (done):** Tech Spec (DDD analysis, C4 container diagram, ADRs) and `docs/spec.md`.
- **Wave 2 - Execution and Implementation (in progress):** Phase 0 (monorepo skeleton, shared library, RabbitMQ topology, object storage, mail catcher, payment gateway mock) and Phase 1 (Keycloak, Kong as the single entry point, Catalog Service, Reservation Service and the first event-driven flow) are complete and covered by `scripts/smoke-phase1.sh`. Next are the Waiting Room, the Order Service and the checkout saga, then the remaining services and the observability stack. Target: containerized services with Docker and Docker Compose, an API Gateway as the single entry point, databases, a message broker, a cache (Redis) and an observability stack (Prometheus, Loki, Grafana).

## Conventions

- All deliverables (Tech Spec, `spec.md`, ADRs, diagram labels, code, comments, README and commit messages) are written in English.
- Every team member must have commits in this repository in both waves.

