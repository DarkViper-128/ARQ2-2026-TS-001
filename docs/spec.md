# FlashTix — Especificación de API y Contratos (OpenSpec)

> **Estado: ESQUELETO.** La estructura, los esquemas de datos y los contratos de eventos están
> definidos. Los bloques marcados con `TODO` deben completarse durante la Ola 1 antes de empezar a
> implementar. Cada capacidad se describe con requisitos (`DEBE` / `SHALL`) y escenarios `CUANDO`/`ENTONCES`.

- **Equipo:** TS-001 · **Caso:** FlashTix — Plataforma de Venta de Boletas
- **Versión:** 0.1.0 · **Última actualización:** 2026-10-12
- **Diagrama de contenedores:** [`assets/c4-nivel2-contenedores.png`](assets/c4-nivel2-contenedores.png)
- **Análisis de dominio:** [`02-analisis-del-problema.md`](02-analisis-del-problema.md)

---

## 1. Propósito

FlashTix vende boletas para eventos de alta demanda. El sistema debe sostener picos de 500.000
usuarios concurrentes garantizando que **un asiento se venda exactamente una vez**, sin que la
latencia de la pasarela de pagos externa (hasta 15 s) bloquee la base de datos ni el camino HTTP del
usuario.

## 2. Convenciones generales

| Aspecto | Regla |
| --- | --- |
| Base URL | `https://api.flashtix.com/v1` — expuesta **únicamente** por el API Gateway |
| Formato | `application/json; charset=utf-8` |
| Autenticación | `Authorization: Bearer <JWT RS256>`, validado en el Gateway contra el JWKS |
| Admisión | Las rutas de compra exigen además `X-Admission-Token: <token de cola virtual>` |
| Idempotencia | `Idempotency-Key: <uuid>` obligatorio en `POST /holds` y `POST /orders` |
| Trazabilidad | `X-Correlation-Id` propagado por el Gateway a todos los servicios y eventos |
| Identificadores | UUID v4 en formato string |
| Fechas | ISO-8601 en UTC (`2026-10-12T20:15:00Z`) |
| Paginación | `?page=1&pageSize=20`; la respuesta incluye el objeto `meta` |
| Errores | RFC 7807 *Problem Details* (ver §3.1) |

### 2.1 Códigos de estado usados

| Código | Uso en FlashTix |
| --- | --- |
| `200 OK` | Lectura satisfactoria |
| `201 Created` | Recurso creado de forma síncrona (p. ej. un hold) |
| `202 Accepted` | **Procesamiento asíncrono aceptado** (creación de orden) |
| `400 Bad Request` | Error de validación del cuerpo o los parámetros |
| `401 Unauthorized` | JWT ausente, expirado o inválido |
| `403 Forbidden` | Sin `admission token` válido de la cola virtual |
| `404 Not Found` | Recurso inexistente |
| `409 Conflict` | **Asiento ya retenido o vendido** / hold expirado |
| `410 Gone` | El `holdToken` venció antes de crear la orden |
| `429 Too Many Requests` | Rate limiting del Gateway |
| `503 Service Unavailable` | Circuit breaker abierto hacia un dependiente |

---

## 3. Esquemas de datos de los dominios principales

### 3.1 `ProblemDetails` (error estándar)

```json
{
  "type": "https://api.flashtix.com/errors/seat-unavailable",
  "title": "Seat unavailable",
  "status": 409,
  "detail": "El asiento A-12 ya fue retenido por otro comprador.",
  "instance": "/v1/holds",
  "correlationId": "0f1c...",
  "conflictingSeatIds": ["seat-a12"]
}
```

### 3.2 `Event` (BC-2 Event Catalog)

```json
{
  "eventId": "uuid",
  "name": "string",
  "artist": "string",
  "venue": { "venueId": "uuid", "name": "string", "city": "string" },
  "status": "DRAFT | PUBLISHED | CANCELLED",
  "functions": ["Function"],
  "publishedAt": "ISO-8601"
}
```

### 3.3 `Function` y `Seat` (BC-2 / BC-3)

```json
{
  "functionId": "uuid",
  "eventId": "uuid",
  "startsAt": "ISO-8601",
  "salesOpenAt": "ISO-8601",
  "sections": [
    {
      "sectionId": "uuid",
      "name": "Platea A",
      "priceCents": 35000,
      "currency": "COP",
      "capacity": 1200,
      "availableCount": 834
    }
  ]
}
```

