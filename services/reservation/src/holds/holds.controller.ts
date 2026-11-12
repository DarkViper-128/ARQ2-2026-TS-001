import { Body, Controller, Delete, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { currentUserId } from '@flashtix/nest-support';
import { type CreateHoldBody, parseCreateHold } from './holds.dto';
import { type HoldRecord, HoldsService } from './holds.service';

function view(record: HoldRecord) {
  return {
    holdId: record.holdId,
    eventId: record.eventId,
    seatIds: record.seatIds,
    status: record.status,
    expiresAt: new Date(record.expiresAtMs).toISOString(),
  };
}

@Controller('holds')
export class HoldsController {
  constructor(private readonly holds: HoldsService) {}

  /**
   * RES-2. The API Gateway has already checked the JWT and the FAN role; the admission
   * token proves the fan went through the virtual queue (WR-3).
   */
  @Post()
  @HttpCode(201)
  async create(@Req() request: Request, @Body() body: CreateHoldBody) {
    const userId = currentUserId(request);
    const admission = request.headers['x-admission-token'];
    const record = await this.holds.createHold(
      userId,
      parseCreateHold(body ?? {}),
      Array.isArray(admission) ? admission[0] : admission,
    );
    return view(record);
  }

  @Get(':holdId')
  async read(@Req() request: Request, @Param('holdId') holdId: string) {
    currentUserId(request);
    return view(await this.holds.getHold(holdId));
  }

  /** RES-3. */
  @Delete(':holdId')
  @HttpCode(204)
  async release(@Req() request: Request, @Param('holdId') holdId: string): Promise<void> {
    await this.holds.releaseHold(currentUserId(request), holdId);
  }
}
