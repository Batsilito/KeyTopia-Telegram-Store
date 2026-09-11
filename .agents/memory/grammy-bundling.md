---
name: Telegram bot bundling
description: Runtime packaging constraint for the Telegram bot dependency.
---

Keep grammY external to the API esbuild bundle.

**Why:** Bundling grammY into the ESM server produced a runtime `Cannot find
module './platform.node'` failure because the package resolves an optional Node
platform module relative to its installed package.

**How to apply:** If the API build configuration changes, preserve grammY in
the external dependency list and verify the managed API workflow starts before
shipping.