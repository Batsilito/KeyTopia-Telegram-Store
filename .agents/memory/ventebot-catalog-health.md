---
name: VenteBot catalog health
description: Distinguish reseller-account connectivity from successful product-catalog synchronization.
---

The supplier account check and product-catalog sync are independent provider operations. A successful account check does not guarantee that the catalog endpoint is available or that products were imported. Keep these health signals distinct.

**Why:** The account check succeeded while catalog synchronization failed and left the imported catalog empty.

**How to apply:** After configuring the reseller key, verify both the account check and catalog refresh. Confirm the last-sync timestamp and imported-product count rather than treating account connectivity alone as proof that supplier products are usable.