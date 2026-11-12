import { Module } from '@nestjs/common';
import { EventPublisher } from '@flashtix/shared';
import { createPool } from 'mysql2/promise';
import { GatewayClient } from './gateway/gateway.client';
import { HealthController } from './health.controller';
import { PaymentConsumers } from './payments/payment.consumers';
import { PaymentsService } from './payments/payments.service';
import { EVENT_PUBLISHER, MYSQL } from './tokens';

/** Payment Worker (PAY-1 to PAY-5). No public API: it only consumes and publishes events. */
@Module({
  controllers: [HealthController],
  providers: [
    PaymentsService,
    PaymentConsumers,
    GatewayClient,
    {
      provide: MYSQL,
      useFactory: () =>
        createPool({
          host: process.env.PAYMENT_DB_HOST ?? 'payment-db',
          port: Number(process.env.PAYMENT_DB_PORT ?? 3306),
          user: process.env.PAYMENT_DB_USER ?? 'root',
          password: process.env.PAYMENT_DB_PASSWORD ?? '',
          database: process.env.PAYMENT_DB_NAME ?? 'payment',
          connectionLimit: Number(process.env.PAYMENT_DB_POOL ?? 10),
          timezone: 'Z',
        }),
    },
    {
      provide: EVENT_PUBLISHER,
      useFactory: () =>
        EventPublisher.connect({
          url: process.env.RABBITMQ_URL ?? 'amqp://rabbitmq:5672',
          producer: 'payment-worker',
        }),
    },
  ],
})
export class AppModule {}