```json
{
  "seatId": "uuid",
  "functionId": "uuid",
  "sectionId": "uuid",
  "row": "F",
  "number": "12",
  "status": "AVAILABLE | HELD | SOLD | BLOCKED",
  "priceCents": 35000
}
```

> `status` expuesto al cliente proviene **siempre** del read model (MongoDB/Redis), nunca de la base
> transaccional.

### 3.4 `Hold` — reserva suave (BC-3, Core Domain)

```json
{
  "holdId": "uuid",
  "functionId": "uuid",
  "userId": "uuid",
  "seatIds": ["uuid"],
  "status": "ACTIVE | CONFIRMED | EXPIRED | RELEASED",
  "createdAt": "ISO-8601",
  "expiresAt": "ISO-8601",
  "holdToken": "string (JWS/HMAC: holdId, seatIds, userId, exp)"
}
```

- TTL por defecto: **600 segundos** (configurable por variable de entorno).
- Representación en Redis: `hold:{functionId}:{seatId}` → `{holdId, userId}` con `EXPIRE`.

### 3.5 `QueueTicket` — cola virtual (BC-3)

```json
{
  "queueId": "uuid",
  "functionId": "uuid",
  "userId": "uuid",
  "position": 128455,
  "estimatedWaitSeconds": 420,
  "status": "WAITING | ADMITTED | EXPIRED",
  "admissionToken": "string | null",
  "admissionExpiresAt": "ISO-8601 | null"
}
```

### 3.6 `Order` (BC-4 Ordering)

```json
{
  "orderId": "uuid",
  "userId": "uuid",
  "functionId": "uuid",
  "holdId": "uuid",
  "items": [{ "seatId": "uuid", "priceCents": 35000 }],
  "totalCents": 70000,
  "currency": "COP",
  "status": "PENDING | PAID | CONFIRMED | FAILED | EXPIRED | REFUNDED",
  "failureReason": "string | null",
  "createdAt": "ISO-8601",
  "updatedAt": "ISO-8601"
}
```

**Ciclo de vida (saga):**

```
PENDING ──payment.succeeded──▶ PAID ──seat.committed──▶ CONFIRMED ──▶ ticket.issued
   │                                                        
   ├──payment.failed──▶ FAILED        (compensación: liberar hold)
   └──hold.expired────▶ EXPIRED       (compensación: cancelar intento de pago)
```

### 3.7 `Payment` (BC-5, Anti-Corruption Layer)

```json
{
  "paymentId": "uuid",
  "orderId": "uuid",
  "idempotencyKey": "string",
  "amountCents": 70000,
  "status": "REQUESTED | SUCCEEDED | FAILED | TIMEOUT",
  "gatewayReference": "string | null",
  "attempts": 1,
  "lastAttemptAt": "ISO-8601"
}
```

### 3.8 `Ticket` (BC-6 Ticketing)

```json
{
  "ticketId": "uuid",
  "orderId": "uuid",
  "seatId": "uuid",
  "qrPayload": "string (firmado)",
  "pdfUrl": "string",
  "status": "ISSUED | SENT | CHECKED_IN | VOID",
  "issuedAt": "ISO-8601"
}
```

---

## 4. Requisitos y escenarios (OpenSpec)

### Requisito: Autenticación y validación de sesión en el API Gateway

El sistema **DEBE** autenticar al usuario emitiendo un JWT RS256 y **DEBE** validar toda petición
protegida en el API Gateway, sin generar tráfico hacia el `Identity Service` ni hacia ninguna base de
datos.

#### Escenario: Credenciales válidas

- **CUANDO** se envía `POST /auth/login` con email y contraseña correctos
- **ENTONCES** responde `200 OK` con `accessToken` (TTL 15 min), `refreshToken` (TTL 7 días) y `expiresIn`

#### Escenario: Token inválido o expirado en una ruta protegida

- **CUANDO** se envía cualquier petición protegida con un `Authorization` ausente, malformado o expirado
- **ENTONCES** el **API Gateway** responde `401 Unauthorized` **sin** enrutar la petición al microservicio

#### Escenario: Exceso de peticiones

- **CUANDO** un cliente supera el límite configurado de peticiones por minuto
- **ENTONCES** el Gateway responde `429 Too Many Requests` con la cabecera `Retry-After`

---

### Requisito: Consulta ultrarrápida del catálogo y la disponibilidad

El `Catalog Query Service` **DEBE** servir el catálogo y la disponibilidad de asientos sin ejecutar
ninguna consulta contra la base de datos transaccional, y **DEBE** responder en menos de 50 ms p95.

