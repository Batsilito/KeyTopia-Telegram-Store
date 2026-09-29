---
name: VenteBot catalog health
description: Distinguish reseller-account connectivity from successful product-catalog synchronization.
---

The supplier account check and product-catalog sync are independent provider operations. A successful account check does not guarantee that the catalog endpoint is available or that products were imported. Keep these health signals distinct.

For mapped resale products, every successful supplier-cost update must also update manual resale prices by the same cost delta so their current dollar margin is preserved. Buyer-facing linked-product prices and stock must be verified at browsing and payment checkpoints; if verification fails, hide or pause the item, and require renewed buyer confirmation when the amount changes.

Routine browsing may reuse a recent successful supplier catalog check for a short, bounded window, but it must re-read current mapped product prices after the check, including cache hits. An explicit refresh bypasses the window. Checkout and payment still require a live quote and renewed buyer confirmation if the amount changes.

**Why:** The account check succeeded while catalog synchronization failed and left the imported catalog empty. Per-tap supplier refreshes are rate-limited and delayed shop navigation, but an in-memory catalog window must never make a stale displayed price authoritative at checkout.

**How to apply:** After configuring the reseller key, verify both the account check and catalog refresh. Confirm the last-sync timestamp and imported-product count rather than treating account connectivity alone as proof that supplier products are usable. Keep supplier listings fail-closed when the check fails, re-read mapped prices on each view, and apply live checks before checkout, payment, and fulfillment.