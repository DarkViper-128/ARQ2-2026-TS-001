import { Module } from '@nestjs/common';
import { EventPublisher } from '@flashtix/shared';
import Redis from 'ioredis';
import { HoldsController } from './holds/holds.controller';
import { HoldsService } from './holds/holds.service';
import { HealthController } from './health.controller';
import { EVENT_PUBLISHER, REDIS } from './tokens';

@Module({
  controllers: [HoldsController, HealthController],
  providers: [
    HoldsService,
    {
      provide: REDIS,
      useFactory: () =>
        new Redis(process.env.HOLD_STORE_URL ?? 'redis://hold-store:6379', {
          maxRetriesPerRequest: 3,
          enableReadyCheck: true,
        }),
    },
    {
      provide: EVENT_PUBLISHER,
      useFactory: () =>
        EventPublisher.connect({
          url: process.env.RABBITMQ_URL ?? 'amqp://rabbitmq:5672',
          producer: 'reservation',
        }),
    },
  ],
})
export class AppModule {}
