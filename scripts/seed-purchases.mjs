/**
 * Script de poblamiento: inserta compras confirmadas (órdenes, pagos, tickets)
 * para el evento existente de catálogo (World Tour 2026).
 *
 * Uso:
 *   node scripts/seed-purchases.mjs
 *
 * Lee .env de la raíz para MYSQL_ROOT_PASSWORD.
 */

import { createPool } from 'mysql2/promise';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

const ENV_PATH = path.resolve('.env');
const envText = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, 'utf8') : '';
const env = Object.fromEntries(
  envText.split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => {
      const idx = l.indexOf('=');
      return [l.slice(0, idx).trim(), l.slice(idx + 1).trim()];
    })
);

const MYSQL_ROOT_PASSWORD = env.MYSQL_ROOT_PASSWORD || 'localdev123';

const EVENT_ID = '3f0c8a52-0000-4000-8000-000000000001';
const NUM_PURCHASES = 37;

// Asientos a usar: 60 VIP (A-01-01..A-06-10) y 60 GENERAL (B-01-01..B-06-10)
const VIP_SEATS = Array.from({ length: 60 }, (_, i) => {
  const section = Math.floor(i / 10) + 1;
  const seat = (i % 10) + 1;
  return `A-${String(section).padStart(2, '0')}-${String(seat).padStart(2, '0')}`;
});
const GENERAL_SEATS = Array.from({ length: 60 }, (_, i) => {
  const section = Math.floor(i / 10) + 1;
  const seat = (i % 10) + 1;
  return `B-${String(section).padStart(2, '0')}-${String(seat).padStart(2, '0')}`;
});
const ALL_SEATS = [...VIP_SEATS, ...GENERAL_SEATS];

const SEAT_PRICE = {
  VIP: 45000000, // 450.000 COP en centavos
  GENERAL: 18000000, // 180.000 COP en centavos
};

function randomUserId() {
  return randomUUID();
}

function randomEmail() {
  const names = ['ana', 'beto', 'carla', 'diego', 'elena', 'fernando', 'gabriela', 'hugo', 'isabela', 'jorge'];
  const surnames = ['garcia', 'rodriguez', 'lopez', 'martinez', 'gonzalez', 'perez', 'sanchez', 'ramirez'];
  const n = names[Math.floor(Math.random() * names.length)];
  const s = surnames[Math.floor(Math.random() * surnames.length)];
  return `${n}.${s}${Math.floor(Math.random() * 9999)}@flashtix.test`;
}

async function main() {
  const booking = await createPool({
    host: '127.0.0.1',
    port: 3308,
    user: 'root',
    password: MYSQL_ROOT_PASSWORD,
    database: 'booking',
  });

  const payment = await createPool({
    host: '127.0.0.1',
    port: 3309,
    user: 'root',
    password: MYSQL_ROOT_PASSWORD,
    database: 'payment',
  });

  const ticket = await createPool({
    host: '127.0.0.1',
    port: 3310,
    user: 'root',
    password: MYSQL_ROOT_PASSWORD,
    database: 'ticket',
  });

  console.log(`🔗 Conectado a booking-db, payment-db y ticket-db`);

  // Limpiar tablas previas para tener una siembra limpia
  await booking.query('DELETE FROM sold_seats');
  await booking.query('DELETE FROM order_seats');
  await booking.query('DELETE FROM orders');
  await payment.query('DELETE FROM payments');
  await ticket.query('DELETE FROM tickets');
  console.log(`🧹 Tablas limpiadas`);

  let inserted = 0;
  for (let i = 0; i < NUM_PURCHASES; i++) {
    const orderId = randomUUID();
    const holdId = randomUUID();
    const paymentId = randomUUID();
    const userId = randomUserId();
    const userEmail = randomEmail();
    const seatId = ALL_SEATS[i];
    const category = seatId.startsWith('A') ? 'VIP' : 'GENERAL';
    const priceAmount = SEAT_PRICE[category];
    const now = new Date().toISOString().replace(/T/, ' ').replace(/\..*/, '');

    // 1. Orden confirmada en booking-db
    await booking.query(
      `INSERT INTO orders (order_id, user_id, user_email, event_id, hold_id, idempotency_key,
                           request_hash, status, total_amount, currency, version, payment_id, gateway_reference)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'CONFIRMED', ?, 'COP', 0, ?, ?)`,
      [orderId, userId, userEmail, EVENT_ID, holdId, `seed-${i}`, `hash-${i}`, priceAmount, paymentId, `gw-${randomUUID()}`]
    );

    await booking.query(
      `INSERT INTO order_seats (order_id, seat_id, category, price_amount, currency)
       VALUES (?, ?, ?, ?, 'COP')`,
      [orderId, seatId, category, priceAmount]
    );

    await booking.query(
      `INSERT INTO sold_seats (event_id, seat_id, order_id) VALUES (?, ?, ?)`,
      [EVENT_ID, seatId, orderId]
    );

    // 2. Pago exitoso en payment-db
    await payment.query(
      `INSERT INTO payments (payment_id, order_id, user_id, amount, currency, status,
                           gateway_payment_id, gateway_reference, attempts)
       VALUES (?, ?, ?, ?, 'COP', 'SUCCEEDED', ?, ?, 1)`,
      [paymentId, orderId, userId, priceAmount, `gw-${paymentId}`, `gw-ref-${randomUUID()}`]
    );

    // 3. Ticket en ticket-db
    await ticket.query(
      `INSERT INTO tickets (ticket_id, order_id, event_id, user_id, seat_id, category, qr_payload, pdf_object_key)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [randomUUID(), orderId, EVENT_ID, userId, seatId, category, `FTX1.${randomUUID()}`, `tickets/${orderId}/${seatId}.pdf`]
    );

    inserted++;
    if (inserted % 20 === 0) {
      console.log(`   ${inserted}/${NUM_PURCHASES} compras insertadas...`);
    }
  }

  console.log(`✅ ${inserted} compras confirmadas insertadas para el evento ${EVENT_ID}`);

  await booking.end();
  await payment.end();
  await ticket.end();
}

main().catch((err) => {
  console.error('❌ Error poblando la base de datos:', err);
  process.exit(1);
});
