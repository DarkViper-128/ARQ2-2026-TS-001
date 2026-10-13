# 001 - Reserva suave en Redis con TTL en lugar de bloqueo de fila en la base de datos

- **Estado:** Aceptada
- **Fecha:** 2026-10-12
- **Autores:** Carlos Andrés Arteaga, Álvaro Sotelo, Santiago Vallejo, Duvan Leal, Juan Pablo Florez
- **Bounded Context afectado:** BC-3 *Seat Inventory & Reservation* (Core Domain)
- **Características obligatorias que habilita:** #3 (cola virtual / reserva suave) y, de forma indirecta, #4

## Contexto y problema

El monolito actual de FlashTix protege la unicidad del asiento con una transacción de base de datos
que toma un **bloqueo pesimista a nivel de fila** (`SELECT ... FOR UPDATE`) sobre el asiento elegido,
y mantiene esa transacción abierta hasta que la pasarela de pagos externa responde.

La pasarela es *legacy* y tarda **hasta 15 segundos**. El resultado observado es una cadena de fallos:

1. Cada compra retiene un bloqueo de fila durante hasta 15 s.
2. Con 500.000 usuarios concurrentes, los bloqueos se encolan y el **pool de conexiones se agota**.
3. Las conexiones HTTP quedan abiertas esperando y el gateway responde **504 Gateway Timeout**.
4. Al agotarse los recursos, las transacciones **fallan a medias** y se produce **overbooking**.

La causa raíz no es la lentitud de la pasarela: es haber acoplado **la duración de un bloqueo de
concurrencia a la latencia de un sistema externo que no controlamos**. Necesitamos un mecanismo que
garantice `un asiento = un comprador` con latencia de milisegundos, que **libere el recurso solo** si
el comprador abandona, y que no consuma conexiones de la base de datos transaccional.

### Requisitos que debe satisfacer la decisión

| ID | Requisito |
| --- | --- |
| R1 | La operación «tomar asiento» debe ser **atómica** entre procesos concurrentes. |
| R2 | La retención debe **expirar sola**, sin proceso de limpieza que pueda fallar. |
| R3 | Latencia p99 por debajo de **10 ms** bajo 500.000 usuarios concurrentes. |
| R4 | **No** debe consumir conexiones de la base de datos transaccional. |
| R5 | La verdad final de la venta debe seguir siendo **durable y auditable**. |

## Alternativas consideradas

### Alternativa 1 — Mantener el bloqueo pesimista de fila, reduciendo el tiempo de transacción

Conservar `SELECT ... FOR UPDATE` en PostgreSQL/MySQL, pero sacar la llamada a la pasarela fuera de la
transacción y usar `lock_timeout` agresivos.

- ✅ Cero tecnología nueva; garantía ACID directa; el equipo ya lo conoce.
- ❌ Sigue siendo **una conexión y un bloqueo por comprador en espera**: con 500.000 usuarios el pool
  se agota igual (incumple R3 y R4).
- ❌ La reserva no expira sola: haría falta un *job* de limpieza que es, en sí mismo, un punto de
  fallo (incumple R2).
- ❌ El asiento queda libre entre que termina la transacción y empieza el pago, reabriendo la carrera.

### Alternativa 2 — Bloqueo optimista con columna de versión en la base relacional

Añadir `version` a la tabla de asientos y resolver la concurrencia con `UPDATE ... WHERE version = ?`,
reintentando ante conflicto.

- ✅ No mantiene bloqueos abiertos; buen rendimiento con baja contención.
- ❌ El caso de FlashTix es de **contención extrema**: miles de compradores sobre los mismos asientos
  del mismo concierto. La tasa de reintentos se dispara y degrada a *livelock* (incumple R3).
- ❌ Cada intento y cada reintento sigue siendo una ida y vuelta a la base transaccional (incumple R4).
- ❌ No modela la **expiración** del interés del comprador: el optimismo resuelve la escritura, no la
  reserva temporal (incumple R2).

### Alternativa 3 — Partición del inventario con un consumidor único por evento (Kafka)

Convertir cada petición de asiento en un mensaje hacia una partición de Kafka por función, con un
único consumidor que serializa las decisiones.

- ✅ Elimina la concurrencia por construcción (un solo escritor por función) y escala por partición.
- ❌ Convierte una operación interactiva en asíncrona: el usuario **no sabe al instante** si consiguió
  el asiento, lo que empeora la experiencia en el momento más crítico de la compra.
- ❌ Una partición caliente (el concierto del artista global) se convierte en el nuevo cuello de
  botella: un solo consumidor secuencial para 500.000 personas.
- ❌ Añade Kafka al stack obligatorio cuando RabbitMQ ya cubre la mensajería del proyecto.

## Decisión

> Adoptamos la **reserva suave (*soft lock*) en Redis**: la retención de asientos se implementa como
> claves en Redis con **TTL de 10 minutos**, creadas y verificadas por un **script Lua ejecutado de
> forma atómica** en el servidor Redis. La base de datos relacional deja de participar en el control
> de concurrencia y pasa a registrar únicamente el **resultado durable** de la venta.

Elementos concretos de la decisión:

1. **Clave por asiento:** `hold:{functionId}:{seatId}` con valor `{holdId, userId}` y `TTL = 600 s`.
2. **Script Lua atómico:** verifica que *todos* los asientos del grupo estén libres y los marca en una
   sola ejecución indivisible; si alguno está tomado, no toma ninguno (semántica «todo o nada»).
