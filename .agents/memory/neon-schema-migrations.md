---
name: Store schema database
description: Which database owns the isolated Telegram store schema and how to avoid applying changes to the wrong database.
---

The API and Drizzle configuration use `Neon_Connection` as the primary store database; the separate Replit database may exist but is not the runtime database for this product.

**Why:** Applying a schema change to the wrong database can appear successful while the API continues to read an unchanged schema, and a failed Drizzle enum change can leave a partially transformed development schema that needs inspection before retrying.

**How to apply:** Confirm the connection priority in the current database configuration before any development schema repair. For enum changes, inspect the actual column type, default, enum values, and existing data before rerunning Drizzle.