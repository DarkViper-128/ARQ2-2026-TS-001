import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { correlationIdMiddleware } from '@flashtix/shared';
import { ProblemDetailsFilter } from '@flashtix/nest-support';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: false });

  app.setGlobalPrefix('v1');
  app.use(correlationIdMiddleware());
  app.useGlobalFilters(new ProblemDetailsFilter());
  app.enableShutdownHooks();

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port, '0.0.0.0');
  new Logger('bootstrap').log(`ticket service listening on ${port}`);
}

void bootstrap();
