---
name: VenteBot catalog health
description: Distinguish reseller-account connectivity from successful product-catalog synchronization.
---

The supplier account check and product-catalog sync are independent provider operations. A successful account check does not guarantee that the catalog endpoint is available or that products were imported. Keep these health signals distinct.

For mapped resale products, every successful supplier-cost update must also update manual resale prices by the same cost delta so their current dollar margin is preserved. Buyer-facing linked-product prices and stock must be verified at browsing and payment checkpoints; if verification fails, hide or pause the item, and require renewed buyer confirmation when the amount changes.

**Why:** The account check succeeded while catalog synchronization failed and left the imported catalog empty. A stale cached price can also lead to charging an amount the buyer did not just confirm.

**How to apply:** After configuring the reseller key, verify both the account check and catalog refresh. Confirm the last-sync timestamp and imported-product count rather than treating account connectivity alone as proof that supplier products are usable. Apply buyer-facing checks before checkout, payment, and fulfillment.