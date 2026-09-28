---
name: VenteBot supplier fulfillment
description: Safety rules for retrying supplier purchases and recording customer delivery.
---

Supplier fulfillment must use one stable provider idempotency key per KeyTopia order. Persist the request-start state before calling the provider and reuse that same key after uncertain failures. Mark customer delivery complete only after VenteBot confirms the full set of delivery items.

**Why:** A provider may accept and charge for a request even when KeyTopia times out before recording the response; a new key could create a second supplier purchase, while early delivery confirmation could mislead the customer.

**How to apply:** Preserve the order-to-provider idempotency relationship across retries and restarts. Keep incomplete or ambiguous work visible for admin review; never turn an uncertain provider result into a completed customer order.