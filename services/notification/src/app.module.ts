import { Module } from '@nestjs/common';
import { createPool } from 'mysql2/promise';
import { TicketFilesClient } from './clients/ticket-files.client';
import { HealthController } from './health.controller';
import { Mailer } from './mail/mailer';
import { EventConsumers } from './notifications/event.consumers';
import { NotificationsService } from './notifications/notifications.service';
import { MYSQL } from './tokens';

/**
 * Notification Worker (feature F5). No public API: it consumes ticket.issued, order.failed
 * and order.cancelled and emails the fan, once per dedup key.
 */
@Module({
  controllers: [HealthController],
  providers: [
    NotificationsService,
    EventConsumers,
    Mailer,
    TicketFilesClient,
    {
      provide: MYSQL,
      useFactory: () =>
        createPool({
          host: process.env.NOTIFICATION_DB_HOST ?? 'notification-db',
          port: Number(process.env.NOTIFICATION_DB_PORT ?? 3306),
          user: process.env.NOTIFICATION_DB_USER ?? 'root',
          password: process.env.NOTIFICATION_DB_PASSWORD ?? '',
          database: process.env.NOTIFICATION_DB_NAME ?? 'notification',
          connectionLimit: Number(process.env.NOTIFICATION_DB_POOL ?? 10),
          timezone: 'Z',
        }),
    },
  ],
})
export class AppModule {}
