import { Injectable } from '@nestjs/common';
import { AppError, CORRELATION_ID_HEADER, getCorrelationId } from '@flashtix/shared';

export interface CatalogEvent {
  eventId: string;
  name: string;
  artist: string;
  venue: { name: string; city: string };
  startsAt: string;
}

/**
 * The ticket shows the name, venue and date of the event, which belong to the Catalog
 * Service. Ticket never reads catalog-db (each service owns its data): it asks the Catalog
 * Service, which answers from catalog-cache. If the catalog is down the error propagates
 * and the event goes through the retry ladder instead of printing a ticket with blanks.
 */
@Injectable()
export class CatalogClient {
  private readonly baseUrl = process.env.CATALOG_URL ?? 'http://catalog:3000';
  private readonly timeoutMs = Number(process.env.CATALOG_TIMEOUT_MS ?? 3000);

  async getEvent(eventId: string): Promise<CatalogEvent> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/v1/events/${encodeURIComponent(eventId)}`, {
        headers: { [CORRELATION_ID_HEADER]: getCorrelationId() ?? '' },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw new AppError('SERVICE_UNAVAILABLE', 'Catalog Service is unreachable');
    }
    if (response.status === 404) throw new AppError('EVENT_NOT_FOUND', `Event ${eventId} does not exist`);
    if (!response.ok) throw new AppError('SERVICE_UNAVAILABLE', `Catalog answered ${response.status}`);
    return (await response.json()) as CatalogEvent;
  }
}
