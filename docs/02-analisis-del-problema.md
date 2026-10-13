# 2. Análisis del Problema (DDD)

> **Caso 1 — FlashTix, plataforma de venta de boletas.**
> Este documento corresponde a la sección 2 del Tech Spec `TS-001` y está escrito para pegarse
> directamente en el documento de Google Docs del equipo.

---

## 2.1 Identificación del Core Domain

El negocio de FlashTix no se diferencia por mostrar un catálogo ni por cobrar: eso lo hace cualquier
competidor y, de hecho, el cobro está delegado a un tercero. **FlashTix se diferencia por garantizar que
un asiento se venda exactamente una vez, en el instante en que 500.000 personas lo están peleando.**

> **Core Domain: Gestión de Inventario y Reserva de Asientos en Alta Concurrencia**
> *(Seat Inventory & Reservation)*
>
> Responsabilidad: mantener la unicidad del asiento (`un asiento = un comprador`), admitir usuarios de
> forma controlada mediante una cola virtual y sostener reservas temporales mientras se resuelve un
> pago que puede tardar hasta 15 segundos — todo ello sin bloquear la base de datos transaccional.

Las reglas de negocio que viven en este dominio son las que, al romperse, producen exactamente los
síntomas del escenario problemático:

| Invariante del Core Domain | Síntoma actual cuando se rompe |
| --- | --- |
| Un asiento disponible solo puede ser retenido por un comprador a la vez | *Overbooking* catastrófico |
| Una retención (*hold*) debe expirar automáticamente si no se paga | Bloqueos de fila eternos durante los 15 s de la pasarela |
| La admisión de compradores debe ser acotada y justa (orden de llegada) | 500.000 logins simultáneos colapsan el pool de conexiones |
| La disponibilidad se publica, no se consulta transaccionalmente | Cada `SELECT` de catálogo golpea MySQL |

Todo el esfuerzo de ingeniería (modelo de datos en memoria, scripts atómicos, cola virtual, saga) se
concentra aquí. El resto de subdominios se resuelve con patrones conocidos o se compra/terceriza.

---

## 2.2 Subdominios y Bounded Contexts

### Clasificación de subdominios

| Tipo | Subdominio | Por qué está en esa categoría |
| --- | --- | --- |
| **Core** | Inventario y Reserva de Asientos (incluye Cola Virtual) | Es la ventaja competitiva y la fuente de todos los cuellos de botella del caso. |
| **Supporting** | Catálogo de Eventos | Necesario y específico del negocio, pero no diferenciador: se resuelve con CQRS y caché. |
| **Supporting** | Órdenes y Checkout | Orquesta el proceso de compra; es específico pero se resuelve con patrones estándar (saga + outbox). |
| **Supporting** | Emisión y Entrega de Boletas | Generación del PDF con QR firmado; valor para el usuario, complejidad baja. |
| **Generic** | Identidad y Acceso | Autenticación/JWT: problema resuelto por la industria. |
| **Generic** | Pagos | Totalmente delegado a la pasarela legacy externa. |
| **Generic** | Notificaciones (email) | Delegado a un proveedor SMTP/API. |
| **Generic** | Observabilidad | Stack estándar Prometheus + Loki + Grafana. |

### Bounded Contexts y su materialización en contenedores

| # | Bounded Context | Tipo | Contenedor(es) del C4 | Almacén propio |
| --- | --- | --- | --- | --- |
| BC-1 | **Identity & Access** | Generic | `Identity Service` | PostgreSQL (identidad) |
| BC-2 | **Event Catalog** | Supporting | `Event & Inventory Service` (escritura) + `Catalog Query Service` (lectura) | PostgreSQL (catálogo) / MongoDB + Redis (lectura) |
| BC-3 | **Seat Inventory & Reservation** | **Core** | `Queue & Hold Service` | Redis (inventario en memoria) |
| BC-4 | **Ordering** | Supporting | `Ordering Service (Saga)` | PostgreSQL (órdenes) |
| BC-5 | **Payments (ACL)** | Generic | `Payment Worker` | — (estado en BC-4) |
| BC-6 | **Ticketing & Notification** | Supporting | `Ticketing Worker` | Object Storage (MinIO/S3) |

> **Nota sobre BC-2:** el catálogo es **un solo** Bounded Context partido en dos contenedores por
> **CQRS**. El lado de escritura es dueño de la verdad; el lado de lectura es una proyección
> desechable y reconstruible. Esta separación es la que permite cumplir el requisito de *"consulta
> ultrarrápida sin tocar la base de datos transaccional"*.

