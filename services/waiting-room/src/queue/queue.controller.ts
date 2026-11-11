import { Controller, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { currentUserId } from '@flashtix/nest-support';
import { QueueService } from './queue.service';

/** WR-2 and WR-3 (spec.md section 4). The gateway has already validated the JWT. */
@Controller('events/:eventId/queue')
export class QueueController {
  constructor(private readonly queue: QueueService) {}

  @Post()
  @HttpCode(202)
  async join(@Req() request: Request, @Param('eventId') eventId: string) {
    return this.queue.join(eventId, currentUserId(request));
  }

  @Get(':queueTicketId')
  async status(
    @Req() request: Request,
    @Param('eventId') eventId: string,
    @Param('queueTicketId') queueTicketId: string,
  ) {
    return this.queue.status(eventId, queueTicketId, currentUserId(request));
  }
}
