/**
 * Preload entry point, loaded with `node -r @flashtix/tracing/dist/preload.js dist/main.js`.
 *
 * Why this file exists: `initTracing()` installs OpenTelemetry's module hooks (the
 * patches that make grpc/amqplib/mysql2/ioredis calls generate and propagate spans).
 * Those hooks only affect a module the FIRST time it is `require()`d. Calling
 * `initTracing()` from inside main.ts does not run early enough: TypeScript's compiled
 * `import { AppModule } from './app.module'` is a top-of-file `require()` that pulls in
 * grpc/amqplib/mysql2/ioredis transitively, and ALL of a file's top-level requires run
 * before any of its function-body code - including an `initTracing()` call written
 * above that import. By the time `initTracing()` ran, those modules were already
 * loaded unpatched, so spans never crossed the gRPC and RabbitMQ hops.
 *
 * `node -r` requires this file before main.js is loaded at all, so the hooks are in
 * place before the app's own requires ever run. `serviceName` is intentionally not
 * passed here (unlike the old per-service `initTracing({ serviceName })` calls this
 * file replaces): it is read from OTEL_SERVICE_NAME, set per service in
 * docker-compose.yml, since this file is shared verbatim by all services.
 */
import { initTracing } from './tracing';

initTracing();