### Lenguaje ubicuo

| Término | Significado preciso en FlashTix |
| --- | --- |
| **Evento / Función** | Concierto y su fecha-hora concreta; una función tiene su propio mapa de asientos. |
| **Asiento (Seat)** | Unidad vendible identificada por `functionId + sectionId + row + number`. |
| **Hold (reserva suave)** | Retención **temporal y expirable** de uno o varios asientos. Vive en Redis con TTL. No es una venta. |
| **holdToken** | Credencial firmada (HMAC) que prueba la titularidad de un hold y permite crear la orden sin volver a consultar al Core. |
| **Cola Virtual** | Sala de espera FIFO que controla cuántos compradores entran al flujo de compra por segundo. |
| **Admission Token** | Permiso de entrada emitido por la cola; el API Gateway lo exige para las rutas de compra. |
| **Orden** | Intención de compra con ciclo de vida `PENDING → PAID → CONFIRMED` (o `FAILED` / `EXPIRED`). |
| **Boleta (Ticket)** | Artefacto emitido **después** de confirmar la orden: PDF con QR firmado. |

### Context Map (relaciones entre contextos)

```
  BC-1 Identity ──(Open Host Service: JWT RS256 + JWKS)──▶ todos los contextos

  BC-3 Reservation ──(Published Language: hold.created / hold.expired)──▶ BC-2 lectura
  BC-2 Catalog     ──(Published Language: event.published / seat.*)─────▶ BC-2 lectura
       └── ambos consumidos por el Projection Worker (Conformist: la proyección se adapta al evento)

  BC-4 Ordering ◀──(Customer / Supplier)──▶ BC-3 Reservation
       └── acoplamiento mínimo: Ordering valida el holdToken firmado, NO llama a BC-3

  BC-4 Ordering ──(Anti-Corruption Layer)──▶ BC-5 Payments ──▶ Pasarela legacy
       └── el Payment Worker traduce el modelo legacy al lenguaje del dominio; ningún
           otro contexto conoce el formato de la pasarela

  BC-4 Ordering ──(Published Language: order.confirmed)──▶ BC-6 Ticketing y BC-2 escritura
```

---

## 2.3 Principales desafíos técnicos y cómo los resuelve la arquitectura

### D1 — Estampida de lecturas sobre la base de datos transaccional

**Problema del caso:** cada vista de catálogo ejecuta `SELECT` directos contra MySQL; con 500.000
usuarios el *pool* de conexiones se agota y el sistema entero cae, incluidas las escrituras.

**Solución arquitectónica:** se aplica **CQRS**. El `Catalog Query Service` es de **solo lectura** y
no tiene credenciales sobre la base transaccional. Resuelve con Redis en modo *read-through*
(TTL corto + invalidación por evento) y, ante un *miss*, cae a un **read model desnormalizado en
MongoDB** mantenido por el `Projection Worker`. El camino de lectura y el de escritura quedan
físicamente aislados: una tormenta de lecturas ya no puede agotar el pool de conexiones de las
escrituras.

> Cubre la **característica obligatoria 2**.

### D2 — El bloqueo de fila sostenido por la latencia de la pasarela

**Problema del caso:** `SELECT ... FOR UPDATE` mantiene un *row-level lock* abierto durante los hasta
15 segundos que tarda la pasarela legacy. Los bloqueos se encadenan y paralizan el sistema.

**Solución arquitectónica:** se **elimina la transacción de larga duración**. El `Queue & Hold Service`
sustituye el bloqueo pesimista de base de datos por una **reserva suave en Redis**: un script **Lua
atómico** verifica y marca los asientos en una sola operación indivisible y les asigna un **TTL de
10 minutos**. Si el usuario abandona o el pago falla, Redis libera el asiento solo, sin intervención
ni transacción colgada. La decisión y sus alternativas están documentadas en el
[ADR-001](adrs/001-reserva-suave-en-redis-en-lugar-de-bloqueo-de-fila.md).

> Cubre la **característica obligatoria 3**.

### D3 — Conexiones HTTP abiertas y errores 504 Gateway Timeout

**Problema del caso:** la petición de compra espera síncronamente a la pasarela; las conexiones se
acumulan y el gateway responde 504.

