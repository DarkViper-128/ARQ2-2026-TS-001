import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { AppError, type EventPublisher, signTicketQr } from '@flashtix/shared';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { CatalogClient } from '../clients/catalog.client';
import { renderTicketPdf } from '../pdf/ticket-pdf';
import { TicketStorage } from '../storage/ticket-storage';
import { EVENT_PUBLISHER, MYSQL } from '../tokens';

/** `data` of order.confirmed (spec.md section 5). */
export interface OrderConfirmed {
  orderId: string;
  userId: string;
  userEmail: string;
  eventId: string;
  holdId: string;
  seats: { seatId: string; category?: string }[];
}

export interface TicketView {
  ticketId: string;
  orderId: string;
  eventId: string;
  seatId: string;
  category: string;
  qrPayload: string;
  pdfObjectKey: string;
  issuedAt: string;
}

function toView(row: RowDataPacket): TicketView {
  return {
    ticketId: row.ticket_id as string,
    orderId: row.order_id as string,
    eventId: row.event_id as string,
    seatId: row.seat_id as string,
    category: row.category as string,
    qrPayload: row.qr_payload as string,
    pdfObjectKey: row.pdf_object_key as string,
    issuedAt: (row.issued_at as Date).toISOString(),
  };
}

@Injectable()
export class TicketsService {
  private readonly logger = new Logger(TicketsService.name);
  private readonly qrSecret = process.env.TICKET_QR_SECRET ?? '';

  constructor(
    @Inject(MYSQL) private readonly pool: Pool,
    @Inject(EVENT_PUBLISHER) private readonly publisher: EventPublisher,
    private readonly catalog: CatalogClient,
    private readonly storage: TicketStorage,
  ) {}

  /**
   * TKT-2 and TKT-3 (spec.md requirement F5). Issues one ticket per seat of a confirmed
   * order and announces them with ticket.issued.
   *
   * It is idempotent on its own, not only through processed_events: `UNIQUE (order_id,
   * seat_id)` guarantees a seat never gets two tickets, and tickets that already exist are
   * reused. So a delivery that crashed half way is simply finished by the retry, and
   * ticket.issued is published again (at-least-once). The Notification Worker deduplicates
   * the email with `dedupKey`.
   */
  async issue(order: OrderConfirmed, correlationId?: string): Promise<void> {
    if (!Array.isArray(order.seats) || order.seats.length === 0) {
      throw new Error(`order ${order.orderId} was confirmed with no seats`);
    }

    const existing = await this.byOrder(order.orderId);
    const have = new Set(existing.map((ticket) => ticket.seatId));
    const missing = order.seats.filter((seat) => !have.has(seat.seatId));

    if (missing.length > 0) {
      const event = await this.catalog.getEvent(order.eventId);
      for (const seat of missing) {
        await this.issueOne(order, seat.seatId, seat.category ?? 'GENERAL', event);
      }
    }

    const tickets = await this.byOrder(order.orderId);
    await this.publisher.publish({
      eventType: 'ticket.issued',
      aggregateId: order.orderId,
      ...(correlationId ? { correlationId } : {}),
      data: {
        orderId: order.orderId,
        userEmail: order.userEmail,
        eventId: order.eventId,
        dedupKey: `ticket.issued:${order.orderId}`,
        tickets: tickets.map((ticket) => ({
          ticketId: ticket.ticketId,
          seatId: ticket.seatId,
          pdfObjectKey: ticket.pdfObjectKey,
        })),
      },
    });
    this.logger.log(`order ${order.orderId}: ${tickets.length} ticket(s) issued`);
  }

  private async issueOne(
    order: OrderConfirmed,
    seatId: string,
    category: string,
    event: Awaited<ReturnType<CatalogClient['getEvent']>>,
  ): Promise<void> {
    const ticketId = randomUUID();
    const qrPayload = signTicketQr({ ticketId, eventId: order.eventId, seatId }, this.qrSecret);
    const key = `tickets/${order.eventId}/${order.orderId}/${ticketId}.pdf`;

    const pdf = await renderTicketPdf({
      ticketId,
      orderId: order.orderId,
      qrPayload,
      seatId,
      category,
      event,
    });
    await this.storage.putPdf(key, pdf);

    try {
      await this.pool.execute(
        `INSERT INTO tickets (ticket_id, order_id, event_id, user_id, seat_id, category, qr_payload, pdf_object_key)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [ticketId, order.orderId, order.eventId, order.userId, seatId, category, qrPayload, key],
      );
    } catch (error) {
      // A concurrent delivery issued this seat first: keep its ticket, drop our PDF.
      if ((error as { code?: string }).code === 'ER_DUP_ENTRY') {
        await this.storage.delete(key);
        return;
      }
      throw error;
    }
  }

  private async byOrder(orderId: string): Promise<TicketView[]> {
    const [rows] = await this.pool.query<RowDataPacket[]>(
      'SELECT * FROM tickets WHERE order_id = ? ORDER BY seat_id',
      [orderId],
    );
    return rows.map(toView);
  }

  /** TKT-4. `GET /tickets/{ticketId}`: only the fan who holds the ticket may read it. */
  async get(ticketId: string, userId: string) {
    const [rows] = await this.pool.query<RowDataPacket[]>('SELECT * FROM tickets WHERE ticket_id = ?', [ticketId]);
    const row = rows[0];
    // The same 404 for "does not exist" and "belongs to someone else": do not confirm that a
    // ticket id exists to a stranger.
    if (!row || row.user_id !== userId) {
      throw new AppError('TICKET_NOT_FOUND', `Ticket ${ticketId} does not exist`);
    }
    const ticket = toView(row);
    return {
      ticketId: ticket.ticketId,
      orderId: ticket.orderId,
      eventId: ticket.eventId,
      seatId: ticket.seatId,
      category: ticket.category,
      qrPayload: ticket.qrPayload,
      issuedAt: ticket.issuedAt,
      downloadUrl: await this.storage.downloadUrl(ticket.pdfObjectKey),
    };
  }
}
