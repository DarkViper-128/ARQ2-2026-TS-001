# ADR 004: Uso de s3mock en lugar de MinIO para almacenamiento de objetos S3-compatible

## Estado
Aceptado

## Contexto
El proyecto FlashTix requiere almacenamiento de objetos compatible con S3 para guardar los PDFs de los tickets (Ticket Service). La especificación original (spec.md) y los diagramas C4 mencionaban **MinIO** como la solución de almacenamiento.

Sin embargo, al implementar la infraestructura con Docker Compose, se encontró que **MinIO ya no publica imágenes community oficiales que se puedan descargar sin credenciales** (requiere login en Docker Hub / quay.io para `minio/minio`). Esto complica el despliegue en entornos de desarrollo y CI/CD donde no se quieren gestionar credenciales de registro de contenedores.

## Decisión
Usar **`adobe/s3mock:3.12.0`** como almacenamiento S3-compatible para desarrollo y testing, en lugar de MinIO.

- **Imagen**: `adobe/s3mock:3.12.0` (pública, sin credenciales)
- **Puerto**: 9090 (API S3)
- **Nombre del servicio**: `ticket-files` (neutro, implementation-agnostic)
- **Inicialización**: Contenedor `ticket-files-init` crea el bucket al arrancar

Para producción, el servicio `ticket-files` se puede reemplazar por:
- `minio/minio` (si se configuran credenciales de registry)
- AWS S3 real (cambiando variables de entorno: `S3_ENDPOINT`, `S3_PUBLIC_ENDPOINT`, credenciales)
- Azure Blob Storage / Google Cloud Storage (con adaptador S3)

## Consecuencias

### Positivas
- **Sin credenciales de registry**: La imagen es pública en Docker Hub
- **Despliegue simple**: `docker compose up` funciona sin configuración previa
- **Compatible con S3 API**: Los SDKs de AWS (JavaScript, Python, etc.) funcionan sin cambios
- **Neutralidad**: El nombre del servicio `ticket-files` no ata a MinIO; migración a S3 real es solo cambio de imagen/env vars
- **Rápido para desarrollo**: s3mock es ligero y arranca en segundos

### Negativas
- **Solo desarrollo/testing**: s3mock no es apto para producción (no persiste, no tiene replicación, no tiene UI de gestión)
- **Funcionalidad limitada**: No soporta todas las features de S3 (versioning, lifecycle policies, etc.)
- **Diferencia con producción**: El comportamiento puede variar ligeramente vs MinIO/S3 real

## Alternativas consideradas

| Opción | Ventajas | Desventajas | Decisión |
|--------|----------|-------------|----------|
| **MinIO** (`minio/minio`) | Completo, producción-ready, UI | Requiere credenciales Docker Hub desde 2024 | ❌ Rechazado |
| **LocalStack** | Muchos servicios AWS mock | Pesado, lento, licencia compleja | ❌ Rechazado |
| **s3mock** (adobe/s3mock) | Ligero, público, S3 API básico | Solo dev/testing | ✅ **Elegido** |
| **MinIO Bitnami** (`bitnami/minio`) | Imagen pública mantenida | Añade dependencia de terceros | ⚠️ Considerado, pero s3mock es más simple |

## Implementación
- `docker-compose.yml`: Servicio `ticket-files` con `adobe/s3mock:3.12.0`
- `ticket-files-init`: Contenedor Node.js que crea el bucket via HTTP PUT
- Variables de entorno: `TICKET_BUCKET`, `S3_ENDPOINT=http://ticket-files:9090`, `S3_PUBLIC_ENDPOINT`
- Ticket Service y Notification Worker usan SDK S3 estándar (`@aws-sdk/client-s3`)

## Referencias
- [adobe/s3mock en Docker Hub](https://hub.docker.com/r/adobe/s3mock)
- [MinIO Docker Hub - requiere login](https://hub.docker.com/r/minio/minio)
- Spec.md actualizado (sección 1, tabla de servicios)