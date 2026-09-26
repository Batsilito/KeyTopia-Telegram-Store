import assert from "node:assert/strict";
import test from "node:test";
import {
  createManualStockUnitValue,
  isManualStockUnitValue,
} from "./manual-stock-units.ts";

test("manual stock unit markers are identifiable without exposing unit values", () => {
  const marker = createManualStockUnitValue();

  assert.equal(isManualStockUnitValue(marker), true);
  assert.equal(isManualStockUnitValue("customer-provided-value"), false);
});

test("manual stock unit markers are unique", () => {
  assert.notEqual(createManualStockUnitValue(), createManualStockUnitValue());
});