**Solución arquitectónica:** **ninguna petición HTTP espera a la pasarela**. `POST /orders` persiste la
orden en `PENDING`, escribe el evento `payment.requested` en la **tabla outbox** dentro de la misma
transacción y responde **`202 Accepted`** en milisegundos. El `Payment Worker` consume el evento desde
RabbitMQ y conversa con la pasarela legacy fuera del camino del usuario, protegido con *timeout*,
*bulkhead*, *circuit breaker* y reintentos con *backoff* exponencial. El cliente conoce el desenlace
por **SSE** o por *polling* de `GET /orders/{id}`.

> Cubre la **característica obligatoria 4**.

### D4 — Overbooking por transacciones que fallan a medias

**Problema del caso:** al agotarse los recursos, las transacciones quedan incompletas y se vende dos
veces el mismo asiento.

**Solución arquitectónica:** defensa en cuatro capas.

1. **Atomicidad en el Core:** el script Lua de Redis es indivisible; dos compradores nunca obtienen el
   mismo asiento, ni siquiera en la misma milésima de segundo.
2. **Patrón Outbox:** el cambio de estado y la publicación del evento ocurren en la **misma**
   transacción de PostgreSQL; nunca existe un pago cobrado sin evento, ni un evento sin pago.
3. **Saga con compensación:** si `payment.failed` llega, la saga libera el hold y marca la orden como
   `FAILED`. Los consumidores son **idempotentes** (clave de idempotencia por `orderId`), de modo que
   un reintento de RabbitMQ no cobra ni emite dos veces.
4. **Última línea de defensa:** restricción `UNIQUE (function_id, seat_id)` sobre la tabla de asientos
   vendidos en PostgreSQL. Si todo lo anterior fallara, la base de datos rechaza el duplicado.

### D5 — 500.000 inicios de sesión simultáneos

**Problema del caso:** el pico de autenticación tumba el sistema antes incluso de llegar a la compra.

**Solución arquitectónica:** el **API Gateway es el único punto de entrada** y absorbe el pico:
termina TLS, aplica *rate limiting* por IP y por usuario, y valida los **JWT RS256 de forma local
contra el JWKS** del `Identity Service` — es decir, **validar una sesión no genera tráfico hacia
ningún servicio ni hacia ninguna base de datos**. Sobre las rutas de compra el gateway exige además
el *admission token* de la cola virtual, convirtiendo una avalancha de 500.000 usuarios en un caudal
admitido y predecible.

> Cubre las **características obligatorias 1 y 3**.

### D6 — Acoplamiento del monolito y una única base de datos

**Problema del caso:** un fallo en cualquier parte del monolito Node.js degrada todo el sistema,
porque todo comparte proceso y base de datos.

**Solución arquitectónica:** descomposición en microservicios alineados a los Bounded Contexts, con
**una base de datos por servicio**. La pasarela legacy queda confinada tras un **Anti-Corruption
Layer** (el `Payment Worker`): su lentitud ya no es un problema del sistema, sino la profundidad de
una cola. El stack de observabilidad (Prometheus + Loki + Grafana + OpenTelemetry) hace visible esa
profundidad de cola, la latencia p95 y la tasa de holds expirados antes de que el usuario lo note.

### D7 — Entrega de la boleta sin acoplar la compra

**Solución arquitectónica:** el `Ticketing Worker` consume `order.confirmed`, genera el PDF con un QR
firmado, lo guarda en el *object storage* y lo envía por correo. La compra se confirma aunque el
proveedor de email esté caído; el mensaje simplemente espera en su cola (y en la DLQ si agota
reintentos).

> Cubre la **característica obligatoria 5**.

---

## 2.4 Trazabilidad: las 5 características obligatorias

| # | Característica obligatoria del caso | Dónde se resuelve en la arquitectura | Desafío |
| --- | --- | --- | --- |
| 1 | Autenticación y validación de sesión en el API Gateway | `API Gateway` valida JWT RS256 contra el JWKS de `Identity Service`, sin I/O adicional | D5 |
| 2 | Consulta ultrarrápida del catálogo sin tocar la BD transaccional | `Catalog Query Service` → Redis (caché) → MongoDB (read model), alimentados por el `Projection Worker` | D1 |
| 3 | Cola virtual / reserva suave en almacenamiento de baja latencia | `Queue & Hold Service` → Redis: ZSET para la cola, script Lua + TTL para el hold | D2, D5 |
| 4 | Pago y confirmación delegados a un worker, totalmente asíncronos | `Ordering Service` responde `202 Accepted` → RabbitMQ → `Payment Worker` → saga | D3, D4 |
| 5 | Emisión y envío de la boleta por eventos | `order.confirmed` → `Ticketing Worker` → PDF + QR → Object Storage + email | D7 |
