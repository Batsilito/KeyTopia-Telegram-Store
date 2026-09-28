-- Persist whether supplier-linked products use a manual price or fixed markup.
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS resale_pricing_mode text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS resale_markup_usd numeric(12, 2);