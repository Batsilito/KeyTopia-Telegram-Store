import assert from "node:assert/strict";
import { test } from "node:test";
import { formatUsdCents, parseUsdCents } from "./wallet-adjustment.ts";

test("parses wallet amounts as exact cents", () => {
  assert.equal(parseUsdCents("12"), 1200n);
  assert.equal(parseUsdCents("0.09"), 9n);
  assert.equal(parseUsdCents("-8.4"), -840n);
});

test("rejects amounts with more than two decimal places", () => {
  assert.equal(parseUsdCents("1.005"), null);
  assert.equal(parseUsdCents(Number.NaN), null);
});

test("formats positive and negative cents with two decimal places", () => {
  assert.equal(formatUsdCents(100n), "1.00");
  assert.equal(formatUsdCents(-9n), "-0.09");
  assert.equal(formatUsdCents(0n), "0.00");
});