#### Escenario: Catálogo presente en caché

- **CUANDO** se envía `GET /events?city=Bogota` y la clave existe en Redis
- **ENTONCES** responde `200 OK` desde la caché, con la cabecera `X-Cache: HIT`

#### Escenario: Fallo de caché

- **CUANDO** la clave no existe en Redis
- **ENTONCES** lee el read model de MongoDB, repuebla Redis con el TTL configurado y responde
  `200 OK` con `X-Cache: MISS`
- **Y** en ningún caso abre una conexión contra PostgreSQL

#### Escenario: Disponibilidad de asientos de una función

- **CUANDO** se envía `GET /functions/{functionId}/seats`
- **ENTONCES** responde `200 OK` con el estado de cada asiento tomado del read model
- **Y** la respuesta incluye `asOf` con la marca temporal de la última proyección aplicada

> `TODO` — definir el umbral máximo aceptable de desfase (*staleness*) del read model y su alerta.

---

### Requisito: Cola virtual (admission control)

El sistema **DEBE** encolar a los compradores en orden de llegada cuando la demanda de una función
supere el caudal configurado, y **DEBE** emitir un `admissionToken` de vigencia limitada.

#### Escenario: Ingreso a la sala de espera

- **CUANDO** se envía `POST /queue/{functionId}/join` con un JWT válido
- **ENTONCES** responde `201 Created` con `queueId`, `position` y `estimatedWaitSeconds`

#### Escenario: Turno admitido

- **CUANDO** el turno del usuario llega y consulta `GET /queue/{functionId}/status`
- **ENTONCES** responde `200 OK` con `status: "ADMITTED"` y un `admissionToken` válido por 10 minutos

#### Escenario: Intento de compra sin admisión

- **CUANDO** se envía `POST /holds` sin la cabecera `X-Admission-Token` o con una caducada
- **ENTONCES** el API Gateway responde `403 Forbidden`

> `TODO` — definir el algoritmo de caudal de admisión (tasa fija vs. adaptativa a la profundidad de cola).

---

### Requisito: Reserva suave de asientos (Core Domain)

El `Queue & Hold Service` **DEBE** retener los asientos de forma atómica en Redis con un TTL de 600 s,
**DEBE** aplicar semántica «todo o nada» sobre el grupo de asientos solicitado y **NO DEBE** tomar
bloqueos en la base de datos transaccional.

#### Escenario: Reserva satisfactoria

- **CUANDO** se envía `POST /holds` con `functionId` y `seatIds` de asientos disponibles
- **ENTONCES** responde `201 Created` con `holdId`, `expiresAt` y un `holdToken` firmado
- **Y** publica el evento `hold.created`

#### Escenario: Alguno de los asientos ya está retenido

- **CUANDO** al menos uno de los `seatIds` solicitados ya tiene un hold activo o está vendido
- **ENTONCES** responde `409 Conflict` con `conflictingSeatIds`
- **Y NO** retiene **ninguno** de los asientos del grupo

#### Escenario: Expiración automática

- **CUANDO** transcurre el TTL sin que se confirme una orden sobre el hold
- **ENTONCES** Redis libera las claves de los asientos
- **Y** el servicio publica `hold.expired` para que se actualice el read model de disponibilidad

#### Escenario: Petición repetida con la misma clave de idempotencia

- **CUANDO** se reenvía `POST /holds` con el mismo `Idempotency-Key`
- **ENTONCES** responde `201 Created` con **el mismo** `holdId`, sin crear una segunda reserva

---

### Requisito: Pago y confirmación completamente asíncronos

El `Ordering Service` **DEBE** responder sin esperar a la pasarela de pagos y **DEBE** publicar el
evento de pago en la misma transacción que persiste la orden (patrón Outbox).

#### Escenario: Creación de la orden

- **CUANDO** se envía `POST /orders` con un `holdToken` válido y el medio de pago
- **ENTONCES** responde **`202 Accepted`** en menos de 200 ms, con `orderId`, `status: "PENDING"` y
  la cabecera `Location: /v1/orders/{orderId}`
- **Y** escribe `payment.requested` en la tabla outbox dentro de la misma transacción
- **Y NO** realiza ninguna llamada a la pasarela de pagos durante la petición HTTP

#### Escenario: `holdToken` expirado

- **CUANDO** se envía `POST /orders` con un `holdToken` cuyo `exp` ya pasó
- **ENTONCES** responde `410 Gone` sin crear la orden

#### Escenario: Pago satisfactorio

