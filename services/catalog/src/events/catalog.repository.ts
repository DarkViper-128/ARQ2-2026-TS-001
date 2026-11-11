import { Inject, Injectable } from '@nestjs/common';
import { AppError } from '@flashtix/shared';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { MYSQL } from '../tokens';

export interface EventSummary {
  eventId: string;
  name: string;
  artist: string;
  venue: { venueId: string; name: string; city: string };
  startsAt: string;
  saleStartsAt: string;
  status: string;
}

export interface EventDetail extends EventSummary {
  priceCategories: { category: string; price: { amount: number; currency: string } }[];
}

export interface SeatRow {
  seatId: string;
  section: string;
  row: string;
  number: string;
  category: string;
}

/**
 * Reads catalog-db. This is the ONLY place that touches MySQL, and it is only reached
 * on a cache miss: `booking-db` is never queried from here (spec.md, requirement F2).
 */
@Injectable()
export class CatalogRepository {
  constructor(@Inject(MYSQL) private readonly pool: Pool) {}

  private static toSummary(row: RowDataPacket): EventSummary {
    return {
      eventId: row.event_id as string,
      name: row.name as string,
      artist: row.artist as string,
      venue: {
        venueId: row.venue_id as string,
        name: row.venue_name as string,
        city: row.city as string,
      },
      startsAt: (row.starts_at as Date).toISOString(),
      saleStartsAt: (row.sale_starts_at as Date).toISOString(),
      status: row.status as string,
    };
  }

  private static readonly EVENT_COLUMNS = `
    e.event_id, e.name, e.artist, e.starts_at, e.sale_starts_at, e.status,
    v.venue_id, v.name AS venue_name, v.city`;

  async listPublishedEvents(): Promise<EventSummary[]> {
    const [rows] = await this.pool.query<RowDataPacket[]>(
      `SELECT ${CatalogRepository.EVENT_COLUMNS}
         FROM events e JOIN venues v ON v.venue_id = e.venue_id
        WHERE e.status IN ('PUBLISHED', 'ON_SALE', 'SOLD_OUT')
        ORDER BY e.starts_at`,
    );
    return rows.map(CatalogRepository.toSummary);
  }

  async findEvent(eventId: string): Promise<EventDetail> {
    const [rows] = await this.pool.query<RowDataPacket[]>(
      `SELECT ${CatalogRepository.EVENT_COLUMNS}
         FROM events e JOIN venues v ON v.venue_id = e.venue_id
        WHERE e.event_id = ?`,
      [eventId],
    );
    const row = rows[0];
    if (!row) throw new AppError('EVENT_NOT_FOUND', `Event ${eventId} does not exist`);

    const [prices] = await this.pool.query<RowDataPacket[]>(
      'SELECT category, price_amount, currency FROM price_categories WHERE event_id = ? ORDER BY price_amount DESC',
      [eventId],
    );

    return {
      ...CatalogRepository.toSummary(row),
      priceCategories: prices.map((price) => ({
        category: price.category as string,
        price: { amount: Number(price.price_amount), currency: price.currency as string },
      })),
    };
  }

  async findSeatMap(eventId: string): Promise<SeatRow[]> {
    const [rows] = await this.pool.query<RowDataPacket[]>(
      `SELECT seat_id, section, row_label, seat_number, category
         FROM seats WHERE event_id = ? ORDER BY section, row_label, seat_number`,
      [eventId],
    );
    if (rows.length === 0) {
      throw new AppError('EVENT_NOT_FOUND', `Event ${eventId} has no seat map`);
    }
    return rows.map((row) => ({
      seatId: row.seat_id as string,
      section: row.section as string,
      row: row.row_label as string,
      number: row.seat_number as string,
      category: row.category as string,
    }));
  }
}
