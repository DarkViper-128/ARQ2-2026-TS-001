import { Module } from '@nestjs/common';
import Redis from 'ioredis';
import { HealthController } from './health.controller';
import { CatalogClient } from './queue/catalog.client';
import { QueueController } from './queue/queue.controller';
import { QueueService } from './queue/queue.service';
import { REDIS } from './tokens';

/** Waiting Room Service (WR-1). The queue lives in hold-store, next to the holds (ADR 001). */
@Module({
  controllers: [QueueController, HealthController],
  providers: [
    QueueService,
    CatalogClient,
    {
      provide: REDIS,
      useFactory: () =>
        new Redis(process.env.HOLD_STORE_URL ?? 'redis://hold-store:6379', {
          maxRetriesPerRequest: 3,
        }),
    },
  ],
})
export class AppModule {}