- **CUANDO** el `Payment Worker` recibe `payment.succeeded` de la pasarela
- **ENTONCES** la orden pasa a `PAID` y luego a `CONFIRMED`
- **Y** se publica `order.confirmed`

#### Escenario: Pago fallido (compensación de la saga)

- **CUANDO** el `Payment Worker` publica `payment.failed`
- **ENTONCES** la orden pasa a `FAILED`
- **Y** se libera el hold asociado
- **Y** los asientos vuelven a `AVAILABLE` en el read model

#### Escenario: Consulta del desenlace por el cliente

- **CUANDO** se envía `GET /orders/{orderId}`
- **ENTONCES** responde `200 OK` con el estado actual de la saga
- **Y** el cliente puede suscribirse a `GET /orders/{orderId}/events` (SSE) para recibirlo en tiempo real

> `TODO` — definir la política de reintentos y el número máximo de intentos antes de enviar a la DLQ.

---

### Requisito: Emisión y envío asíncrono de la boleta digital

El `Ticketing Worker` **DEBE** generar y enviar la boleta a partir del evento `order.confirmed`, sin
acoplar la confirmación de la compra a la disponibilidad del proveedor de correo.

#### Escenario: Emisión de la boleta

- **CUANDO** se consume `order.confirmed`
- **ENTONCES** genera un PDF por asiento con un QR firmado, lo almacena en el object storage y publica
  `ticket.issued`

#### Escenario: Fallo del proveedor de correo

- **CUANDO** el envío del correo falla
- **ENTONCES** el mensaje se reintenta con backoff exponencial y, agotados los intentos, se envía a la DLQ
- **Y** la orden **permanece** en `CONFIRMED` (la compra no se revierte por un fallo de notificación)

#### Escenario: Reentrega del mismo evento

- **CUANDO** `order.confirmed` se consume por segunda vez
- **ENTONCES** no se emite una boleta duplicada (consumidor idempotente por `orderId`)

---

## 5. Contratos HTTP

> Formato de cada entrada: método, ruta, cabeceras obligatorias, cuerpo de la petición y respuestas.

### 5.1 Identity Service

| Método | Ruta | Descripción | Respuestas |
| --- | --- | --- | --- |
| `POST` | `/auth/register` | Registro de comprador | `201`, `400`, `409` |
| `POST` | `/auth/login` | Emisión de tokens | `200`, `400`, `401` |
| `POST` | `/auth/refresh` | Rotación del refresh token | `200`, `401` |
| `POST` | `/auth/logout` | Revocación del refresh token | `204`, `401` |
| `GET` | `/.well-known/jwks.json` | Claves públicas para el Gateway | `200` |

#### `POST /auth/login`

**Request**

```json
{ "email": "fan@example.com", "password": "********" }
```

**Response `200`**

```json
{
  "accessToken": "eyJhbGciOiJSUzI1NiIs...",
  "refreshToken": "eyJhbGciOiJSUzI1NiIs...",
  "tokenType": "Bearer",
  "expiresIn": 900
}
```

**Response `401`** → `ProblemDetails` (§3.1)

---

### 5.2 Catalog Query Service (solo lectura)

| Método | Ruta | Descripción | Respuestas |
| --- | --- | --- | --- |
| `GET` | `/events` | Listado paginado y filtrable | `200` |
| `GET` | `/events/{eventId}` | Detalle del evento con sus funciones | `200`, `404` |
| `GET` | `/functions/{functionId}/availability` | Resumen por sección | `200`, `404` |
| `GET` | `/functions/{functionId}/seats` | Mapa de asientos con estado | `200`, `404` |

#### `GET /functions/{functionId}/seats`

**Response `200`**

```json
{
  "functionId": "uuid",
  "asOf": "2026-10-12T20:15:00Z",
  "seats": [
    { "seatId": "uuid", "row": "F", "number": "12", "status": "AVAILABLE", "priceCents": 35000 }
  ],
  "meta": { "page": 1, "pageSize": 500, "total": 1200 }
}
```

> `TODO` — definir si el mapa completo se entrega paginado o comprimido en una sola respuesta.

---

### 5.3 Queue & Hold Service (Core Domain)

| Método | Ruta | Descripción | Respuestas |
| --- | --- | --- | --- |
| `POST` | `/queue/{functionId}/join` | Entrar a la cola virtual | `201`, `401` |
| `GET` | `/queue/{functionId}/status` | Posición y admisión | `200`, `404` |
| `POST` | `/holds` | Crear la reserva suave | `201`, `400`, `403`, `409` |
| `GET` | `/holds/{holdId}` | Consultar el hold | `200`, `404`, `410` |
| `DELETE` | `/holds/{holdId}` | Liberar el hold manualmente | `204`, `404` |

