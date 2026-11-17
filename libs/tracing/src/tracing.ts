/**
 * OpenTelemetry tracing setup with Jaeger exporter for FlashTix services.
 *
 * Usage in each service main.ts:
 *
 *   import { initTracing } from '@flashtix/tracing';
 *   initTracing({ serviceName: 'catalog' });
 *
 * Reads OTEL_EXPORTER_JAEGER_ENDPOINT from env (default: http://jaeger:14268/api/traces)
 * and OTEL_SERVICE_NAME from env if serviceName is not passed.
 */
import {
  NodeSDK,
} from '@opentelemetry/sdk-node';
import {
  getNodeAutoInstrumentations,
} from '@opentelemetry/auto-instrumentations-node';
import { JaegerExporter } from '@opentelemetry/exporter-jaeger';
import { Resource } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';
import { trace, context, propagation } from '@opentelemetry/api';

export interface TracingOptions {
  serviceName?: string;
  jaegerEndpoint?: string;
  /** Disable console exporter in production. Default: true in production. */
  disableConsole?: boolean;
}

let sdk: NodeSDK | undefined;

/** Initialize OpenTelemetry SDK with Jaeger exporter. Returns the SDK instance. */
export function initTracing(options: TracingOptions = {}): NodeSDK {
  if (sdk) {
    return sdk;
  }

  const serviceName =
    options.serviceName ?? process.env.OTEL_SERVICE_NAME ?? 'flashtix-service';
  const jaegerEndpoint =
    options.jaegerEndpoint ??
    process.env.OTEL_EXPORTER_JAEGER_ENDPOINT ??
    'http://jaeger:14268/api/traces';

  const isProduction = process.env.NODE_ENV === 'production';
  const disableConsole = options.disableConsole ?? isProduction;

  const jaegerExporter = new JaegerExporter({
    endpoint: jaegerEndpoint,
  });

  const exporters = [jaegerExporter];
  if (!disableConsole) {
    const { ConsoleSpanExporter } = require('@opentelemetry/sdk-trace-base');
    exporters.push(new ConsoleSpanExporter());
  }

  sdk = new NodeSDK({
    resource: new Resource({
      [SemanticResourceAttributes.SERVICE_NAME]: serviceName,
      [SemanticResourceAttributes.SERVICE_VERSION]: process.env.npm_package_version ?? '0.1.0',
      [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]:
        process.env.NODE_ENV ?? 'development',
    }),
    traceExporter: jaegerExporter,
    instrumentations: [
      getNodeAutoInstrumentations({
        // Enable key instrumentations for FlashTix services:
        // HTTP (incoming/outgoing requests), Express, amqplib (RabbitMQ),
        // mysql2, ioredis (Redis) are auto-detected when their packages are loaded.
        '@opentelemetry/instrumentation-http': {
          enabled: true,
        },
        '@opentelemetry/instrumentation-express': {
          enabled: true,
        },
        '@opentelemetry/instrumentation-amqplib': {
          enabled: true,
        },
        '@opentelemetry/instrumentation-mysql2': {
          enabled: true,
        },
        '@opentelemetry/instrumentation-ioredis': {
          enabled: true,
        },
      }),
    ],
  });

  sdk.start();
  return sdk;
}

/** Shutdown the OpenTelemetry SDK gracefully. */
export async function shutdownTracing(): Promise<void> {
  if (sdk) {
    await sdk.shutdown();
    sdk = undefined;
  }
}

/** Get a tracer by name. */
export function getTracer(name: string) {
  return trace.getTracer(name);
}

/** Get the propagation API (for injecting context into RabbitMQ message headers). */
export function getPropagation() {
  return propagation;
}

/** Get the context API. */
export function getContext() {
  return context;
}

export { trace, context, propagation };
