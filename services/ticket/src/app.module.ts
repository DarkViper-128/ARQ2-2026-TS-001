import { Module } from '@nestjs/common';
import { EventPublisher } from '@flashtix/shared';
import { createPool } from 'mysql2/promise';
import { CatalogClient } from './clients/catalog.client';
import { HealthController } from './health.controller';
import { TicketStorage } from './storage/ticket-storage';
import { OrderConsumers } from './tickets/order.consumers';
import { TicketsController } from './tickets/tickets.controller';
import { TicketsService } from './tickets/tickets.service';
import { EVENT_PUBLISHER, MYSQL } from './tokens';

/**
 * Ticket Service (feature F5). Consumes order.confirmed, issues one PDF + QR ticket per
 * seat, stores the PDF in S3 and publishes ticket.issued. Its only API is
 * `GET /tickets/{ticketId}`.
 */
@Module({
  controllers: [TicketsController, HealthController],
  providers: [
    TicketsService,
    OrderConsumers,
    CatalogClient,
    TicketStorage,
    {
      provide: MYSQL,
      useFactory: () =>
        createPool({
          host: process.env.TICKET_DB_HOST ?? 'ticket-db',
          port: Number(process.env.TICKET_DB_PORT ?? 3306),
          user: process.env.TICKET_DB_USER ?? 'root',
          password: process.env.TICKET_DB_PASSWORD ?? '',
          database: process.env.TICKET_DB_NAME ?? 'ticket',
          connectionLimit: Number(process.env.TICKET_DB_POOL ?? 10),
          timezone: 'Z',
        }),
    },
    {
      provide: EVENT_PUBLISHER,
      useFactory: () =>
        EventPublisher.connect({
          url: process.env.RABBITMQ_URL ?? 'amqp://rabbitmq:5672',
          producer: 'ticket',
        }),
    },
  ],
})
export class AppModule {}
