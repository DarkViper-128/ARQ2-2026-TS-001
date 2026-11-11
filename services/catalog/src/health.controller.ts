import { Controller, Get, Inject } from '@nestjs/common';
import type Redis from 'ioredis';
import type { Pool } from 'mysql2/promise';
import { MYSQL, REDIS } from './tokens';

@Controller('health')
export class HealthController {
  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(MYSQL) private readonly pool: Pool,
  ) {}

  @Get()
  async check() {
    const cache = (await this.redis.ping().catch(() => 'DOWN')) === 'PONG' ? 'up' : 'down';
    const database = await this.pool
      .query('SELECT 1')
      .then(() => 'up')
      .catch(() => 'down');
    return { status: cache === 'up' && database === 'up' ? 'ok' : 'degraded', cache, database };
  }
}