#### `POST /holds`

**Headers:** `Authorization`, `X-Admission-Token`, `Idempotency-Key`

**Request**

```json
{ "functionId": "uuid", "seatIds": ["uuid-a12", "uuid-a13"] }
```

**Response `201`**

```json
{
  "holdId": "uuid",
  "functionId": "uuid",
  "seatIds": ["uuid-a12", "uuid-a13"],
  "status": "ACTIVE",
  "expiresAt": "2026-10-12T20:25:00Z",
  "holdToken": "eyJhbGciOiJIUzI1NiIs..."
}
```

**Response `409`**

```json
{
  "type": "https://api.flashtix.com/errors/seat-unavailable",
  "title": "Seat unavailable",
  "status": 409,
  "detail": "Uno o más asientos ya no están disponibles.",
  "conflictingSeatIds": ["uuid-a13"]
}
```

---

### 5.4 Ordering Service

| Método | Ruta | Descripción | Respuestas |
| --- | --- | --- | --- |
| `POST` | `/orders` | Crear la orden (asíncrona) | `202`, `400`, `403`, `410` |
| `GET` | `/orders/{orderId}` | Estado de la saga | `200`, `404` |
| `GET` | `/orders/{orderId}/events` | Stream SSE del estado | `200` |
| `GET` | `/orders` | Historial del comprador | `200` |

#### `POST /orders`

**Headers:** `Authorization`, `Idempotency-Key`

**Request**

```json
{
  "holdToken": "eyJhbGciOiJIUzI1NiIs...",
  "paymentMethod": { "type": "CARD", "token": "tok_xxx" }
}
```

**Response `202`** — `Location: /v1/orders/{orderId}`

```json
{
  "orderId": "uuid",
  "status": "PENDING",
  "totalCents": 70000,
  "currency": "COP",
  "statusUrl": "/v1/orders/{orderId}"
}
```

---

### 5.5 Event & Inventory Service (back-office del promotor)

| Método | Ruta | Descripción | Respuestas |
| --- | --- | --- | --- |
| `POST` | `/events` | Crear evento | `201`, `400`, `403` |
| `POST` | `/events/{eventId}/functions` | Crear función y mapa de asientos | `201`, `400` |
| `POST` | `/events/{eventId}/publish` | Publicar (dispara `event.published`) | `202`, `409` |

> `TODO` — definir el formato de carga masiva del mapa de asientos (CSV vs. JSON) y su límite de tamaño.

---

### 5.6 Ticketing

| Método | Ruta | Descripción | Respuestas |
| --- | --- | --- | --- |
| `GET` | `/orders/{orderId}/tickets` | Boletas de una orden | `200`, `404` |
| `GET` | `/tickets/{ticketId}/download` | URL firmada del PDF | `302`, `404` |

---

## 6. Eventos asíncronos y contratos de integración (RabbitMQ)

### 6.1 Topología

| Elemento | Valor |
| --- | --- |
| Exchange principal | `flashtix.events` (tipo `topic`, durable) |
| Exchange de reintentos | `flashtix.retry` (con `x-message-ttl` + DLX) |
| Dead letter exchange | `flashtix.dlx` → cola `flashtix.dlq` |
| Entrega | `publisher confirms` + colas durables + mensajes persistentes |
| Consumo | `manual ack`, `prefetch` configurable, consumidores **idempotentes** |

### 6.2 Envelope común

Todo mensaje publicado en `flashtix.events` **DEBE** usar este sobre:

```json
{
  "eventId": "uuid",
  "eventType": "order.confirmed",
  "eventVersion": 1,
  "occurredAt": "2026-10-12T20:15:00Z",
  "correlationId": "uuid",
  "causationId": "uuid",
  "producer": "ordering-service",
  "payload": { }
}
```

### 6.3 Catálogo de eventos

