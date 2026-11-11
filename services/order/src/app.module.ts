import { Module } from '@nestjs/common';
import { createPool } from 'mysql2/promise';
import { HealthController } from './health.controller';
import { MYSQL } from './tokens';

/**
 * Order Service (ORD-1). Owns booking-db, the source of truth for every sale.
 * The checkout endpoints (ORD-3), the outbox relay (ORD-4) and the saga consumers
 * (ORD-5 to ORD-7) are added on top of this module.
 */
@Module({
  controllers: [HealthController],
  providers: [
    {
      provide: MYSQL,
      useFactory: () =>
        createPool({
          host: process.env.BOOKING_DB_HOST ?? 'booking-db',
          port: Number(process.env.BOOKING_DB_PORT ?? 3306),
          user: process.env.BOOKING_DB_USER ?? 'root',
          password: process.env.BOOKING_DB_PASSWORD ?? '',
          database: process.env.BOOKING_DB_NAME ?? 'booking',
          connectionLimit: Number(process.env.BOOKING_DB_POOL ?? 10),
          timezone: 'Z',
        }),
    },
  ],
})
export class AppModule {}
