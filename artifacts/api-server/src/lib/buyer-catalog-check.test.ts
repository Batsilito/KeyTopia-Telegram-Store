import assert from "node:assert/strict";
import test from "node:test";
import { createBuyerCatalogCheck } from "./buyer-catalog-check.ts";

test("shares a supplier refresh and reuses a recent successful check", async () => {
  let time = 1_000;
  let refreshes = 0;
  const check = createBuyerCatalogCheck(
    async () => {
      refreshes += 1;
    },
    () => assert.fail("unexpected refresh failure"),
    { successTtlMs: 30_000, now: () => time },
  );

  assert.deepEqual(await Promise.all([check(), check(), check()]), [
    true, true, true,
  ]);
  assert.equal(refreshes, 1);
  time += 29_999;
  assert.equal(await check(), true);
  assert.equal(refreshes, 1);
  time += 1;
  assert.equal(await check(), true);
  assert.equal(refreshes, 2);
  assert.equal(await check(true), true);
  assert.equal(refreshes, 3);
});

test("hides supplier products on failure and retries after a short interval", async () => {
  let time = 1_000;
  let refreshes = 0;
  const failures: unknown[] = [];
  const check = createBuyerCatalogCheck(
    async () => {
      refreshes += 1;
      if (refreshes === 1) throw new Error("supplier unavailable");
    },
    (error) => failures.push(error),
    { failureTtlMs: 3_000, now: () => time },
  );

  assert.equal(await check(), false);
  assert.equal(failures.length, 1);
  time += 2_999;
  assert.equal(await check(), false);
  assert.equal(refreshes, 1);
  time += 1;
  assert.equal(await check(), true);
  assert.equal(refreshes, 2);
});