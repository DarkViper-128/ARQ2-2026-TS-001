import { Body, Controller, HttpCode, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { AppError } from '@flashtix/shared';
import { requireRole } from '@flashtix/nest-support';
import { OrdersService } from './orders.service';

/** Refund reasons an organizer may give (refund.requested, spec.md section 5). */
const ORGANIZER_REASONS = ['EVENT_CANCELLED'];

/** Event Organizer endpoint (spec.md section 4). The gateway only lets ORGANIZER through. */
@Controller('admin/orders')
export class AdminOrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Post(':orderId/refund')
  @HttpCode(202)
  refund(@Req() request: Request, @Param('orderId') orderId: string, @Body() body: { reason?: unknown }) {
    requireRole(request, 'ORGANIZER');
    const reason = typeof body?.reason === 'string' ? body.reason : '';
    if (!ORGANIZER_REASONS.includes(reason)) {
      throw new AppError('VALIDATION_ERROR', `reason must be one of: ${ORGANIZER_REASONS.join(', ')}`);
    }
    return this.orders.refund(orderId, reason);
  }
}
