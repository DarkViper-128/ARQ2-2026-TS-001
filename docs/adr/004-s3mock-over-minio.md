# ADR 004: Use s3mock instead of MinIO for S3-compatible object storage

## Status
Accepted

## Context
The FlashTix project requires S3-compatible object storage to store ticket PDFs (Ticket Service). The original specification (spec.md) and C4 diagrams mentioned **MinIO** as the storage solution.

However, when implementing the infrastructure with Docker Compose, it was found that **MinIO no longer publishes official community images that can be downloaded without credentials** (requires login on Docker Hub / quay.io for `minio/minio`). This complicates deployment in development and CI/CD environments where container registry credentials are not desired.

## Decision
Use **`adobe/s3mock:3.12.0`** as S3-compatible storage for development and testing, instead of MinIO.

- **Image**: `adobe/s3mock:3.12.0` (public, no credentials required)
- **Port**: 9090 (S3 API)
- **Service name**: `ticket-files` (neutral, implementation-agnostic)
- **Initialization**: `ticket-files-init` container creates the bucket on startup

For production, the `ticket-files` service can be replaced by:
- `minio/minio` (if registry credentials are configured)
- Real AWS S3 (changing environment variables: `S3_ENDPOINT`, `S3_PUBLIC_ENDPOINT`, credentials)
- Azure Blob Storage / Google Cloud Storage (with S3 adapter)

## Consequences

### Positive
- **No registry credentials**: The image is public on Docker Hub
- **Simple deployment**: `docker compose up` works without prior configuration
- **S3 API compatible**: AWS SDKs (JavaScript, Python, etc.) work without changes
- **Neutrality**: The service name `ticket-files` is not tied to MinIO; migration to real S3 is just an image/env vars change
- **Fast for development**: s3mock is lightweight and starts in seconds

### Negative
- **Development/testing only**: s3mock is not suitable for production (no persistence, no replication, no management UI)
- **Limited functionality**: Does not support all S3 features (versioning, lifecycle policies, etc.)
- **Difference from production**: Behavior may vary slightly vs MinIO/real S3

## Alternatives considered

| Option | Pros | Cons | Decision |
|--------|------|------|----------|
| **MinIO** (`minio/minio`) | Complete, production-ready, UI | Requires Docker Hub credentials since 2024 | ❌ Rejected |
| **LocalStack** | Many AWS services mocked | Heavy, slow, complex licensing | ❌ Rejected |
| **s3mock** (adobe/s3mock) | Lightweight, public, basic S3 API | Dev/testing only | ✅ **Chosen** |
| **MinIO Bitnami** (`bitnami/minio`) | Publicly maintained image | Adds third-party dependency | ⚠️ Considered, but s3mock is simpler |

## Implementation
- `docker-compose.yml`: `ticket-files` service with `adobe/s3mock:3.12.0`
- `ticket-files-init`: Node.js container that creates the bucket via HTTP PUT
- Environment variables: `TICKET_BUCKET`, `S3_ENDPOINT=http://ticket-files:9090`, `S3_PUBLIC_ENDPOINT`
- Ticket Service and Notification Worker use standard S3 SDK (`@aws-sdk/client-s3`)

## References
- [adobe/s3mock on Docker Hub](https://hub.docker.com/r/adobe/s3mock)
- [MinIO Docker Hub - requires login](https://hub.docker.com/r/minio/minio)
- Updated spec.md (section 1, services table)