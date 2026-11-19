-- CocoBot billing schema (MySQL / MariaDB on cPanel).
-- Import this via phpMyAdmin, or let lib.php create it on first run.

CREATE TABLE IF NOT EXISTS customers (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  email        VARCHAR(254) NOT NULL,
  name         VARCHAR(190) NULL,
  created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_customers_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS subscriptions (
  id                     BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  customer_id            BIGINT UNSIGNED NOT NULL,
  provider               ENUM('stripe','razorpay') NOT NULL,
  provider_customer_id   VARCHAR(190) NULL,
  provider_sub_id        VARCHAR(190) NULL,
  plan                   ENUM('starter','personal','pro','max') NOT NULL,
  status                 VARCHAR(32) NOT NULL DEFAULT 'incomplete', -- active|past_due|canceled|incomplete
  amount_minor           INT UNSIGNED NULL,
  currency               CHAR(3) NULL,
  current_period_end     BIGINT UNSIGNED NULL,  -- unix seconds
  cancel_at_period_end   TINYINT(1) NOT NULL DEFAULT 0,
  created_at             TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at             TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_sub_provider (provider, provider_sub_id),
  KEY idx_customer (customer_id),
  CONSTRAINT fk_sub_customer FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Razorpay orders: remembers which tier an order_id was created for, so the
-- client-side checkout callback can activate the right plan after the payment
-- signature is verified. Stripe does not need this (checkout.session carries
-- the tier in client_reference_id / metadata).
CREATE TABLE IF NOT EXISTS orders (
  id                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  provider           ENUM('stripe','razorpay') NOT NULL,
  provider_order_id  VARCHAR(190) NOT NULL,
  tier               ENUM('starter','personal','pro','max') NOT NULL,
  email              VARCHAR(254) NULL,
  amount_minor       INT UNSIGNED NULL,
  currency           CHAR(3) NULL,
  created_at         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_order (provider, provider_order_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS events (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  provider     ENUM('stripe','razorpay') NOT NULL,
  event_id     VARCHAR(190) NOT NULL,   -- idempotency: never process twice
  type         VARCHAR(64) NOT NULL,
  created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_event (provider, event_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;