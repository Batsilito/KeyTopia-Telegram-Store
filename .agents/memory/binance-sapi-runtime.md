---
name: Binance SAPI runtime restriction
description: Why Binance automatic payment verification cannot complete from the current runtime and what safety rule applies.
---

Official Binance.com REST/SAPI hosts return HTTP 451 from the development runtime, while the published South America deployment successfully reaches all configured Binance.com hosts and receives signed Binance Pay history responses with code 000000. Binance.us public REST is reachable, but the Binance Pay history route used by this app returns HTTP 404 there, and the current credentials are rejected by Binance.us account API requests with -2015. Binance.us is not a drop-in replacement for Binance Pay.

**Why:** Approving from only a buyer-provided transaction ID would permit fraud and transaction reuse. Host failover cannot solve a restriction shared by every official host.

**How to apply:** Keep unverified Binance submissions in review. Only confirm automatically when signed Binance history succeeds and all existing transaction, recipient, amount, currency, type, status, and time checks pass. Use the published South America runtime for Binance.com verification; a development-shell IP is not evidence about production egress. Replit deployment metadata does not expose the selected geography. For Binance.us, redesign the flow around an API it actually supports.

Submitted payments start verification immediately and receive rapid retries for 20 seconds. An exact signed-history match confirms automatically; otherwise the payment becomes an admin-review item. The buyer must receive both the immediate “checking” response and the final automatic or admin decision.

**Why:** Binance records can take a few seconds to appear, so failing the first lookup rejects legitimate transfers. After bounded retries, an admin must be able to resolve a genuine payment that the API did not match.

**How to apply:** Keep the 20-second retry window and show `verification_failed` as “Needs Review.” Admin acceptance is an explicit override that may credit/create an order only once through the global transaction claim. Admin decline must record a reason. Queue buyer result messages transactionally and retry delivery so a Telegram outage cannot lose the decision notice.