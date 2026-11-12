-- FlashTix ticket-db schema (Wave 2, Phase 3).
-- Loaded by MySQL on first start from /docker-entrypoint-initdb.d.
-- The Ticket Service owns this database; no other service may read it.

-- One ticket per seat of a confirmed order (spec.md section 3).
CREATE TABLE IF NOT EXISTS tickets (
  ticket_id      CHAR(36)     NOT NULL,
  order_id       CHAR(36)     NOT NULL,
  event_id       CHAR(36)     NOT NULL,
  -- Keycloak `sub` of the fan who bought it: only the holder may read the ticket.
  user_id        VARCHAR(64)  NOT NULL,
  seat_id        VARCHAR(20)  NOT NULL,
  category       VARCHAR(40)  NOT NULL,
  -- FTX1.<ticketId>.<HMAC>, see @flashtix/shared signTicketQr.
  qr_payload     VARCHAR(200) NOT NULL,
  -- Key of the PDF in the S3 bucket (ticket-files).
  pdf_object_key VARCHAR(200) NOT NULL,
  issued_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (ticket_id),
  -- Idempotency of the whole flow: a repeated order.confirmed finds the existing ticket of
  -- each seat instead of creating a second one (spec.md section 5, "Ticket also (orderId, seatId)").
  UNIQUE KEY uq_tickets_order_seat (order_id, seat_id),
  KEY idx_tickets_user (user_id, issued_at)
) ENGINE=InnoDB;

-- Makes a repeated RabbitMQ delivery harmless (@flashtix/shared: PROCESSED_EVENTS_DDL).
CREATE TABLE IF NOT EXISTS processed_events (
  consumer     VARCHAR(64) NOT NULL,
  event_id     CHAR(36)    NOT NULL,
  processed_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (consumer, event_id)
) ENGINE=InnoDB;
