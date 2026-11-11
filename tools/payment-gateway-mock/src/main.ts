import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import {
  AppError,
  CORRELATION_ID_HEADER,
  PROBLEM_CONTENT_TYPE,
  ensureCorrelationId,
  toProblemDetails,
} from '@flashtix/shared';
import { applyConfigPatch, configFromEnv, type MockConfig } from './config';

/**
 * Mock of the legacy payment gateway (Wave 2, INF-5).
 *
 * It exists so the Payment Worker can be built and demoed against something that behaves
 * like the real thing: slow (up to 15 s), sometimes down, and idempotent per order.
 *
 *   POST /payments                 charge, idempotent by `orderId`
 *   POST /payments/{id}/refund     refund a previous charge
 *   GET  /payments/{id}            read a charge
 *   GET  /health                   liveness, always fast
 *   GET  /_mock/config             current behaviour
 *   PUT  /_mock/config             change behaviour live (demo and tests)
 *
 * Force one outcome with the header `X-Mock-Behavior: succeed | decline | error | timeout | slow`.
 */

type Outcome = 'succeed' | 'decline' | 'error' | 'timeout' | 'slow';

interface Payment {
  paymentId: string;
  orderId: string;
  amount: unknown;
  status: 'SUCCEEDED' | 'REFUNDED';
  gatewayReference: string;
  createdAt: string;
}

const PORT = Number(process.env.MOCK_PORT ?? 8080);
let config: MockConfig = configFromEnv();

/** Charges already answered, keyed by orderId: the idempotency key of docs/spec.md. */
const payments = new Map<string, Payment>();

const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

function pickOutcome(forced: string | undefined): Outcome {
  if (forced) {
    const value = forced.toLowerCase();
    if (['succeed', 'decline', 'error', 'timeout', 'slow'].includes(value)) return value as Outcome;
    throw new AppError('VALIDATION_ERROR', `Unknown X-Mock-Behavior "${forced}"`);
  }
  const roll = Math.random();
  if (roll < config.timeoutRate) return 'timeout';
  if (roll < config.timeoutRate + config.errorRate) return 'error';
  if (roll < config.timeoutRate + config.errorRate + config.declineRate) return 'decline';
  return 'succeed';
}

function latencyFor(outcome: Outcome): number {
  if (outcome === 'slow') return config.latencyMaxMs;
  const span = Math.max(0, config.latencyMaxMs - config.latencyMinMs);
  return Math.round(config.latencyMinMs + Math.random() * span);
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
  } catch {
    throw new AppError('VALIDATION_ERROR', 'Body is not valid JSON');
  }
}

function send(response: ServerResponse, status: number, body: unknown, correlationId: string): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': status >= 400 ? PROBLEM_CONTENT_TYPE : 'application/json',
    'content-length': Buffer.byteLength(payload),
    [CORRELATION_ID_HEADER]: correlationId,
  });
  response.end(payload);
}

async function charge(
  request: IncomingMessage,
  response: ServerResponse,
  correlationId: string,
): Promise<void> {
  const body = await readJson(request);
  const orderId = typeof body.orderId === 'string' ? body.orderId : undefined;
  if (!orderId) throw new AppError('VALIDATION_ERROR', 'orderId is required');

  // Idempotency: the same order never gets charged twice, and the replay is instant.
  const existing = payments.get(orderId);
  if (existing) {
    response.setHeader('Idempotent-Replayed', 'true');
    send(response, 200, existing, correlationId);
    return;
  }

  const outcome = pickOutcome(request.headers['x-mock-behavior'] as string | undefined);
  await sleep(latencyFor(outcome));

  if (outcome === 'timeout') {
    // Never answer: the caller must hit its own timeout and retry. The socket is left open.
    return;
  }
  if (outcome === 'error') {
    throw new AppError('SERVICE_UNAVAILABLE', 'Gateway temporarily unavailable');
  }
  if (outcome === 'decline') {
    send(
      response,
      402,
      {
        type: 'https://gateway.legacy/errors/card-declined',
        title: 'Card declined',
        status: 402,
        code: 'CARD_DECLINED',
        detail: 'The issuer rejected the charge.',
        orderId,
        correlationId,
      },
      correlationId,
    );
    return;
  }

  const payment: Payment = {
    paymentId: randomUUID(),
    orderId,
    amount: body.amount ?? null,
    status: 'SUCCEEDED',
    gatewayReference: `LEG-${randomUUID().slice(0, 8).toUpperCase()}`,
    createdAt: new Date().toISOString(),
  };
  payments.set(orderId, payment);
  send(response, 201, payment, correlationId);
}

function refund(paymentId: string, response: ServerResponse, correlationId: string): void {
  const payment = [...payments.values()].find((item) => item.paymentId === paymentId);
  if (!payment) throw new AppError('VALIDATION_ERROR', `Unknown paymentId ${paymentId}`);
  payment.status = 'REFUNDED';
  send(response, 200, payment, correlationId);
}

const server = createServer((request, response) => {
  const correlationId = ensureCorrelationId(request.headers[CORRELATION_ID_HEADER]);
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
  const path = url.pathname;
  const method = request.method ?? 'GET';

  void (async () => {
    try {
      if (method === 'GET' && path === '/health') {
        send(response, 200, { status: 'ok' }, correlationId);
        return;
      }
      if (method === 'GET' && path === '/_mock/config') {
        send(response, 200, config, correlationId);
        return;
      }
      if (method === 'PUT' && path === '/_mock/config') {
        try {
          config = applyConfigPatch(config, await readJson(request));
        } catch (error) {
          throw new AppError('VALIDATION_ERROR', (error as Error).message);
        }
        send(response, 200, config, correlationId);
        return;
      }
      if (method === 'POST' && path === '/payments') {
        await charge(request, response, correlationId);
        return;
      }

      const refundMatch = /^\/payments\/([^/]+)\/refund$/.exec(path);
      if (method === 'POST' && refundMatch) {
        refund(refundMatch[1]!, response, correlationId);
        return;
      }

      const readMatch = /^\/payments\/([^/]+)$/.exec(path);
      if (method === 'GET' && readMatch) {
        const payment = [...payments.values()].find((item) => item.paymentId === readMatch[1]);
        if (!payment) throw new AppError('ORDER_NOT_FOUND', 'Unknown payment');
        send(response, 200, payment, correlationId);
        return;
      }

      throw new AppError('VALIDATION_ERROR', `No route for ${method} ${path}`);
    } catch (error) {
      const problem = toProblemDetails(error, correlationId);
      send(response, problem.status, problem, correlationId);
    }
  })();
});

// Long enough for the slowest simulated charge plus the caller's own timeout.
server.requestTimeout = 0;
server.headersTimeout = 0;

server.listen(PORT, () => {
  console.log(
    JSON.stringify({
      message: 'payment-gateway-mock listening',
      port: PORT,
      config,
    }),
  );
});
