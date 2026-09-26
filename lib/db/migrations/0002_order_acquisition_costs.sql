-- Add nullable acquisition-cost fields for forward-only profit tracking.
-- Existing stock and orders stay NULL because their historical costs are unknown.
ALTER TABLE inventory_items
  ADD COLUMN IF NOT EXISTS unit_cost_usd numeric(12, 2);

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS acquisition_cost_usd numeric(12, 2);