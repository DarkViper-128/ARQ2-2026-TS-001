import { Body, Controller, HttpCode, Param, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { requireRole } from '@flashtix/nest-support';
import { AdminService } from './admin.service';

/** Event Organizer endpoints (spec.md section 4). The gateway only lets ORGANIZER through. */
@Controller('admin/events')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Post()
  async create(@Req() request: Request, @Res({ passthrough: true }) response: Response, @Body() body: unknown) {
    requireRole(request, 'ORGANIZER');
    const created = await this.admin.createEvent(body);
    response.status(201).setHeader('Location', `/v1/events/${created.eventId}`);
    return created;
  }

  @Post(':eventId/publish')
  @HttpCode(200)
  publish(@Req() request: Request, @Param('eventId') eventId: string) {
    requireRole(request, 'ORGANIZER');
    return this.admin.publish(eventId);
  }
}
