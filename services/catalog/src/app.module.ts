import { Module } from '@nestjs/common';
import Redis from 'ioredis';
import { createPool } from 'mysql2/promise';
import { AdminController } from './admin/admin.controller';
import { AdminService } from './admin/admin.service';
import { SaleOpener } from './admin/sale-opener';
import { AvailabilityConsumers } from './consumers/availability.consumers';
import { CatalogController } from './events/catalog.controller';
import { CatalogRepository } from './events/catalog.repository';
import { CatalogService } from './events/catalog.service';
import { HealthController } from './health.controller';
import { MYSQL, REDIS } from './tokens';

@Module({
  controllers: [CatalogController, AdminController, HealthController],
  providers: [
    AdminService,
    SaleOpener,
    CatalogService,
    CatalogRepository,
    AvailabilityConsumers,
    {
      provide: REDIS,
      useFactory: () =>
        new Redis(process.env.CATALOG_CACHE_URL ?? 'redis://catalog-cache:6379', {
          maxRetriesPerRequest: 3,
        }),
    },
    {
      provide: MYSQL,
      useFactory: () =>
        createPool({
          host: process.env.CATALOG_DB_HOST ?? 'catalog-db',
          port: Number(process.env.CATALOG_DB_PORT ?? 3306),
          user: process.env.CATALOG_DB_USER ?? 'root',
          password: process.env.CATALOG_DB_PASSWORD ?? '',
          database: process.env.CATALOG_DB_NAME ?? 'catalog',
          connectionLimit: Number(process.env.CATALOG_DB_POOL ?? 10),
          timezone: 'Z',
        }),
    },
  ],
})
export class AppModule {}
