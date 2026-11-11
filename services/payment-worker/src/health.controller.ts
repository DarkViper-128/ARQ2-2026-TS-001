import { Controller, Get, Inject } from '@nestjs/common';
import type { Pool } from 'mysql2/promise';
import { GatewayClient } from './gateway/gateway.client';
import { MYSQL } from './tokens';

@Controller('health')
export class HealthController {
  constructor(
    @Inject(MYSQL) private readonly pool: Pool,
    private readonly gateway: GatewayClient,
  ) {}

  @Get()
  async check() {
    const database = await this.pool
      .query('SELECT 1')
      .then(() => 'up')
      .catch(() => 'down');
    // The breaker state is reported, not used for health: an open circuit means the
    // legacy gateway is down, and restarting this worker would not fix that.
    return {
      status: database === 'up' ? 'ok' : 'degraded',
      database,
      gatewayCircuit: this.gateway.breaker.current,
    };
  }
}
