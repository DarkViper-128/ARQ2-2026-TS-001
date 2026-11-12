import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { TicketFilesClient } from '../clients/ticket-files.client';
import { type Mail, Mailer } from '../mail/mailer';
import {
  type IssuedTicket,
  type Money,
  orderCancelledEmail,
  orderFailedEmail,
  ticketsEmail,
} from '../mail/templates';
import { MYSQL } from '../tokens';

/** `data` of ticket.issued (spec.md section 5). */
export interface TicketIssued {
  orderId: string;
  userEmail: string;
  eventId: string;
  dedupKey?: string;
  tickets: (IssuedTicket & { pdfObjectKey: string })[];
}

export interface OrderFailed {
  orderId: string;
  userEmail: string;
  reason: string;
}

export interface OrderCancelled {
  orderId: string;
  userEmail: string;
  reason: string;
  refunded?: Money | boolean;
  dedupKey?: string;
}

interface Notification {
  dedupKey: string;
  eventType: string;
  orderId: string;
  recipient: string;
  build: () => Promise<Mail>;
}

/**
 * NOT-2 and NOT-3 (spec.md requirement F5: "the fan receives one email", never two).
 *
 * Every email has a dedup key (`<event>:<orderId>`) with a row in `notifications`. The row
 * is claimed and locked, the email is sent, and the row is marked SENT, all while holding
 * the lock, so two copies of the same event running at once cannot both send it.
 *
 * If the send fails the row stays PENDING and the error propagates: the broker retries
 * with the 1 s / 10 s / 60 s ladder and finally dead-letters, and a later delivery
 * sends it because the row is not SENT yet.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @Inject(MYSQL) private readonly pool: Pool,
    private readonly mailer: Mailer,
    private readonly files: TicketFilesClient,
  ) {}

  onTicketIssued(data: TicketIssued): Promise<void> {
    return this.notify({
      dedupKey: data.dedupKey ?? `ticket.issued:${data.orderId}`,
      eventType: 'ticket.issued',
      orderId: data.orderId,
      recipient: data.userEmail,
      build: async () => {
        const attachments = await Promise.all(
          data.tickets.map(async (ticket) => ({
            filename: `flashtix-ticket-${ticket.seatId}.pdf`,
            content: await this.files.read(ticket.pdfObjectKey),
            contentType: 'application/pdf',
          })),
        );
        return ticketsEmail(data.userEmail, data.orderId, data.tickets, attachments);
      },
    });
  }

  onOrderFailed(data: OrderFailed): Promise<void> {
    return this.notify({
      dedupKey: `order.failed:${data.orderId}`,
      eventType: 'order.failed',
      orderId: data.orderId,
      recipient: data.userEmail,
      build: async () => orderFailedEmail(data.userEmail, data.orderId, data.reason),
    });
  }

  onOrderCancelled(data: OrderCancelled): Promise<void> {
    const refunded = typeof data.refunded === 'object' ? data.refunded : undefined;
    return this.notify({
      dedupKey: data.dedupKey ?? `order.cancelled:${data.orderId}`,
      eventType: 'order.cancelled',
      orderId: data.orderId,
      recipient: data.userEmail,
      build: async () => orderCancelledEmail(data.userEmail, data.orderId, data.reason, refunded),
    });
  }

  private async notify(notification: Notification): Promise<void> {
    if (!notification.recipient) {
      throw new Error(`${notification.eventType} for order ${notification.orderId} has no recipient`);
    }

    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.execute(
        `INSERT IGNORE INTO notifications (dedup_key, channel, event_type, order_id, recipient)
         VALUES (?, 'EMAIL', ?, ?, ?)`,
        [notification.dedupKey, notification.eventType, notification.orderId, notification.recipient],
      );
      const [rows] = await connection.query<RowDataPacket[]>(
        "SELECT status FROM notifications WHERE dedup_key = ? AND channel = 'EMAIL' FOR UPDATE",
        [notification.dedupKey],
      );

      if (rows[0]?.status === 'SENT') {
        await connection.commit();
        this.logger.log(`${notification.dedupKey} already sent, skipping`);
        return;
      }

      try {
        await this.mailer.send(await notification.build());
      } catch (error) {
        await connection.execute(
          `UPDATE notifications SET attempts = attempts + 1, last_error = ?
            WHERE dedup_key = ? AND channel = 'EMAIL'`,
          [String(error).slice(0, 255), notification.dedupKey],
        );
        await connection.commit();
        throw error;
      }

      await connection.execute(
        `UPDATE notifications SET status = 'SENT', attempts = attempts + 1, last_error = NULL, sent_at = NOW(3)
          WHERE dedup_key = ? AND channel = 'EMAIL'`,
        [notification.dedupKey],
      );
      await connection.commit();
      this.logger.log(`${notification.dedupKey} emailed to ${notification.recipient}`);
    } catch (error) {
      await connection.rollback().catch(() => undefined);
      throw error;
    } finally {
      connection.release();
    }
  }
}
