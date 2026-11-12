# ADR 005: Use HAProxy as load balancer in front of Kong API Gateway

- **Status:** Accepted
- **Date:** 2026-11-12
- **Authors:** FlashTix team

## Context

The C4 Level 2 diagram and the target architecture (`docs/infrastructure.md`) have always contemplated placing a load balancer in front of Kong API Gateway, listed as "Phase 3 (GW-6), optional". The infrastructure table previously showed:

| Target (C4 / ADR / `spec.md`) | In this compose | Status |
|---|---|---|
| HAProxy in front of Kong | Not included | Phase 3 (GW-6), optional |

Previously, Kong 3.8 ran as a single DB-less instance on port 8000, acting as the single entry point for all client traffic. This was acceptable for development but did not align with the target C4 architecture.

## Decision

**Deploy HAProxy 2.8 as a dedicated load balancer in front of Kong API Gateway.**

Architecture:
```
Client → HAProxy (port 8000) → Kong (internal api-gateway:8000) → Microservices
```

- **HAProxy** listens on port 8000 (public API entry point) and port 8404 (stats UI)
- **Kong** runs internally on port 8000, no longer exposed to host
- HAProxy performs round-robin load balancing across Kong instances (single instance for dev, extensible for HA)
- HAProxy provides `/health` endpoint for container health checks
- TLS termination can be added at HAProxy layer in production

### Why HAProxy?

| Option | Decision | Reason |
|---|---|---|
| **HAProxy 2.8** | ✅ **Chosen** | Mature, lightweight, battle-tested; native round-robin/least-conn/hash balancing; built-in health checks; stats UI; low resource usage |
| Nginx | ❌ Not chosen | More complex config for pure load balancing; heavier |
| Traefik | ❌ Not chosen | Kubernetes-focused; overkill for Docker Compose |
| Envoy | ❌ Not chosen | Complex config; better suited for service mesh |
| Cloud LB (AWS ALB, etc.) | ⚠️ Deferred | For production only; HAProxy works in all environments |

## Consequences

### Positive
- **Aligns with C4 architecture**: Load Balancer component now implemented (Phase 3 GW-6 done)
- **Single entry point**: HAProxy is the only port clients use (8000)
- **Load balancing ready**: Easy to add multiple Kong instances for HA
- **TLS termination ready**: Can add SSL at HAProxy layer without touching Kong
- **Observability**: HAProxy stats UI (port 8404) provides real-time metrics
- **Health checks**: HAProxy health checks Kong before forwarding traffic
- **Separation of concerns**: Kong focuses on API Gateway logic (JWT, rate limiting, routing); HAProxy focuses on load balancing and edge concerns

### Negative
- **Additional container**: One more service in docker-compose
- **Extra hop**: Minimal latency (~1ms) for HAProxy → Kong forwarding
- **Configuration sync**: HAProxy config must match Kong's internal port

## Implementation Details

- **File**: `infra/haproxy/haproxy.cfg`
- **Docker service**: `load-balancer` (image `haproxy:2.8-alpine`)
- **Ports**: 8000 (public API), 8404 (stats UI)
- **Health check**: `GET /health` returns 200 OK from HAProxy directly
- **Kong health check**: HTTP `GET /` on `api-gateway:8000` (accepts any response = Kong is up)
- **Dependencies**: `load-balancer` depends on `api-gateway:service_healthy`
- **Env var**: `HAPROXY_STATS_PASSWORD` for stats UI auth

## When to Revisit

- **Multiple Kong instances**: Add more `server` lines in HAProxy backend for HA
- **Production TLS**: Add SSL certificates and `bind *:443 ssl crt ...` in HAProxy frontend
- **Kubernetes migration**: Replace HAProxy with Ingress Controller (NGINX/Traefik/Envoy)
- **Advanced rate limiting**: Add stick tables in HAProxy for global rate limiting before Kong

## References

- [docs/infrastructure.md](../infrastructure.md) — "Current scope and differences from the target architecture" table (now shows HAProxy as Done)
- [docs/spec.md](../spec.md) — Section 1, services table (now includes Load Balancer row)
- [infra/haproxy/haproxy.cfg](../infra/haproxy/haproxy.cfg) — HAProxy configuration
- C4 Level 2 diagram — Load Balancer component