import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { correlationIdMiddleware } from '@flashtix/shared';
import { createMetricsRegistry, createMetricsMiddleware, registerCustomMetrics } from '@flashtix/shared';
import { ProblemDetailsFilter } from '@flashtix/nest-support';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: false });

  // Prometheus metrics
  const metricsRegistry = createMetricsRegistry('reservation');
  registerCustomMetrics(metricsRegistry);
  app.use(createMetricsMiddleware());

  app.setGlobalPrefix('v1');
  app.use(correlationIdMiddleware());
  app.useGlobalFilters(new ProblemDetailsFilter());
  app.enableShutdownHooks();

  // Metrics endpoint (no global prefix)
  const httpAdapter = app.getHttpAdapter();
  httpAdapter.get('/metrics', async (_req: any, res: any) => {
    try {
      res.set('Content-Type', metricsRegistry.contentType);
      res.send(await metricsRegistry.metrics());
    } catch (err) {
      res.status(500).send(err instanceof Error ? err.message : 'metrics error');
    }
  });

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port, '0.0.0.0');
  new Logger('bootstrap').log(`reservation service listening on ${port}`);
}

void bootstrap();
