-- FlashTix payment-db schema (Wave 2, PAY-1).
-- Loaded by MySQL on first start from /docker-entrypoint-initdb.d.
-- The Payment Worker owns this database; no other service may read it.

-- One row per order. UNIQUE (order_id) is the idempotency key of the whole payment flow:
-- a redelivered payment.requested finds the existing row instead of charging again, and
-- the same order id is sent to the gateway so the gateway never charges twice either.
CREATE TABLE IF NOT EXISTS payments (
  payment_id         CHAR(36)     NOT NULL,
  order_id           CHAR(36)     NOT NULL,
  user_id            VARCHAR(64)  NOT NULL,
  amount             BIGINT       NOT NULL,
  currency           CHAR(3)      NOT NULL DEFAULT 'COP',
  status             ENUM('REQUESTED','SUCCEEDED','FAILED','REFUNDED') NOT NULL DEFAULT 'REQUESTED',
  -- DECLINED, GATEWAY_TIMEOUT or GATEWAY_UNAVAILABLE (spec.md section 5, payment.failed).
  failure_reason     VARCHAR(40)  NULL,
  -- Calls made to the legacy gateway, retries included.
  attempts           INT          NOT NULL DEFAULT 0,
  -- Id the legacy gateway gave the charge; needed to refund it.
  gateway_payment_id VARCHAR(64)  NULL,
  gateway_reference  VARCHAR(64)  NULL,
  last_error         VARCHAR(255) NULL,
  created_at         DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at         DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (payment_id),
  UNIQUE KEY uq_payments_order (order_id)
) ENGINE=InnoDB;

-- Makes a repeated RabbitMQ delivery harmless (@flashtix/shared: PROCESSED_EVENTS_DDL).
CREATE TABLE IF NOT EXISTS processed_events (
  consumer     VARCHAR(64) NOT NULL,
  event_id     CHAR(36)    NOT NULL,
  processed_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (consumer, event_id)
) ENGINE=InnoDB;
