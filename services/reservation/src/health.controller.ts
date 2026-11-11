import { Controller, Get, Inject } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS } from './tokens';

@Controller('health')
export class HealthController {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  /** Liveness plus the one dependency this service cannot work without. */
  @Get()
  async check() {
    const holdStore = (await this.redis.ping().catch(() => 'DOWN')) === 'PONG' ? 'up' : 'down';
    return { status: holdStore === 'up' ? 'ok' : 'degraded', holdStore };
  }
}
