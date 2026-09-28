-- Reserve limited promo-code uses for active checkouts, then record redemption
-- only when the related order is confirmed.
CREATE TABLE IF NOT EXISTS promo_code_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  promo_code_id uuid NOT NULL,
  checkout_session_id uuid NOT NULL,
  user_id uuid NOT NULL,
  discount_usd numeric(12, 2) NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS promo_code_reservations_checkout_session_idx
  ON promo_code_reservations (checkout_session_id);
CREATE INDEX IF NOT EXISTS promo_code_reservations_promo_user_idx
  ON promo_code_reservations (promo_code_id, user_id);