3. **holdToken firmado (HMAC):** el `Queue & Hold Service` devuelve al cliente un token firmado con
   `holdId`, `seatIds` y `exp`. El `Ordering Service` lo **verifica criptográficamente sin llamar a
   Redis ni al Core**, lo que elimina una dependencia síncrona entre servicios.
4. **Expiración pasiva:** Redis libera el asiento al vencer el TTL. El servicio publica `hold.expired`
   mediante *keyspace notifications* para que el read model de disponibilidad se actualice.
5. **Persistencia de la verdad:** al confirmarse el pago, `order.confirmed` hace que el
   `Event & Inventory Service` escriba la venta en PostgreSQL con una restricción
   `UNIQUE (function_id, seat_id)` como última línea de defensa contra el overbooking.
6. **Configuración de Redis:** instancia dedicada al inventario (separada de la de caché de catálogo),
   con `appendonly yes` y política de desalojo `noeviction` para que **jamás** se descarte un hold por
   presión de memoria.

## Trade-offs

### Positivos (qué ganamos)

- **El bloqueo deja de depender de la pasarela.** La retención dura un TTL que nosotros fijamos, no los
  15 s que tarde un tercero. Se rompe el acoplamiento que originaba la cascada de fallos.
- **Latencia de milisegundos.** Redis en memoria sostiene la operación en p99 < 5 ms, frente a las
  decenas o cientos de milisegundos de un bloqueo relacional bajo contención (R3).
- **El pool de conexiones transaccional queda intacto.** Navegar, elegir asiento y reservar ya no
  consume ni una conexión de PostgreSQL; la base solo se toca al confirmar la venta (R4).
- **Liberación automática y sin proceso de limpieza.** El TTL es una garantía del propio motor: no hay
  *job* que se pueda caer y dejar asientos bloqueados para siempre (R2).
- **Atomicidad real sin transacción distribuida.** El script Lua es indivisible por definición de
  Redis, lo que da la garantía de R1 sin pagar el precio de un 2PC.
- **Desacoplamiento entre servicios.** El `holdToken` firmado evita una llamada síncrona
  `Ordering → Queue & Hold` en el camino crítico de la compra.

### Negativos (riesgos y cómo se mitigan)

| Riesgo | Mitigación |
| --- | --- |
| **Redis se convierte en un punto único de fallo del Core Domain.** | Redis en modo **Sentinel/Cluster** con réplica y *failover* automático; `appendonly yes` (AOF `everysec`) para recuperar el estado tras un reinicio; alerta de observabilidad sobre disponibilidad y memoria. |
| **La verdad del inventario vive temporalmente fuera de la base ACID.** | El hold es **temporal por diseño**; la venta confirmada siempre aterriza en PostgreSQL con `UNIQUE (function_id, seat_id)`, que rechazaría cualquier duplicado que se escapara. |
| **Consistencia eventual:** la disponibilidad mostrada puede ir unos cientos de milisegundos por detrás. | Es aceptable para *mostrar* el mapa de asientos; el usuario descubre la verdad al reservar, donde la operación sí es atómica. El `Projection Worker` mantiene el desfase acotado y se monitorea como métrica. |
| **Complejidad operativa nueva:** scripts Lua, TTL, dos instancias de Redis. | El script Lua se versiona en el repositorio y se cubre con pruebas de concurrencia; se separan las instancias de caché e inventario para que una no desaloje datos de la otra. |
| **Un TTL mal dimensionado frustra al comprador o retiene asientos de más.** | TTL inicial de 10 min, expuesto como variable de entorno; se ajustará con la métrica de *tasa de holds expirados* del dashboard de Grafana. |

## Justificación final

Las alternativas 1 y 2 comparten el defecto que originó el incidente: **resuelven la concurrencia
dentro de la base de datos transaccional**, el recurso más escaso y frágil del sistema bajo un pico de
500.000 usuarios. Mejorarlas reduce el daño, pero no cambia la naturaleza del problema. La
alternativa 3 sí saca la concurrencia de la base de datos, pero paga un precio inaceptable en
experiencia de usuario justo en el momento de mayor valor, y traslada el cuello de botella a una
partición caliente.

La reserva suave en Redis es la única opción que satisface los cinco requisitos a la vez: da
atomicidad real (R1), expiración autónoma (R2), latencia de milisegundos bajo contención extrema (R3),
cero presión sobre el pool transaccional (R4) y conserva PostgreSQL como registro durable y auditable
de la venta (R5). Además, la misma instancia de Redis sostiene la **cola virtual** (ZSET ordenado por
tiempo de llegada) y las **claves de idempotencia**, de modo que una sola pieza de infraestructura
resuelve tres de los problemas del caso.

En una frase: **el asiento deja de estar protegido por un bloqueo que dura lo que tarde un tercero, y
pasa a estar protegido por una reserva que dura lo que nosotros decidimos.**

## Consecuencias para el resto de la arquitectura

- El `Ordering Service` **no** necesita llamar al `Queue & Hold Service`: verifica el `holdToken`.
- El `Catalog Query Service` nunca consulta el inventario real; lee el read model que el
  `Projection Worker` construye a partir de `hold.created`, `hold.expired` y `order.confirmed`.
- Aparecen dos métricas de primer nivel en el dashboard: **tasa de holds expirados** y **latencia p99
  del script Lua**.

## ADRs relacionados (pendientes de redactar)

- **ADR-002** — RabbitMQ frente a Kafka como bus de eventos y comandos.
- **ADR-003** — CQRS con MongoDB y Redis para el catálogo, frente a réplicas de lectura de PostgreSQL.
