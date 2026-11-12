import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { AppError } from '@flashtix/shared';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { CatalogClient } from '../clients/catalog.client';
import { ReservationClient } from '../clients/reservation.client';
import { addToOutbox, inTransaction } from '../outbox/outbox';
import { OutboxRelay } from '../outbox/outbox.relay';
import { MYSQL } from '../tokens';

export interface CreateOrderInput {
  userId: string;
  userEmail: string;
  idempotencyKey: string;
  holdId: string;
  paymentMethodToken: string;
}

export interface CreateOrderResult {
  replayed: boolean;
  body: {
    orderId: string;
    status: 'PENDING';
    total: { amount: number; currency: string };
    statusUrl: string;
  };
}

const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{8,64}$/;

/**
 * The order id is derived from (fan, Idempotency-Key). A client that retries after a
 * timeout gets the SAME order id, so LockHold answers "already locked by this order"
 * instead of HOLD_LOCKED, and the retry finishes the work the first attempt started.
 */
function orderIdFor(userId: string, idempotencyKey: string): string {
  const hex = createHash('sha256').update(`${userId}:${idempotencyKey}`).digest('hex');
  const variant = ((parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function hashRequest(holdId: string, paymentMethodToken: string): string {
  return createHash('sha256').update(JSON.stringify({ holdId, paymentMethodToken })).digest('hex');
}

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    @Inject(MYSQL) private readonly pool: Pool,
    private readonly reservation: ReservationClient,
    private readonly catalog: CatalogClient,
    private readonly relay: OutboxRelay,
  ) {}

  /**
   * ORD-3. Start of the checkout saga (ADR 003). It never calls the payment gateway:
   * it locks the hold, saves the order and its payment.requested event in ONE transaction,
   * and answers 202 at once.
   */
  async create(input: CreateOrderInput): Promise<CreateOrderResult> {
    if (!input.idempotencyKey) {
      throw new AppError('MISSING_IDEMPOTENCY_KEY', 'The Idempotency-Key header is required');
    }
    if (!IDEMPOTENCY_KEY.test(input.idempotencyKey)) {
      throw new AppError('VALIDATION_ERROR', 'Idempotency-Key must be 8-64 letters, digits, "-" or "_"');
    }

    const requestHash = hashRequest(input.holdId, input.paymentMethodToken);
    const replay = await this.findReplay(input.userId, input.idempotencyKey, requestHash);
    if (replay) return replay;

    const orderId = orderIdFor(input.userId, input.idempotencyKey);
    const hold = await this.reservation.lockHold(input.holdId, orderId, input.userId);
    const seats = await this.catalog.priceSeats(hold.eventId, hold.seatIds);
    const currency = seats[0]!.price.currency;
    const total = seats.reduce((sum, seat) => sum + seat.price.amount, 0);

    try {
      await inTransaction(this.pool, async (connection) => {
        await connection.execute(
          `INSERT INTO orders (order_id, user_id, user_email, event_id, hold_id, idempotency_key,
                               request_hash, status, total_amount, currency, version)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, 0)`,
          [orderId, input.userId, input.userEmail, hold.eventId, hold.holdId, input.idempotencyKey,
            requestHash, total, currency],
        );
        await connection.query(
          'INSERT INTO order_seats (order_id, seat_id, category, price_amount, currency) VALUES ?',
          [seats.map((seat) => [orderId, seat.seatId, seat.category, seat.price.amount, seat.price.currency])],
        );
        await addToOutbox(connection, {
          eventType: 'payment.requested',
          aggregateId: orderId,
          aggregateVersion: 0,
          data: {
            orderId,
            userId: input.userId,
            amount: { amount: total, currency },
            paymentMethodToken: input.paymentMethodToken,
          },
        });
      });
    } catch (error) {
      // Two identical requests raced: the loser answers as a replay of the winner.
      if ((error as { code?: string }).code === 'ER_DUP_ENTRY') {
        const raced = await this.findReplay(input.userId, input.idempotencyKey, requestHash);
        if (raced) return raced;
        throw new AppError('HOLD_LOCKED', 'This hold is already part of another order');
      }
      throw error;
    }

    this.relay.kick();
    this.logger.log(`order ${orderId} created (PENDING) for ${seats.length} seat(s)`);
    return { replayed: false, body: this.acceptedBody(orderId, total, currency) };
  }

  private acceptedBody(orderId: string, total: number, currency: string): CreateOrderResult['body'] {
    return {
      orderId,
      status: 'PENDING',
      total: { amount: total, currency },
      statusUrl: `/v1/orders/${orderId}`,
    };
  }

  /** Same key and same body: answer exactly like the first time. Same key, other body: 409. */
  private async findReplay(
    userId: string,
    idempotencyKey: string,
    requestHash: string,
  ): Promise<CreateOrderResult | undefined> {
    const [rows] = await this.pool.query<RowDataPacket[]>(
      'SELECT order_id, request_hash, total_amount, currency FROM orders WHERE user_id = ? AND idempotency_key = ?',
      [userId, idempotencyKey],
    );
    const row = rows[0];
    if (!row) return undefined;
    if (row.request_hash !== requestHash) {
      throw new AppError('IDEMPOTENCY_KEY_REUSED', 'This Idempotency-Key was already used with a different body');
    }
    return {
      replayed: true,
      body: this.acceptedBody(row.order_id as string, Number(row.total_amount), row.currency as string),
    };
  }

  /** GET /orders/{orderId}. Only the fan who owns the order may read it. */
  async get(orderId: string, userId: string) {
    const [orders] = await this.pool.query<RowDataPacket[]>('SELECT * FROM orders WHERE order_id = ?', [orderId]);
    const order = orders[0];
    if (!order || order.user_id !== userId) {
      throw new AppError('ORDER_NOT_FOUND', `Order ${orderId} does not exist`);
    }
    const [seats] = await this.pool.query<RowDataPacket[]>(
      'SELECT seat_id, category, price_amount, currency FROM order_seats WHERE order_id = ? ORDER BY seat_id',
      [orderId],
    );
    return {
      orderId,
      eventId: order.event_id as string,
      holdId: order.hold_id as string,
      status: order.status as string,
      failureReason: (order.failure_reason as string | null) ?? null,
      seats: seats.map((seat) => ({
        seatId: seat.seat_id as string,
        category: seat.category as string,
        price: { amount: Number(seat.price_amount), currency: seat.currency as string },
      })),
      total: { amount: Number(order.total_amount), currency: order.currency as string },
      version: Number(order.version),
      createdAt: (order.created_at as Date).toISOString(),
      updatedAt: (order.updated_at as Date).toISOString(),
    };
  }
}
