import assert from "node:assert/strict";
import test from "node:test";
import {
  getRealizedProfitUsd,
  sumKnownUnitCosts,
} from "./profit-accounting.ts";

test("sums per-unit costs without floating-point drift", () => {
  assert.equal(sumKnownUnitCosts(["0.10", "0.20", "1.05"]), "1.35");
});

test("keeps total acquisition cost unknown when any stock cost is missing", () => {
  assert.equal(sumKnownUnitCosts(["2.50", null]), null);
  assert.equal(sumKnownUnitCosts([]), null);
});

test("calculates order profit as revenue minus acquisition cost", () => {
  assert.equal(getRealizedProfitUsd("12.00", "8.25"), 3.75);
  assert.equal(getRealizedProfitUsd("8.25", "12.00"), -3.75);
  assert.equal(getRealizedProfitUsd("12.00", null), null);
});