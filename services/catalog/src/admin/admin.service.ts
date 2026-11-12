import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { AppError } from '@flashtix/shared';
import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';
import { CatalogService } from '../events/catalog.service';
import { MYSQL } from '../tokens';
import { type NewEvent, validateNewEvent } from './validate-event';

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    @Inject(MYSQL) private readonly pool: Pool,
    private readonly catalog: CatalogService,
  ) {}

  /** `POST /admin/events`: saves the event as DRAFT (ADM-1). */
  async createEvent(body: unknown): Promise<{ eventId: string; status: 'DRAFT'; name: string }> {
    const event = validateNewEvent(body);
    const eventId = randomUUID();

    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      await this.assertNew(connection, event);
      const venueId = await this.findOrCreateVenue(connection, event.venue);

      await connection.execute(
        `INSERT INTO events (event_id, name, artist, venue_id, starts_at, sale_starts_at, status)
         VALUES (?, ?, ?, ?, ?, ?, 'DRAFT')`,
        [eventId, event.name, event.artist, venueId, event.startsAt, event.saleStartsAt],
      );
      await connection.query('INSERT INTO price_categories (event_id, category, price_amount, currency) VALUES ?', [
        event.priceCategories.map((item) => [eventId, item.category, item.amount, item.currency]),
      ]);
      // One statement per chunk keeps each packet well below max_allowed_packet.
      for (let from = 0; from < event.seats.length; from += 1000) {
        await connection.query(
          'INSERT INTO seats (event_id, seat_id, section, row_label, seat_number, category) VALUES ?',
          [event.seats.slice(from, from + 1000).map((s) => [eventId, s.seatId, s.section, s.row, s.number, s.category])],
        );
      }
      await connection.commit();
    } catch (error) {
      await connection.rollback().catch(() => undefined);
      if ((error as { code?: string }).code === 'ER_DUP_ENTRY') {
        throw new AppError('EVENT_ALREADY_EXISTS', 'An event with this name, artist and date already exists');
      }
      throw error;
    } finally {
      connection.release();
    }

    this.logger.log(`event ${eventId} created as DRAFT with ${event.seats.length} seat(s)`);
    return { eventId, status: 'DRAFT', name: event.name };
  }

  private async assertNew(connection: PoolConnection, event: NewEvent): Promise<void> {
    const [rows] = await connection.query<RowDataPacket[]>(
      'SELECT event_id FROM events WHERE name = ? AND artist = ? AND starts_at = ? LIMIT 1 FOR UPDATE',
      [event.name, event.artist, event.startsAt],
    );
    if (rows.length > 0) {
      throw new AppError('EVENT_ALREADY_EXISTS', 'An event with this name, artist and date already exists');
    }
  }

  private async findOrCreateVenue(connection: PoolConnection, venue: NewEvent['venue']): Promise<string> {
    const [rows] = await connection.query<RowDataPacket[]>(
      'SELECT venue_id FROM venues WHERE name = ? AND city = ? LIMIT 1',
      [venue.name, venue.city],
    );
    if (rows[0]) return rows[0].venue_id as string;
    const venueId = randomUUID();
    await connection.execute('INSERT INTO venues (venue_id, name, city) VALUES (?, ?, ?)', [
      venueId,
      venue.name,
      venue.city,
    ]);
    return venueId;
  }

  /**
   * `POST /admin/events/{eventId}/publish` (ADM-2): DRAFT -> PUBLISHED and the event is
   * loaded into catalog-cache before the sale opens. The status change is one conditional
   * UPDATE, so two organizers publishing at once cannot both succeed.
   */
  async publish(eventId: string): Promise<{ eventId: string; status: 'PUBLISHED'; saleStartsAt: string }> {
    const [result] = await this.pool.execute(
      "UPDATE events SET status = 'PUBLISHED' WHERE event_id = ? AND status = 'DRAFT'",
      [eventId],
    );

    if ((result as { affectedRows: number }).affectedRows === 0) {
      const [rows] = await this.pool.query<RowDataPacket[]>('SELECT status FROM events WHERE event_id = ?', [eventId]);
      if (!rows[0]) throw new AppError('EVENT_NOT_FOUND', `Event ${eventId} does not exist`);
      throw new AppError('INVALID_EVENT_STATUS', `Only a DRAFT event can be published, this one is ${String(rows[0].status)}`);
    }

    await this.catalog.preload(eventId);
    const event = (await this.catalog.getEvent(eventId)).value;
    this.logger.log(`event ${eventId} PUBLISHED and preloaded into the cache`);
    return { eventId, status: 'PUBLISHED', saleStartsAt: event.saleStartsAt };
  }

  /**
   * Opens the sale: PUBLISHED -> ON_SALE once `sale_starts_at` has passed (spec.md section
   * 4). Called by the scheduler. Each event is flipped by a conditional UPDATE, so several
   * Catalog replicas running this at once is harmless.
   */
  async openDueSales(): Promise<string[]> {
    const [due] = await this.pool.query<RowDataPacket[]>(
      "SELECT event_id FROM events WHERE status = 'PUBLISHED' AND sale_starts_at <= UTC_TIMESTAMP(3)",
    );
    const opened: string[] = [];
    for (const row of due) {
      const eventId = row.event_id as string;
      const [result] = await this.pool.execute(
        "UPDATE events SET status = 'ON_SALE' WHERE event_id = ? AND status = 'PUBLISHED'",
        [eventId],
      );
      if ((result as { affectedRows: number }).affectedRows > 0) {
        await this.catalog.evict(eventId);
        opened.push(eventId);
        this.logger.log(`sale of event ${eventId} is now open (ON_SALE)`);
      }
    }
    return opened;
  }
}
