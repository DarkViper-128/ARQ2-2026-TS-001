import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { correlationIdMiddleware } from '@flashtix/shared';
import { ProblemDetailsFilter } from '@flashtix/nest-support';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: false });

  // POST /admin/events carries the whole seat map (thousands of seats).
  app.useBodyParser('json', { limit: process.env.BODY_LIMIT ?? '5mb' });

  app.setGlobalPrefix('v1');
  app.use(correlationIdMiddleware());
  app.useGlobalFilters(new ProblemDetailsFilter());
  app.enableShutdownHooks();

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port, '0.0.0.0');
  new Logger('bootstrap').log(`catalog service listening on ${port}`);
}

void bootstrap();
