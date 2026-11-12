import { Body, Controller, Get, HttpCode, Param, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AppError } from '@flashtix/shared';
import { currentUserEmail, currentUserId, currentUserRoles } from '@flashtix/nest-support';
import { OrdersService } from './orders.service';

interface CreateOrderBody {
  holdId?: unknown;
  paymentMethodToken?: unknown;
}

function header(request: Request, name: string): string {
  const value = request.headers[name];
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? '';
}

function sseFormat(event: string, data: object): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  /** ORD-3. spec.md section 4, `POST /orders`. */
  @Post()
  @HttpCode(202)
  async create(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Body() body: CreateOrderBody,
  ) {
    const holdId = typeof body?.holdId === 'string' ? body.holdId.trim() : '';
    const paymentMethodToken =
      typeof body?.paymentMethodToken === 'string' ? body.paymentMethodToken.trim() : '';
    if (!holdId) throw new AppError('VALIDATION_ERROR', 'holdId is required');
    if (!paymentMethodToken || paymentMethodToken.length > 255) {
      throw new AppError('VALIDATION_ERROR', 'paymentMethodToken is required (max 255 characters)');
    }

    const result = await this.orders.create({
      userId: currentUserId(request),
      userEmail: currentUserEmail(request),
      idempotencyKey: header(request, 'idempotency-key'),
      holdId,
      paymentMethodToken,
    });

    response.setHeader('Location', result.body.statusUrl);
    if (result.replayed) response.setHeader('Idempotent-Replayed', 'true');
    return result.body;
  }

  @Get(':orderId')
  async read(@Req() request: Request, @Param('orderId') orderId: string) {
    return this.orders.get(orderId, currentUserId(request), currentUserRoles(request).includes('ORGANIZER'));
  }

  /**
   * SSE endpoint: GET /orders/{orderId}/events
   * Streams live order status updates (spec.md section 4, F4).
   * Auth: FAN (owner) or ORGANIZER.
   */
  @Get(':orderId/events')
  async events(@Req() request: Request, @Param('orderId') orderId: string, @Res() response: Response) {
    const userId = currentUserId(request);
    const isOrganizer = currentUserRoles(request).includes('ORGANIZER');

    // Set SSE headers
    response.setHeader('Content-Type', 'text/event-stream');
    response.setHeader('Cache-Control', 'no-cache');
    response.setHeader('Connection', 'keep-alive');
    response.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering
    response.flushHeaders();

    // Send initial connection event
    response.write(sseFormat('connected', { orderId }));

    const clientClosed = () => {
      response.end();
    };
    request.on('close', clientClosed);

    try {
      for await (const update of this.orders.subscribeToOrderEvents(orderId, userId, isOrganizer)) {
        if (response.writableEnded) break;
        response.write(sseFormat(update.event, update.data));
      }
    } finally {
      request.off('close', clientClosed);
      if (!response.writableEnded) {
        response.end();
      }
    }
  }
}
