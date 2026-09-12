---
name: Binance SAPI runtime restriction
description: Why Binance automatic payment verification cannot complete from the current runtime and what safety rule applies.
---

Official Binance.com REST/SAPI hosts currently return HTTP 451 from this Replit runtime. Binance.us public REST is reachable, but the Binance Pay history route used by this app returns HTTP 404 there, and the current credentials are rejected by Binance.us account API requests with -2015. Binance.us is not a drop-in replacement for Binance Pay.

**Why:** Approving from only a buyer-provided transaction ID would permit fraud and transaction reuse. Host failover cannot solve a restriction shared by every official host.

**How to apply:** Keep unverified Binance submissions in review. Only confirm automatically when signed Binance history succeeds and all existing transaction, recipient, amount, currency, type, status, and time checks pass. Use a Binance-supported runtime or provider-supported verification channel for Binance.com, or redesign the flow around an API actually supported by Binance.us. Replit deployment metadata does not expose the selected geography; a development-shell IP is not evidence about production egress, so test from code running in the published API.