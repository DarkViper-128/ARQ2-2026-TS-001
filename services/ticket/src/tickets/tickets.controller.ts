import { Controller, Get, Param, Req } from '@nestjs/common';
import type { Request } from 'express';
import { currentUserId } from '@flashtix/nest-support';
import { TicketsService } from './tickets.service';

@Controller('tickets')
export class TicketsController {
  constructor(private readonly tickets: TicketsService) {}

  /** spec.md section 4, `GET /tickets/{ticketId}`. Auth: FAN (holder). */
  @Get(':ticketId')
  read(@Req() request: Request, @Param('ticketId') ticketId: string) {
    return this.tickets.get(ticketId, currentUserId(request));
  }
}
