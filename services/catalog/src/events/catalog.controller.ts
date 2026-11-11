import { Controller, Get, Header, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { CatalogService } from './catalog.service';

/** Public endpoints: no authentication, as stated in spec.md section 4. */
@Controller()
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('events')
  @Header('Cache-Control', 'public, max-age=30')
  async list(@Res({ passthrough: true }) response: Response) {
    const { value, hit } = await this.catalog.listEvents();
    response.setHeader('X-Cache', hit ? 'HIT' : 'MISS');
    return { events: value };
  }

  @Get('events/:eventId')
  @Header('Cache-Control', 'public, max-age=30')
  async detail(@Param('eventId') eventId: string, @Res({ passthrough: true }) response: Response) {
    const { value, hit } = await this.catalog.getEvent(eventId);
    response.setHeader('X-Cache', hit ? 'HIT' : 'MISS');
    return value;
  }

  /** CAT-3. Availability comes from Redis only; MySQL is never asked for seat status. */
  @Get('events/:eventId/seats')
  async seats(@Param('eventId') eventId: string, @Res({ passthrough: true }) response: Response) {
    const { seats, hit, asOf } = await this.catalog.getSeats(eventId);
    response.setHeader('X-Cache', hit ? 'HIT' : 'MISS');
    return {
      eventId,
      asOf,
      available: seats.filter((seat) => seat.status === 'AVAILABLE').length,
      seats,
    };
  }
}