| Routing key | Productor | Consumidores | Propósito |
| --- | --- | --- | --- |
| `event.published` | Event & Inventory | Projection Worker | Alta del evento en el read model |
| `seat.inventory.updated` | Event & Inventory | Projection Worker | Cambio del mapa de asientos |
| `hold.created` | Queue & Hold | Projection Worker | Marcar asientos como `HELD` |
| `hold.expired` | Queue & Hold | Projection Worker, Ordering | Liberar asientos / expirar la orden |
| `hold.released` | Queue & Hold | Projection Worker | Liberación manual |
| `order.created` | Ordering | Projection Worker | Auditoría y métricas |
| `payment.requested` | Ordering (outbox) | **Payment Worker** | Disparar el cobro fuera del camino HTTP |
| `payment.succeeded` | Payment Worker | Ordering | Avanzar la saga a `PAID` |
| `payment.failed` | Payment Worker | Ordering | Compensar: liberar hold y marcar `FAILED` |
| `order.confirmed` | Ordering (outbox) | Ticketing Worker, Event & Inventory, Projection Worker | Emitir boleta y persistir la venta |
| `ticket.issued` | Ticketing Worker | Projection Worker | Trazabilidad de la entrega |

### 6.4 Contratos de payload

#### `payment.requested`

```json
{
  "orderId": "uuid",
  "paymentId": "uuid",
  "idempotencyKey": "string",
  "amountCents": 70000,
  "currency": "COP",
  "paymentMethod": { "type": "CARD", "token": "tok_xxx" }
}
```

#### `payment.succeeded`

```json
{
  "orderId": "uuid",
  "paymentId": "uuid",
  "gatewayReference": "string",
  "paidAt": "ISO-8601"
}
```

#### `payment.failed`

```json
{
  "orderId": "uuid",
  "paymentId": "uuid",
  "reason": "INSUFFICIENT_FUNDS | TIMEOUT | REJECTED | GATEWAY_ERROR",
  "attempts": 3,
  "retryable": false
}
```

#### `order.confirmed`

```json
{
  "orderId": "uuid",
  "userId": "uuid",
  "functionId": "uuid",
  "holdId": "uuid",
  "seatIds": ["uuid"],
  "totalCents": 70000,
  "buyerEmail": "fan@example.com",
  "confirmedAt": "ISO-8601"
}
```

#### `hold.created` / `hold.expired`

```json
{
  "holdId": "uuid",
  "functionId": "uuid",
  "userId": "uuid",
  "seatIds": ["uuid"],
  "expiresAt": "ISO-8601"
}
```

> `TODO` — completar los payloads de `event.published`, `seat.inventory.updated`, `order.created`,
> `hold.released` y `ticket.issued` siguiendo el mismo patrón.

### 6.5 Reglas de integración

1. **Outbox obligatorio:** ningún servicio publica directamente en RabbitMQ desde su lógica de
   negocio; escribe en su tabla `outbox` dentro de la transacción y un *relay* publica el mensaje.
2. **Idempotencia obligatoria:** todo consumidor registra el `eventId` procesado y descarta repetidos.
3. **Compatibilidad de esquemas:** solo se permiten cambios aditivos; un cambio incompatible obliga a
   incrementar `eventVersion` y publicar en una nueva *routing key*.
4. **Orden no garantizado:** los consumidores deben tolerar desorden y usar `occurredAt` para resolver
   conflictos en el read model.

---

## 7. Requisitos no funcionales medibles

| Métrica | Objetivo | Dónde se mide |
| --- | --- | --- |
| Latencia `GET /functions/{id}/seats` | p95 < 50 ms | Prometheus (Gateway) |
| Latencia `POST /holds` | p99 < 100 ms | Prometheus (Queue & Hold) |
| Latencia `POST /orders` | p95 < 200 ms | Prometheus (Ordering) |
| Conexiones a PostgreSQL por lectura de catálogo | **0** | Dashboard de Grafana |
| Overbooking | **0 incidentes** | Restricción `UNIQUE` + alerta |
| Profundidad de la cola `payment.requested` | < 5.000 mensajes | RabbitMQ exporter |
| Usuarios concurrentes sostenidos | 500.000 en la sala de espera | Prueba de carga (Ola 2) |

> `TODO` — definir el plan de pruebas de carga (herramienta, escenarios y criterios de aceptación).

---

## 8. Pendientes de la Ola 1

- [ ] Completar los payloads marcados como `TODO` en §6.4.
- [ ] Definir el algoritmo de caudal de admisión de la cola virtual (§4).
- [ ] Definir la política de reintentos y el umbral de DLQ (§4).
- [ ] Redactar **ADR-002** (RabbitMQ vs. Kafka) y **ADR-003** (CQRS con MongoDB + Redis vs. réplicas de lectura).
- [ ] Acordar el formato de carga masiva del mapa de asientos (§5.5).
- [ ] Definir el plan de pruebas de carga (§7).
