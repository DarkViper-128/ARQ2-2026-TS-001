-- FlashTix booking-db schema (Wave 2, ORD-2).
-- Loaded by MySQL on first start from /docker-entrypoint-initdb.d.
-- The Order Service owns this database and it is the source of truth for every sale
-- (spec.md section 1). No other service may read or write it.

-- One row per checkout attempt. The state machine is in spec.md section 3:
--   PENDING -> CONFIRMED | FAILED
--   PENDING | CONFIRMED -> REFUND_PENDING -> CANCELLED
CREATE TABLE IF NOT EXISTS orders (
  order_id        CHAR(36)     NOT NULL,
  -- Keycloak `sub` of the fan (a UUID today; VARCHAR so a provider change cannot break it).
  user_id         VARCHAR(64)  NOT NULL,
  -- Kept because order.confirmed, order.failed and order.cancelled carry it (spec.md section 5).
  user_email      VARCHAR(254) NOT NULL,
  event_id        CHAR(36)     NOT NULL,
  hold_id         CHAR(36)     NOT NULL,
  -- Idempotency-Key header of POST /orders, plus a hash of the request body so the same
  -- key with a different body can be answered with 409 IDEMPOTENCY_KEY_REUSED.
  idempotency_key VARCHAR(64)  NOT NULL,
  request_hash    CHAR(64)     NOT NULL,
  status          ENUM('PENDING','CONFIRMED','FAILED','REFUND_PENDING','CANCELLED') NOT NULL DEFAULT 'PENDING',
  failure_reason  VARCHAR(40)  NULL,
  -- Money in minor units (spec.md section 2).
  total_amount    BIGINT       NOT NULL,
  currency        CHAR(3)      NOT NULL DEFAULT 'COP',
  -- Increases on every state change; copied into aggregateVersion of the events so
  -- consumers can ignore an older event that arrives late (spec.md section 5).
  version         INT          NOT NULL DEFAULT 0,
  created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (order_id),
  -- A retried POST /orders with the same key finds the existing order instead of
  -- creating a second one (double click, client retry after a timeout).
  UNIQUE KEY uq_orders_idempotency (user_id, idempotency_key),
  -- A hold backs at most one order. LockHold already enforces it; this is the database guard.
  UNIQUE KEY uq_orders_hold (hold_id),
  KEY idx_orders_user (user_id, created_at),
  KEY idx_orders_status (status, updated_at)
) ENGINE=InnoDB;

-- Seats of the order with the price charged for each one, so the total can always be
-- explained and a refund knows exactly what was paid.
CREATE TABLE IF NOT EXISTS order_seats (
  order_id     CHAR(36)    NOT NULL,
  seat_id      VARCHAR(20) NOT NULL,
  category     VARCHAR(40) NOT NULL,
  price_amount BIGINT      NOT NULL,
  currency     CHAR(3)     NOT NULL DEFAULT 'COP',
  PRIMARY KEY (order_id, seat_id),
  CONSTRAINT fk_order_seats_order FOREIGN KEY (order_id) REFERENCES orders (order_id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Final safety net against overbooking (ADR 001, ADR 003, spec.md section 3).
-- Written in the same transaction that sets an order to CONFIRMED. If the seat was
-- already sold, the PRIMARY KEY rejects the insert and the saga starts the refund.
CREATE TABLE IF NOT EXISTS sold_seats (
  event_id CHAR(36)    NOT NULL,
  seat_id  VARCHAR(20) NOT NULL,
  order_id CHAR(36)    NOT NULL,
  sold_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (event_id, seat_id),
  KEY idx_sold_seats_order (order_id),
  CONSTRAINT fk_sold_seats_order FOREIGN KEY (order_id) REFERENCES orders (order_id)
) ENGINE=InnoDB;

-- Transactional outbox (ADR 003). Every event of the saga is inserted here in the SAME
-- transaction as the order change, and the relay (ORD-4) publishes it afterwards with
-- publisher confirms. The full envelope is stored, so a re-publish after a crash keeps
-- the same eventId and the consumers can discard the duplicate.
CREATE TABLE IF NOT EXISTS outbox (
  event_id     CHAR(36)    NOT NULL,
  event_type   VARCHAR(50) NOT NULL,
  aggregate_id CHAR(36)    NOT NULL,
  envelope     JSON        NOT NULL,
  created_at   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  published_at DATETIME(3) NULL,
  attempts     INT         NOT NULL DEFAULT 0,
  last_error   VARCHAR(255) NULL,
  PRIMARY KEY (event_id),
  -- The relay reads "oldest unpublished first" with FOR UPDATE SKIP LOCKED.
  KEY idx_outbox_pending (published_at, created_at)
) ENGINE=InnoDB;

-- Makes a repeated RabbitMQ delivery harmless (@flashtix/shared: PROCESSED_EVENTS_DDL).
CREATE TABLE IF NOT EXISTS processed_events (
  consumer     VARCHAR(64) NOT NULL,
  event_id     CHAR(36)    NOT NULL,
  processed_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (consumer, event_id)
) ENGINE=InnoDB;
