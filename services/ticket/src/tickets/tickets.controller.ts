import { Controller, Get, Param, Req } from '@nestjs/common';
import type { Request } from 'express';
import { currentUserId } from '@flashtix/nest-support';
import { TicketsService } from './tickets.service';

@Controller('tickets')
export class TicketsController {
  constructor(private readonly tickets: TicketsService) {}

  /** spec.md section 4, `GET /tickets`. Lists the tickets of the authenticated fan. */
  @Get()
  readAll(@Req() request: Request) {
    return this.tickets.getAll(currentUserId(request));
  }

  /** spec.md section 4, `GET /tickets/{ticketId}`. Auth: FAN (holder). */
  @Get(':ticketId')
  read(@Req() request: Request, @Param('ticketId') ticketId: string) {
    return this.tickets.get(ticketId, currentUserId(request));
  }
}
