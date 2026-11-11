import { Injectable } from '@nestjs/common';
import { AppError, CORRELATION_ID_HEADER, getCorrelationId } from '@flashtix/shared';

export interface CatalogEvent {
  eventId: string;
  status: string;
  saleStartsAt: string;
}

/**
 * WR-5. Reads the event from the Catalog Service (internal network, never through the
 * gateway). Catalog answers from catalog-cache, so this costs one Redis read on its side.
 */
@Injectable()
export class CatalogClient {
  private readonly baseUrl = process.env.CATALOG_URL ?? 'http://catalog:3000';
  private readonly timeoutMs = Number(process.env.CATALOG_TIMEOUT_MS ?? 2000);

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
