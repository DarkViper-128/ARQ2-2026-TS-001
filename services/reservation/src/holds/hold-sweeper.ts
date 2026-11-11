import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { HoldsService } from './holds.service';

/**
 * RES-5. Redis deletes an expired hold silently, so nobody would tell the catalog that the
 * seats are free again. Every few seconds this sweeper finds holds past their expiry and
 * publishes seat.released (reason EXPIRED).
 *
 * Safe with several replicas: the Lua script claims each hold with ZREM, so exactly one
 * replica publishes it.
 */
@Injectable()
export class HoldSweeper implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(HoldSweeper.name);
  private readonly intervalMs = Number(process.env.HOLD_SWEEP_INTERVAL_MS ?? 5000);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(private readonly holds: HoldsService) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
    this.logger.log(`sweeping expired holds every ${this.intervalMs} ms`);
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      // Drain in batches so a burst of expiries is cleared in one tick.
      while ((await this.holds.sweepExpired(100)) === 100) {
        // keep going
      }
    } catch (error) {
      this.logger.error(`sweep failed: ${String(error)}`);
    } finally {
      this.running = false;
    }
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
