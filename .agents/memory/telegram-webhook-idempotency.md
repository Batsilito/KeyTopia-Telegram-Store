---
name: Telegram webhook idempotency
description: How duplicate payment submissions can make Telegram redeliver an update and appear to freeze the bot.
---

Telegram retries webhook updates when the handler returns HTTP 500. Payment submission handlers must treat deterministic duplicate transaction-ID conflicts as an acknowledged outcome, reply safely, and return HTTP 200.

**Why:** A unique transaction claim can already exist from an earlier failed verification or from a prior delivery of the same Telegram update. Throwing on that conflict causes Telegram to redeliver the update repeatedly, which can delay later bot interactions.

**How to apply:** Pre-check submitted transaction IDs and catch the database unique-violation race. Do not create a second wallet credit or order; clear the in-memory draft and tell the customer the transaction was already submitted.