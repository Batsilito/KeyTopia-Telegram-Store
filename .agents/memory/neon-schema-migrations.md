---
name: Store schema database
description: Which database owns the isolated Telegram store schema and how to avoid applying changes to the wrong database.
---

The API and Drizzle configuration use `Neon_Connection` as the primary store database; the separate Replit database may exist but is not the runtime database for this product. The production database also contains payment-monitor tables that are not represented in the Drizzle schema, so `drizzle-kit push` may propose deleting them during an unrelated schema update.

**Why:** Applying a schema change to the wrong database can appear successful while the API continues to read an unchanged schema. Forcing a Drizzle push that proposes deleting unmodeled payment-monitor tables would destroy unrelated data. Drizzle rename prompts also fail in non-interactive workflow shells.

**How to apply:** Confirm the connection priority in the current database configuration before any schema repair. Inspect actual columns, indexes, types, defaults, enum values, and row counts. If Drizzle proposes removing unrelated tables, do not force the push; prepare and test an additive Neon migration on a temporary branch, then get approval before applying it to the shared production branch.