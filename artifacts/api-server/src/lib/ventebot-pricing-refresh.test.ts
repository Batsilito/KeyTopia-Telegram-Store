import assert from "node:assert/strict";
import test from "node:test";
import { calculateVenteBotResalePriceAfterCostChange } from "./ventebot-rules.ts";

test("manual supplier-linked pricing preserves its current dollar margin", () => {
  assert.equal(
    calculateVenteBotResalePriceAfterCostChange({
      previousSupplierPriceUsd: 8.25,
      supplierPriceUsd: 9.1,
      pricingMode: "manual",
      resalePriceUsd: 10,
      resaleMarkupUsd: null,
    }),
    10.85,
  );
});

test("manual margin can be negative and remains unchanged after a supplier cost update", () => {
  assert.equal(
    calculateVenteBotResalePriceAfterCostChange({
      previousSupplierPriceUsd: 8.25,
      supplierPriceUsd: 8.5,
      pricingMode: "manual",
      resalePriceUsd: 7.5,
      resaleMarkupUsd: null,
    }),
    7.75,
  );
});

test("fixed-markup pricing keeps the configured markup when supplier cost changes", () => {
  assert.equal(
    calculateVenteBotResalePriceAfterCostChange({
      previousSupplierPriceUsd: 8.25,
      supplierPriceUsd: 9.1,
      pricingMode: "fixed_markup",
      resalePriceUsd: 10,
      resaleMarkupUsd: 1.75,
    }),
    10.85,
  );
});

test("manual price cannot become negative or exceed supported precision", () => {
  assert.equal(
    calculateVenteBotResalePriceAfterCostChange({
      previousSupplierPriceUsd: 10,
      supplierPriceUsd: 0,
      pricingMode: "manual",
      resalePriceUsd: 1,
      resaleMarkupUsd: null,
    }),
    null,
  );
});