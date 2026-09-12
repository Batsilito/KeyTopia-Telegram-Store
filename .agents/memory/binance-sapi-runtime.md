---
name: Binance SAPI runtime restriction
description: Why Binance automatic payment verification cannot complete from the current runtime and what safety rule applies.
---

Official Binance.com REST/SAPI hosts return HTTP 451 from the development runtime, while the published South America deployment successfully reaches all configured Binance.com hosts and receives signed Binance Pay history responses with code 000000. Binance.us public REST is reachable, but the Binance Pay history route used by this app returns HTTP 404 there, and the current credentials are rejected by Binance.us account API requests with -2015. Binance.us is not a drop-in replacement for Binance Pay.

**Why:** Approving from only a buyer-provided transaction ID would permit fraud and transaction reuse. Host failover cannot solve a restriction shared by every official host.

**How to apply:** Keep unverified Binance submissions in review. Only confirm automatically when signed Binance history succeeds and all existing transaction, recipient, amount, currency, type, status, and time checks pass. Use the published South America runtime for Binance.com verification; a development-shell IP is not evidence about production egress. Replit deployment metadata does not expose the selected geography. For Binance.us, redesign the flow around an API it actually supports.

Submitted payments receive a five-minute visibility grace period. After that, a successful verifier/history lookup with no exact match is persisted as `verification_failed`, with no wallet credit or order creation.

**Why:** Binance records can appear shortly after the customer submits an ID, but silently retaining an old mismatch makes the admin queue ambiguous and gives buyers no resolution.

**How to apply:** Keep the grace period when changing polling or verifier logic. Failure notifications should be emitted only when the pending record transitions to `verification_failed`, so retries do not duplicate buyer/admin alerts.