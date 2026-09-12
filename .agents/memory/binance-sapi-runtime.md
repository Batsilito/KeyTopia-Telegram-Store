---
name: Binance SAPI runtime restriction
description: Why Binance automatic payment verification cannot complete from the current runtime and what safety rule applies.
---

All official Binance REST/SAPI hosts currently return HTTP 451 from this Replit runtime. This is a network-location restriction, not a missing transaction match or a normal API-key permission error.

**Why:** Approving from only a buyer-provided transaction ID would permit fraud and transaction reuse. Host failover cannot solve a restriction shared by every official host.

**How to apply:** Keep unverified Binance submissions in review. Only confirm automatically when signed Binance history succeeds and all existing transaction, recipient, amount, currency, type, status, and time checks pass. Use a Binance-supported runtime or provider-supported verification channel to remove the restriction.