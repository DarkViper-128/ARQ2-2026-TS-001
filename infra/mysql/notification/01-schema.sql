-- FlashTix notification-db schema (Wave 2, Phase 3).
-- Loaded by MySQL on first start from /docker-entrypoint-initdb.d.
-- The Notification Worker owns this database; no other service may read it.

-- Sent log and deduplication in one table (C4: "sent log, dedup keys").
-- dedup_key identifies WHAT is being told to WHOM, for example `ticket.issued:<orderId>`,
-- so a repeated ticket.issued, order.failed or order.cancelled can never send a second email.
CREATE TABLE IF NOT EXISTS notifications (
  dedup_key  VARCHAR(120) NOT NULL,
  channel    ENUM('EMAIL','PUSH') NOT NULL DEFAULT 'EMAIL',
  event_type VARCHAR(50)  NOT NULL,
  order_id   CHAR(36)     NOT NULL,
  recipient  VARCHAR(254) NOT NULL,
  -- PENDING: claimed but the provider has not confirmed yet (a crash or a failed send
  -- leaves it here and the retry sends again). SENT: delivered to the provider.
  status     ENUM('PENDING','SENT') NOT NULL DEFAULT 'PENDING',
  attempts   INT          NOT NULL DEFAULT 0,
  last_error VARCHAR(255) NULL,
  created_at DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  sent_at    DATETIME(3)  NULL,
  PRIMARY KEY (dedup_key, channel),
  KEY idx_notifications_order (order_id)
) ENGINE=InnoDB;

-- Makes a repeated RabbitMQ delivery harmless (@flashtix/shared: PROCESSED_EVENTS_DDL).
CREATE TABLE IF NOT EXISTS processed_events (
  consumer     VARCHAR(64) NOT NULL,
  event_id     CHAR(36)    NOT NULL,
  processed_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (consumer, event_id)
) ENGINE=InnoDB;
