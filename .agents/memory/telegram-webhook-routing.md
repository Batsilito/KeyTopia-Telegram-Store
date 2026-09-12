---
name: Telegram webhook routing
description: The published multi-artifact routing requirement for Telegram callbacks
---

The published Telegram webhook must use the API artifact prefix: `/api/telegram/webhook`. The root path belongs to the admin web artifact and can return its SPA HTML with HTTP 200 without delivering the update to the bot.

**Why:** A root webhook URL appeared successful to Telegram because it returned HTTP 200, but it was served by the admin frontend; bot updates were never processed.

**How to apply:** When adding or changing provider callbacks, check the artifact `paths` mapping and verify the published response is handled by the API service, not just that the URL returns 200. Keep a matching API-prefixed route in the Express app.