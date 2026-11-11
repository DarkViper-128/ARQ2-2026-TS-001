-- FlashTix catalog-db schema (Wave 2, CAT-1).
-- Loaded by MySQL on first start from /docker-entrypoint-initdb.d.
-- The Catalog Service owns this database; no other service may read it.

CREATE TABLE IF NOT EXISTS venues (
  venue_id CHAR(36)     NOT NULL,
  name     VARCHAR(120) NOT NULL,
  city     VARCHAR(80)  NOT NULL,
  PRIMARY KEY (venue_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS events (
  event_id       CHAR(36)     NOT NULL,
  name           VARCHAR(160) NOT NULL,
  artist         VARCHAR(120) NOT NULL,
  venue_id       CHAR(36)     NOT NULL,
  starts_at      DATETIME(3)  NOT NULL,
  sale_starts_at DATETIME(3)  NOT NULL,
  status         ENUM('DRAFT','PUBLISHED','ON_SALE','SOLD_OUT','CANCELLED') NOT NULL DEFAULT 'DRAFT',
  created_at     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (event_id),
  KEY idx_events_status (status, sale_starts_at),
  CONSTRAINT fk_events_venue FOREIGN KEY (venue_id) REFERENCES venues (venue_id)
) ENGINE=InnoDB;

-- Money is stored in minor units, as agreed in spec.md section 2.
CREATE TABLE IF NOT EXISTS price_categories (
  event_id     CHAR(36)    NOT NULL,
  category     VARCHAR(40) NOT NULL,
  price_amount BIGINT      NOT NULL,
  currency     CHAR(3)     NOT NULL DEFAULT 'COP',
  PRIMARY KEY (event_id, category),
  CONSTRAINT fk_price_event FOREIGN KEY (event_id) REFERENCES events (event_id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- The seat map. Seat STATUS is not here on purpose: availability lives in
-- catalog-cache (Redis) and is kept up to date by the event consumers (CAT-5).
CREATE TABLE IF NOT EXISTS seats (
  event_id    CHAR(36)    NOT NULL,
  seat_id     VARCHAR(20) NOT NULL,
  section     VARCHAR(20) NOT NULL,
  row_label   VARCHAR(10) NOT NULL,
  seat_number VARCHAR(10) NOT NULL,
  category    VARCHAR(40) NOT NULL,
  PRIMARY KEY (event_id, seat_id),
  KEY idx_seats_event_category (event_id, category),
  CONSTRAINT fk_seats_event FOREIGN KEY (event_id) REFERENCES events (event_id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Makes a repeated RabbitMQ delivery harmless (@flashtix/shared: PROCESSED_EVENTS_DDL).
CREATE TABLE IF NOT EXISTS processed_events (
  consumer     VARCHAR(64) NOT NULL,
  event_id     CHAR(36)    NOT NULL,
  processed_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (consumer, event_id)
) ENGINE=InnoDB;
