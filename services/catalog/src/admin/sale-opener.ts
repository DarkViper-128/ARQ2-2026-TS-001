import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { AdminService } from './admin.service';

/** Checks every few seconds whether a published event reached its `saleStartsAt`. */
@Injectable()
export class SaleOpener implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SaleOpener.name);
  private timer?: NodeJS.Timeout;

  constructor(private readonly admin: AdminService) {}

  onModuleInit(): void {
    const everyMs = Number(process.env.SALE_OPEN_INTERVAL_MS ?? 5000);
    this.timer = setInterval(() => {
      this.admin.openDueSales().catch((error) => this.logger.error(`sale opener failed: ${String(error)}`));
    }, everyMs);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
