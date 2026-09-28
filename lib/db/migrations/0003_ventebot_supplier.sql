-- VenteBot supplier catalog, checkout snapshots, and durable fulfillment queue.
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS ventebot_product_id integer;

CREATE UNIQUE INDEX IF NOT EXISTS products_ventebot_product_idx
  ON products (ventebot_product_id);

ALTER TABLE checkout_sessions
  ADD COLUMN IF NOT EXISTS ventebot_product_id integer;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS ventebot_product_id integer;

CREATE TABLE IF NOT EXISTS ventebot_catalog_products (
  id integer PRIMARY KEY,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  emoji text,
  image_url text,
  price_usd numeric(12, 2) NOT NULL,
  standard_price_usd numeric(12, 2),
  pricing_type text NOT NULL,
  special_price_expires_at text,
  warranty_days integer NOT NULL,
  delivery_type text NOT NULL,
  stock integer,
  api_test boolean NOT NULL DEFAULT false,
  catalog_active boolean NOT NULL DEFAULT true,
  last_synced_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE ventebot_catalog_products
  ADD COLUMN IF NOT EXISTS name text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS description text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS emoji text,
  ADD COLUMN IF NOT EXISTS image_url text,
  ADD COLUMN IF NOT EXISTS price_usd numeric(12, 2),
  ADD COLUMN IF NOT EXISTS standard_price_usd numeric(12, 2),
  ADD COLUMN IF NOT EXISTS pricing_type text NOT NULL DEFAULT 'fixed',
  ADD COLUMN IF NOT EXISTS special_price_expires_at text,
  ADD COLUMN IF NOT EXISTS warranty_days integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS delivery_type text NOT NULL DEFAULT 'stock',
  ADD COLUMN IF NOT EXISTS stock integer,
  ADD COLUMN IF NOT EXISTS api_test boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS catalog_active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS last_synced_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE TABLE IF NOT EXISTS ventebot_catalog_sync_state (
  id integer PRIMARY KEY DEFAULT 1,
  etag text,
  last_synced_at timestamptz,
  last_connection_check_at timestamptz,
  last_connection_status text NOT NULL DEFAULT 'untested',
  last_connection_error text,
  wallet_balance_usd numeric(12, 2),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE ventebot_catalog_sync_state
  ADD COLUMN IF NOT EXISTS etag text,
  ADD COLUMN IF NOT EXISTS last_synced_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_connection_check_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_connection_status text NOT NULL DEFAULT 'untested',
  ADD COLUMN IF NOT EXISTS last_connection_error text,
  ADD COLUMN IF NOT EXISTS wallet_balance_usd numeric(12, 2),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE TABLE IF NOT EXISTS ventebot_order_fulfillments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL,
  ventebot_product_id integer NOT NULL,
  idempotency_key text NOT NULL,
  ventebot_order_id integer,
  status text NOT NULL DEFAULT 'pending',
  provider_status text,
  acquisition_cost_usd numeric(12, 2),
  quote_total_usd numeric(12, 2),
  quoted_at timestamptz,
  order_request_started_at timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

ALTER TABLE ventebot_order_fulfillments
  ADD COLUMN IF NOT EXISTS order_id uuid,
  ADD COLUMN IF NOT EXISTS ventebot_product_id integer,
  ADD COLUMN IF NOT EXISTS idempotency_key text,
  ADD COLUMN IF NOT EXISTS ventebot_order_id integer,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS provider_status text,
  ADD COLUMN IF NOT EXISTS acquisition_cost_usd numeric(12, 2),
  ADD COLUMN IF NOT EXISTS quote_total_usd numeric(12, 2),
  ADD COLUMN IF NOT EXISTS quoted_at timestamptz,
  ADD COLUMN IF NOT EXISTS order_request_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_error text,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS completed_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS ventebot_order_fulfillments_order_idx
  ON ventebot_order_fulfillments (order_id);

CREATE UNIQUE INDEX IF NOT EXISTS ventebot_order_fulfillments_idempotency_idx
  ON ventebot_order_fulfillments (idempotency_key);

CREATE UNIQUE INDEX IF NOT EXISTS ventebot_order_fulfillments_provider_order_idx
  ON ventebot_order_fulfillments (ventebot_order_id);

CREATE INDEX IF NOT EXISTS ventebot_order_fulfillments_due_idx
  ON ventebot_order_fulfillments (status, next_attempt_at, created_at);