# FlashTix — Especificación de diseño y paleta de colores (Frontend)

## Paleta de colores (modo oscuro)

Todos los colores usados actualmente en el frontend (aplicados a Login, Catalog, FanDashboard, EventSeats, Hold, Order, Payment, Tickets, AdminDashboard, MainLayout y Orders):

| Token | Valor hex | Uso |
|-------|-----------|-----|
| `--bg-body` | `#0f172a` | Fondo de página / contenedor principal (slate-900) |
| `--bg-card` | `#1e293b` | Fondos de tarjetas, paneles, modales (slate-800) |
| `--bg-input` | `#0f172a` | Fondo de campos de entrada |
| `--border` | `#334155` | Bordes de tarjetas, inputs, tablas (slate-700) |
| `--border-focus` | `#2563eb` | Borde de foco en inputs (blue-600) |
| `--text-primary` | `#f1f5f9` | Texto principal (slate-100) |
| `--text-secondary` | `#94a3b8` | Texto secundario, etiquetas, placeholders (slate-400) |
| `--text-muted` | `#64748b` | Texto atenuado (slate-500) |
| `--accent-blue` | `#2563eb` | Botones primarios, enlaces de nav activos (blue-600) |
| `--accent-blue-hover` | `#1d4ed8` | Estado hover de botones azules (blue-700) |
| `--accent-red` | `#ef4444` | Botones de acción destructiva / liberar asientos (red-500) |
| `--success` | `#14532d` / `#4ade80` | Fondos y texto de estado confirmado (green-900/30) |
| `--warning` | `#78350f` / `#fbbf24` | Fondos y texto de estado pendiente (yellow-900/30) |
| `--error` | `#7f1d1d` / `#fca5a5` | Fondos y texto de estado fallido / error (red-900/30) |
| `--cancelled` | `#334155` / `#9ca3af` | Fondos y texto de estado cancelado (slate-800/500) |
| `--shadow` | `rgba(0,0,0,0.3)` | Sombras de tarjetas |

## Arquitectura del frontend

- React 18 + Vite 5, TypeScript strict
- Estilos inline con `React.CSSProperties` (sin CSS externo)
- Routing con `react-router-dom`
- Estado de autenticación vía `AuthContext` (token en `localStorage` bajo `flashtix_token`)
- Cada pantalla guarda su estado temporal en `localStorage`: `flashtix_hold`, `flashtix_order`, `flashtix_admission_token`
- Comunicación con el backend a través de `frontend/src/lib/api.ts` (base `/v1`, Kong gateway en `:8000`)

## Rutas del frontend (fan)

| Ruta | Componente | Descripción |
|------|-----------|-------------|
| `/` / `/fan` | `FanDashboard` | Catálogo de eventos disponibles |
| `/events/:eventId/seats` | `EventSeats` | Mapa visual del auditorio, selección de asientos |
| `/hold` | `Hold` | Reserva activa, continuar al pago o liberar asientos |
| `/order` | `Order` | Pasarela de pago: datos de tarjeta y método |
| `/payment` | `Payment` | Estado del pago vía SSE + HTTP, reintento si falla |
| `/tickets` | `Tickets` | Boletas con QR y descarga PDF |
| `/orders` | `Orders` | Historial de órdenes del usuario |

## Rutas del frontend (organizador, `/admin`)

| Ruta | Componente | Descripción |
|------|-----------|-------------|
| `/admin` | `AdminDashboard` | Panel organizador, pestañas: eventos, mis eventos, órdenes, monitoreo |
| `/admin/events` | `AdminDashboard` | Listado de todos los eventos |
| `/admin/create` | `AdminDashboard` | Crear evento (guarda en DRAFT, publicable a ON_SALE) |
| `/admin/refunds` | `AdminDashboard` | Órdenes del sistema con búsqueda por ID de transacción y botón de reembolso |

## Flujo de compra del fan

1. **Catalog** (`/`) — lista de eventos disponibles. Botón "Ver asientos" → `/events/:eventId/seats`
2. **EventSeats / Reserva de asientos** (`/events/:eventId/seats`) — **mapa visual del auditorio** con los asientos del evento (basado en `totalSeats`, hasta 100). El usuario selecciona asientos individuales haciendo clic (disponible = gris oscuro, seleccionado = azul, ocupado = gris). Botón **"Continuar al pago"** → se une a la cola virtual, crea el *hold* con los asientos seleccionados y va a `/order`
3. **Order** (`/order`) — pasarela de pago: datos de tarjeta y método. Botón "Pagar y confirmar orden" → `/payment`
4. **Payment** (`/payment`) — polling de estado del pago vía SSE + HTTP. Página de pagos. Botón "Ver mis boletos" → `/tickets` cuando CONFIRMED
5. **Tickets** (`/tickets`) — lista de boletas con QR y descarga PDF

## Mapa de asientos (EventSeats.tsx)

- Grid de hasta 100 asientos (10 columnas × 10 filas), numerados `A-001` … `A-100`
- El número de asientos mostrados se deriva de `event.totalSeats` (límite 100)
- Cada asiento es un botón toggle: clic para seleccionar/deseleccionar
- Máximo 6 boletas por compra
- Al continuar, se envían los `seatIds` seleccionados al crear el *hold*

## Sidebar colapsable (MainLayout.tsx)

- Botón toggle (`‹` / `›`) en la parte superior del sidebar
- Estado colapsado: ancho 72px, solo íconos de navegación, se ocultan título de marca, rol y panel de usuario
- Estado expandido: ancho 260px, todos los textos y elementos visibles
- Transiciones suaves de 0.2s en ancho y padding

## Página de pagos

La página de pagos (`frontend/src/pages/Payment.tsx`) ya existe y está vinculada en el flujo:

- `Order.tsx` navega a `/payment` tras crear la orden con éxito
- `Payment.tsx` lee `flashtix_order` de `localStorage`, consulta `GET /orders/{id}` y hace SSE en `GET /v1/orders/{id}/events`
- Estados: PENDING → CONFIRMED / FAILED, con reintento desde `/hold`

## Script de seed de base de datos

`scripts/seed-purchases.mjs` — inserta compras confirmadas (órdenes, pagos, tickets) en las tres bases de datos:

- `booking-db` (puerto 3308): `orders`, `order_seats`, `sold_seats`
- `payment-db` (puerto 3309): `payments`
- `ticket-db` (puerto 3310): `tickets`

Uso:
```bash
node scripts/seed-purchases.mjs
```
Configura `MYSQL_ROOT_PASSWORD` en `.env` (por defecto `localdev123`). Limpia las tablas antes de insertar.

## Cómo correr el frontend

```bash
cd frontend
npm install      # si aún no están las dependencias
npm run dev      # Vite dev server, por defecto en http://localhost:5174
```

## Verificación

- `npx tsc --noEmit` → sin errores
- Servidor Vite respondiendo 200 en localhost

## Pantallas en modo oscuro (completado)

- `Login.tsx` — selector de rol + formulario organizador
- `Catalog.tsx`
- `FanDashboard.tsx`
- `EventSeats.tsx`
- `Hold.tsx`
- `Order.tsx`
- `Payment.tsx`
- `Tickets.tsx`
- `AdminDashboard.tsx`
- `Orders.tsx`
- `MainLayout.tsx` (sidebar + área principal)
