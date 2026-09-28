---
name: Database package checks
description: Workspace TypeScript project-reference and Node test-runner quirks for the shared database package.
---

When changing exports in the shared database schema, rebuild its TypeScript project reference before typechecking dependent artifacts (`tsc -b lib/db`); otherwise the dependent typecheck can read stale generated declarations.

**Why:** Node's strip-types test runner cannot resolve the database package's extensionless directory import from its runtime entrypoint, so importing database-backed service modules can fail before a test runs.

**How to apply:** Put calculations and other pure logic in modules that do not import `@workspace/db`, test those modules directly, and build the shared db reference before checking artifact types.