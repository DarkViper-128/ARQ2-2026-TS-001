import { Controller, Get, Inject } from '@nestjs/common';
import type { Pool } from 'mysql2/promise';
import { MYSQL } from './tokens';

@Controller('health')
export class HealthController {
  constructor(@Inject(MYSQL) private readonly pool: Pool) {}

  @Get()
  async check() {
    const database = await this.pool
      .query('SELECT 1')
      .then(() => 'up')
      .catch(() => 'down');
    return { status: database === 'up' ? 'ok' : 'degraded', database };
  }
}
