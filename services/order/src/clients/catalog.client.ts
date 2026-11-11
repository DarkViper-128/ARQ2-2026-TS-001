import { Injectable } from '@nestjs/common';
import { AppError, CORRELATION_ID_HEADER, getCorrelationId } from '@flashtix/shared';

export interface PricedSeat {
  seatId: string;
  category: string;
  price: { amount: number; currency: string };
}

interface CatalogEvent {
  priceCategories: { category: string; price: { amount: number; currency: string } }[];
}

interface CatalogSeatMap {
  seats: { seatId: string; category: string }[];
}

/**
 * Prices the seats of an order (ORD-3). The Order Service never trusts a price sent by the
 * client and never reads catalog-db (each service owns its data), so it asks the Catalog
 * Service, which answers from catalog-cache.
 */
@Injectable()
export class CatalogClient {
  private readonly baseUrl = process.env.CATALOG_URL ?? 'http://catalog:3000';
  private readonly timeoutMs = Number(process.env.CATALOG_TIMEOUT_MS ?? 2000);

  private async get<T>(path: string): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        headers: { [CORRELATION_ID_HEADER]: getCorrelationId() ?? '' },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw new AppError('SERVICE_UNAVAILABLE', 'Catalog Service is unreachable');
    }
    if (response.status === 404) throw new AppError('EVENT_NOT_FOUND', 'Event not found in the catalog');
    if (!response.ok) throw new AppError('SERVICE_UNAVAILABLE', `Catalog answered ${response.status}`);
    return (await response.json()) as T;
  }

  async priceSeats(eventId: string, seatIds: string[]): Promise<PricedSeat[]> {
    const id = encodeURIComponent(eventId);
    const [event, seatMap] = await Promise.all([
      this.get<CatalogEvent>(`/v1/events/${id}`),
      this.get<CatalogSeatMap>(`/v1/events/${id}/seats`),
    ]);

    const categoryOf = new Map(seatMap.seats.map((seat) => [seat.seatId, seat.category]));
    const priceOf = new Map(event.priceCategories.map((item) => [item.category, item.price]));

    return seatIds.map((seatId) => {
      const category = categoryOf.get(seatId);
      const price = category ? priceOf.get(category) : undefined;
      if (!category || !price) {
        throw new AppError('VALIDATION_ERROR', `Seat ${seatId} has no price in the catalog`);
      }
      return { seatId, category, price };
    });
  }
}
