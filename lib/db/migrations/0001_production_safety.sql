-- Additive, production-safe integrity and query-performance migration.
-- Foreign keys are NOT VALID so existing production rows are not rewritten or
-- rejected; PostgreSQL still enforces them for all new writes.
CREATE TABLE IF NOT EXISTS order_reward_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL,
  reward_type text NOT NULL CHECK (reward_type IN ('cashback', 'referral_reward')),
  wallet_transaction_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS order_reward_claims_order_reward_idx
  ON order_reward_claims (order_id, reward_type);
CREATE UNIQUE INDEX IF NOT EXISTS inventory_items_value_hash_idx
  ON inventory_items (value_hash);
CREATE UNIQUE INDEX IF NOT EXISTS inventory_reservations_active_item_idx
  ON inventory_reservations (inventory_item_id) WHERE released_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS payments_checkout_session_idx
  ON payments (checkout_session_id);
CREATE UNIQUE INDEX IF NOT EXISTS orders_checkout_session_idx
  ON orders (checkout_session_id) WHERE checkout_session_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS referrals_referred_user_idx
  ON referrals (referred_user_id);
CREATE INDEX IF NOT EXISTS checkout_sessions_expiry_idx
  ON checkout_sessions (status, expires_at);
CREATE INDEX IF NOT EXISTS inventory_items_product_status_idx
  ON inventory_items (product_id, status, created_at);
CREATE INDEX IF NOT EXISTS payments_status_created_idx
  ON payments (status, created_at);
CREATE INDEX IF NOT EXISTS orders_user_created_idx
  ON orders (user_id, created_at DESC);

ALTER TABLE order_reward_claims
  ADD CONSTRAINT order_reward_claims_order_fk FOREIGN KEY (order_id)
  REFERENCES orders(id) ON DELETE RESTRICT NOT VALID;
ALTER TABLE order_reward_claims
  ADD CONSTRAINT order_reward_claims_wallet_transaction_fk FOREIGN KEY (wallet_transaction_id)
  REFERENCES wallet_transactions(id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED NOT VALID;
