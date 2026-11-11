# Spike GW-2: validating Keycloak JWTs at the API Gateway

- **Date:** 2026-11-11
- **Task:** GW-2, "JWT validation against Keycloak's JWKS (RS256)"
- **Outcome:** Kong OSS `jwt` plugin with the realm's RSA public key pinned in `kong.yml`

## Question

Mandatory feature 1 says authentication and session validation happen **at the API
Gateway**. A request without a valid token must be rejected there and never reach a
service. Kong has to check an RS256 signature produced by Keycloak. How?

## What was tried

### Option 1: `openid-connect` plugin

The plugin that does exactly this (discovery document, JWKS, caching, rotation) is
**Kong Enterprise only**. Not available to us.

### Option 2: a third-party plugin (`kong-plugin-jwt-keycloak`)

Fetches the JWKS and handles rotation. It has to be installed into the image, which means
building a custom Kong image with LuaRocks and pinning a community plugin that is not
maintained in step with Kong releases. Rejected: too much machinery for the value, and it
puts a build step between the team and a working gateway.

### Option 3: Kong OSS `jwt` plugin with a pinned public key (chosen)

The bundled `jwt` plugin verifies RS256 if it is given the public key. It matches the
token to a consumer by a claim, `iss` by default.

The obstacle is that Keycloak generates a **new** realm keypair every time the realm is
imported, so the public key would change on every `docker compose down -v`, and the
gateway configuration would be wrong until someone copied the new key across.

The fix is to stop letting Keycloak choose: the realm export pins the keypair.
`infra/keycloak/flashtix-realm.json` carries an RSA key provider with an explicit
`privateKey` and `certificate`, and `infra/kong/kong.yml` carries the matching public key.
Both were generated once with `openssl` and committed.

```
openssl req -x509 -newkey rsa:2048 -keyout kc.key -out kc.crt -days 3650 -nodes -subj "/CN=flashtix"
openssl rsa -in kc.key -pubout -out kc.pub
```

## How it works now

```
client ──Bearer JWT──▶ Kong (jwt plugin)
                         ├─ no token or bad signature ──▶ 401, the service never sees it
                         └─ valid ──▶ reservation service
```

- The consumer `keycloak-flashtix` has `key: http://localhost:8080/realms/flashtix`, which
  is the `iss` claim of every token the realm issues.
- `claims_to_verify: [exp]` makes Kong reject expired tokens.
- `GET /v1/events*` carries no plugin: browsing the catalog stays public.

Keycloak runs with `KC_HOSTNAME_STRICT=false` and is reached on `localhost:8080`, so the
issuer is stable and matches what Kong expects.

## What this costs us

| Trade-off | Detail |
| --- | --- |
| **No key rotation** | Kong is not reading the JWKS at runtime. If the realm key is ever replaced, `kong.yml` must be updated by hand. Acceptable while the key is pinned and committed; it would not be acceptable in production. |
| **A private key in the repository** | It is a throwaway development key for a local realm, like the passwords in `.env.example`. It must never be reused anywhere real. |
| **Issuer is environment-specific** | `kong.yml` hard-codes `http://localhost:8080/...`. Deploying anywhere else means changing that line. |
| **Roles are not checked yet** | The plugin proves *who* the caller is, not *what they may do*. Route-level role checks are GW-3 in Phase 3. |

## Follow-up

- **GW-3** adds role enforcement so `/v1/admin/*` needs `ORGANIZER`.
- **GW-4** makes the gateway set `X-User-Id` and `X-User-Roles`. Until then the services
  read the `sub` claim from the already-validated token themselves
  (`currentUserId()` in `@flashtix/nest-support`), which is only safe because the gateway
  is the single entry point.
- If the team ever needs rotation, revisit option 2, or add a small init container that
  reads the JWKS and writes `kong.yml` before Kong starts.
