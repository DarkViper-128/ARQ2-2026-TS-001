import { Module } from '@nestjs/common';
import { EventPublisher } from '@flashtix/shared';
import { createPool } from 'mysql2/promise';
import { CatalogClient } from './clients/catalog.client';
import { ReservationClient } from './clients/reservation.client';
import { HealthController } from './health.controller';
import { AdminOrdersController } from './orders/admin-orders.controller';
import { OrdersController } from './orders/orders.controller';
import { OrdersService } from './orders/orders.service';
import { OutboxRelay } from './outbox/outbox.relay';
import { PaymentConsumers } from './saga/payment.consumers';
import { EVENT_PUBLISHER, MYSQL } from './tokens';

/**
 * Order Service. Owns booking-db, the source of truth for every sale, and orchestrates the
 * checkout saga (ADR 003): POST /orders (ORD-3), outbox relay (ORD-4) and the payment
 * consumers (ORD-5 to ORD-7).
 */
@Module({
  controllers: [OrdersController, AdminOrdersController, HealthController],
  providers: [
    OrdersService,
    OutboxRelay,
    PaymentConsumers,
    ReservationClient,
    CatalogClient,
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
    {
      provide: EVENT_PUBLISHER,
      useFactory: () =>
        EventPublisher.connect({
          url: process.env.RABBITMQ_URL ?? 'amqp://rabbitmq:5672',
          producer: 'order',
        }),
    },
  ],
})
export class AppModule {}
