/** Prometheus metrics utilities for FlashTix services (Wave 2, Phase 4). */
import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

/**
 * Creates a Prometheus registry with default metrics and custom metrics for FlashTix services.
 * Each service should call this once at startup and expose the `/metrics` endpoint.
 */
export function createMetricsRegistry(serviceName: string): Registry {
  const registry = new Registry();
  registry.setDefaultLabels({ service: serviceName });

  // Collect default Node.js metrics (CPU, memory, event loop, etc.)
  collectDefaultMetrics({ register: registry, prefix: 'nodejs_' });

  return registry;
}

/** Standard HTTP request metrics for all services. */
export const httpRequestsTotal = new Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'path', 'status'],
});

/** HTTP request duration histogram. */
export const httpRequestDurationSeconds = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'path', 'status'],
  buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
});

/** Checkout duration histogram (Order Service). */
export const checkoutDurationSeconds = new Histogram({
  name: 'checkout_duration_seconds',
  help: 'Checkout saga duration in seconds',
  labelNames: ['result'],
  buckets: [0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60],
});

/** Payment gateway call duration histogram. */
export const paymentGatewayDurationSeconds = new Histogram({
  name: 'payment_gateway_duration_seconds',
  help: 'Payment gateway call duration in seconds',
  labelNames: ['result'],
  buckets: [0.5, 1, 2.5, 5, 10, 15, 20, 30, 60],
});

/** Order state counter. */
export const ordersTotal = new Counter({
  name: 'orders_total',
  help: 'Total orders by state',
  labelNames: ['state'],
});

/** Hold state counter. */
export const holdsTotal = new Counter({
  name: 'holds_total',
  help: 'Total holds by state',
  labelNames: ['state'],
});

/** Payment outcome counter. */
export const paymentsTotal = new Counter({
  name: 'payments_total',
  help: 'Total payments by outcome',
  labelNames: ['outcome', 'reason'],
});

/** Refund counter. */
export const refundsTotal = new Counter({
  name: 'refunds_total',
  help: 'Total refunds by reason',
  labelNames: ['reason'],
});

/** Ticket issued counter. */
export const ticketsIssuedTotal = new Counter({
  name: 'tickets_issued_total',
  help: 'Total tickets issued',
  labelNames: ['event'],
});

/** Email sent counter. */
export const emailsSentTotal = new Counter({
  name: 'emails_sent_total',
  help: 'Total emails sent',
  labelNames: ['type'],
});

/** RabbitMQ consumer message counter. */
export const rabbitmqConsumerMessagesTotal = new Counter({
  name: 'rabbitmq_consumer_messages_total',
  help: 'Total messages consumed from RabbitMQ',
  labelNames: ['consumer', 'event_type', 'result'],
});

/** RabbitMQ queue depth gauge. */
export const rabbitmqQueueDepth = new Gauge({
  name: 'rabbitmq_queue_depth',
  help: 'Current message count in RabbitMQ queue',
  labelNames: ['queue'],
});

/** Active hold count gauge. */
export const activeHoldsGauge = new Gauge({
  name: 'active_holds',
  help: 'Current number of active seat holds',
  labelNames: ['event_id'],
});

/** Waiting room queue position gauge. */
export const queuePositionGauge = new Gauge({
  name: 'waiting_room_queue_position',
  help: 'Current queue position for a fan',
  labelNames: ['event_id', 'queue_ticket_id'],
});

/** Circuit breaker state gauge. */
export const circuitBreakerStateGauge = new Gauge({
  name: 'circuit_breaker_state',
  help: 'Circuit breaker state (0=closed, 1=open, 2=half-open)',
  labelNames: ['service'],
});

/** Register all custom metrics with a registry. */
export function registerCustomMetrics(registry: Registry): void {
  registry.registerMetric(httpRequestsTotal);
  registry.registerMetric(httpRequestDurationSeconds);
  registry.registerMetric(checkoutDurationSeconds);
  registry.registerMetric(paymentGatewayDurationSeconds);
  registry.registerMetric(ordersTotal);
  registry.registerMetric(holdsTotal);
  registry.registerMetric(paymentsTotal);
  registry.registerMetric(refundsTotal);
  registry.registerMetric(ticketsIssuedTotal);
  registry.registerMetric(emailsSentTotal);
  registry.registerMetric(rabbitmqConsumerMessagesTotal);
  registry.registerMetric(rabbitmqQueueDepth);
  registry.registerMetric(activeHoldsGauge);
  registry.registerMetric(queuePositionGauge);
  registry.registerMetric(circuitBreakerStateGauge);
}

/** Middleware to record HTTP request metrics. */
export function createMetricsMiddleware() {
  return async (req: any, res: any, next: any) => {
    const start = Date.now();
    const path = req.route?.path ?? req.path ?? 'unknown';

    res.on('finish', () => {
      const duration = (Date.now() - start) / 1000;
      const labels = { method: req.method, path, status: res.statusCode };

      httpRequestsTotal.inc(labels);
      httpRequestDurationSeconds.observe(labels, duration);
    });

    next();
  };
}