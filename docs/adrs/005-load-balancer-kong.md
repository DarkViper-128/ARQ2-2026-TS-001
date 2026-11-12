# ADR 005: No dedicated load balancer in front of Kong API Gateway

- **Status:** Accepted
- **Date:** 2026-11-12
- **Authors:** FlashTix team

## Context

The C4 Level 2 diagram and the target architecture (docs/infrastructure.md) contemplate placing a load balancer (HAProxy) in front of Kong API Gateway, listed as "Phase 3 (GW-6), optional". The infrastructure table in docs/infrastructure.md compares:

| Target (C4 / ADR / `spec.md`) | In this compose | Status |
|---|---|---|
| HAProxy in front of Kong | Not included | Phase 3 (GW-6), optional |

Currently, Kong 3.8 runs as a single DB-less instance on port 8000, acting as the single entry point for all client traffic. Kong handles:
- JWT validation and role-based access control
- Rate limiting per user and per IP
- Routing to the 7 microservices
- `Idempotency-Key` and correlation ID propagation
- `post-function` plugins that set `X-User-Id`, `X-User-Email`, `X-User-Roles`

No separate load balancer is deployed in `docker-compose.yml`.

## Decision

Do **not** deploy a dedicated load balancer (HAProxy, Nginx, Traefik, AWS ALB, etc.) in front of Kong for development and current deployment targets.

Kong 3.8 already functions as:
- **API Gateway**: single entry point, authentication, authorization, rate limiting
- **Load balancer**: Kong has built-in load balancing across upstreams (round-robin, hash-based, etc.) so when microservices are scaled to multiple replicas, Kong distributes traffic among them without needing an external LB
- **Edge proxy**: TLS termination, request transformation, and plugin execution all happen at the gateway layer

A separate load balancer would be redundant for the current single-node Docker Compose deployment.

## Alternatives considered

| Option | Decision | Reason |
|---|---|---|
| No external load balancer | ✅ **Accepted** | Kong already provides gateway + load balancing; redundant for single-node deployment |
| HAProxy in front of Kong | ❌ Not implemented | Would add another hop without tangible benefit at current scale |
| Nginx / Traefik / Envoy | ❌ Not needed | Same capability already provided by Kong |
| Cloud load balancer (AWS ALB, etc.) | ⚠️ Deferred | Only needed in production with multiple Kong instances or TLS termination at the edge |

## Consequences

### Positive
- **Simpler architecture**: one fewer moving part to configure, monitor, and debug
- **Faster startup**: `docker compose up` works without an additional container
- **Kong is sufficient**: Kong 3.8 provides all edge functionality needed (routing, auth, rate limiting, load balancing across upstreams)
- **Service name neutrality**: Kong remains the single, well-known entry point (`api-gateway:8000`)

### Negative
- **No TLS termination at edge**: currently TLS is not terminated before Kong; in production this may need a cloud LB or ingress controller
- **No global rate limiting beyond Kong**: Kong's rate limiting is the only layer; an external LB could add DDoS protection before traffic reaches Kong
- **Single point**: one Kong instance is the single entry point; if it goes down, the entire API is unavailable

## When to revisit

Reconsider adding a load balancer in front of Kong when any of the following is true:
- Multiple Kong instances are deployed for high availability
- Production traffic requires TLS termination or WAF/DDoS protection before Kong
- Global rate limiting or traffic shaping is needed before Kong sees the request
- The platform moves from Docker Compose to Kubernetes (ingress controller replaces this concern)

## References

- [docs/infrastructure.md](../infrastructure.md) — "Current scope and differences from the target architecture" table
- [docs/spec.md](../spec.md) — Section 1, API Gateway row
- Kong 3.8 documentation — load balancing and routing capabilities