import { Body, Controller, Delete, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { currentUserId } from '@flashtix/nest-support';
import { type CreateHoldBody, parseCreateHold } from './holds.dto';
import { HoldsService } from './holds.service';

@Controller('holds')
export class HoldsController {
  constructor(private readonly holds: HoldsService) {}

  /** RES-2. The API Gateway has already checked the JWT and the FAN role. */
  @Post()
  @HttpCode(201)
  async create(@Req() request: Request, @Body() body: CreateHoldBody) {
    const userId = currentUserId(request);
    const record = await this.holds.createHold(userId, parseCreateHold(body ?? {}));
    return {
      holdId: record.holdId,
      eventId: record.eventId,
      seatIds: record.seatIds,
      status: 'ACTIVE',
      expiresAt: record.expiresAt,
    };
  }

  @Get(':holdId')
  async read(@Req() request: Request, @Param('holdId') holdId: string) {
    currentUserId(request);
    const record = await this.holds.getHold(holdId);
    return {
      holdId: record.holdId,
      eventId: record.eventId,
      seatIds: record.seatIds,
      status: 'ACTIVE',
      expiresAt: record.expiresAt,
    };
  }

  /** RES-3. */
  @Delete(':holdId')
  @HttpCode(204)
  async release(@Req() request: Request, @Param('holdId') holdId: string): Promise<void> {
    await this.holds.releaseHold(currentUserId(request), holdId);
  }
}
