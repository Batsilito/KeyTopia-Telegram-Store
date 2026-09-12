# KeyTopia Telegram Store API

This service is the isolated backend for the KeyTopia Telegram subscription
store. It does not read from or connect to the existing KeyTopia website
database, customers, payments, inventory, or admin accounts.

## Local setup

1. Add the Neon PostgreSQL connection string in Replit Secrets with the exact
   key `Neon_Connection`. The application also accepts `DATABASE_URL` as a
   legacy fallback, but `Neon_Connection` takes priority.
2. Copy `.env.example` values into the Replit development environment. Keep
   `SESSION_SECRET`, `INITIAL_SUPERADMIN_PASSWORD`, `TELEGRAM_BOT_TOKEN`, and
   `TELEGRAM_WEBHOOK_SECRET` in workspace Secrets.
3. Set `INITIAL_SUPERADMIN_EMAIL` and `INITIAL_SUPERADMIN_PASSWORD` before the
   first login. The account is created once, on the first auth request.
4. Apply the schema with:

   ```bash
   pnpm --filter @workspace/db run push
   ```

5. Start the API with the managed `artifacts/api-server: API Server` workflow.

When `TELEGRAM_BOT_TOKEN` is not present, the service remains safe to run:
Telegram polling is disabled and `/telegram/webhook` returns `503`. This is the
expected state until the live bot credentials are added.

## Telegram production setup

For production, set `NODE_ENV=production`, add both Telegram secrets, and
configure the bot webhook to:

```text
POST https://<published-host>/api/telegram/webhook
```

Use the same value from `TELEGRAM_WEBHOOK_SECRET` when calling Telegram's
`setWebhook` API. The service validates
`X-Telegram-Bot-Api-Secret-Token` before passing updates to grammY.

Development polling is disabled by default so a development workflow cannot
steal updates from the published webhook. To explicitly run a separate bot
polling session during development, set `TELEGRAM_DEV_POLLING=true`. Do not run
polling and a production webhook for the same bot at the same time.

## Independent admin access

The admin dashboard uses an HTTP-only, same-site session cookie backed by the
`admin_sessions` table. Passwords are hashed with Node's `scryptSync`; the
Telegram customer accounts are a separate table and cannot log into the
dashboard.

The first Super Admin is created only when both bootstrap environment values
are present. After the first login, rotate or remove the bootstrap password
from the environment and manage future admins through the server-side admin
system.

## Payment policy

The bot supports Binance UID wallet top-ups with automatic polling of the
authenticated account's Binance Pay transaction history. Buyers enter the
transaction ID and exact USDT amount; the API verifies the incoming C2C
transaction against the receiving UID and credits the wallet once. Product checkout payments
and Bybit, Vodafone Cash, and InstaPay payments remain manual review flows.
Telegram Stars, XTR, Telegram invoices, and card checkout are intentionally not
implemented.

For Binance automatic wallet top-ups, add `BINANCE_API_KEY` and
`BINANCE_API_SECRET` as Replit Secrets. The API key should be read-only, have
Pay transaction-history access, and have no withdrawal permission. The enabled
Binance payment method's `paymentIdentifier` must be the receiving Binance UID.

## Deployment checklist

- Set the production `Neon_Connection` secret for the new store database.
- Set `SESSION_SECRET` to a unique random value.
- Set the Super Admin bootstrap email/password, log in once, then remove the
  bootstrap password.
- Add `TELEGRAM_BOT_TOKEN` and `TELEGRAM_WEBHOOK_SECRET` through workspace
  Secrets.
- Set the required channel in Admin → Settings and verify the bot can inspect
  channel membership.
- Configure payment instructions and enabled methods in Admin → Settings.
- Configure the enabled Binance payment method's recipient identifier as the
  receiving Binance UID before testing automatic wallet top-ups.
- Configure the published webhook URL and verify a `/start` update.
- Confirm manual payment review, inventory reservation, delivery, support, and
  audit records in a staging database before opening sales.