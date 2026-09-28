import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateVenteBotResalePrice,
  expectedVenteBotMargin,
  getVenteBotAvailability,
  isValidVenteBotMappingInput,
  isValidVenteBotResalePricingInput,
  venteBotIdempotencyKey,
} from "./ventebot-rules.ts";

test("supplier stock availability follows the delivery type", () => {
  assert.deepEqual(
    getVenteBotAvailability({
      catalogActive: true,
      deliveryType: "stock",
      stock: 0,
      apiTest: false,
    }, true),
    { available: false, quantity: 0, reason: "out_of_stock" },
  );
  assert.equal(
    getVenteBotAvailability({
      catalogActive: true,
      deliveryType: "stock",
      stock: null,
      apiTest: false,
    }, true).reason,
    "stock_unknown",
  );
  assert.equal(
    getVenteBotAvailability({
      catalogActive: true,
      deliveryType: "supplier_api",
      stock: null,
      apiTest: false,
    }, true).available,
    true,
  );
  assert.equal(
    getVenteBotAvailability({
      catalogActive: true,
      deliveryType: "activation",
      stock: null,
      apiTest: false,
    }, true).reason,
    "activation_required",
  );
  assert.equal(
    getVenteBotAvailability({
      catalogActive: true,
      deliveryType: "api_test",
      stock: 5,
      apiTest: true,
    }, true).reason,
    "test_product",
  );
  assert.equal(
    getVenteBotAvailability({
      catalogActive: true,
      deliveryType: "stock",
      stock: 5,
      apiTest: false,
    }, false).reason,
    "not_configured",
  );
});

test("resale margin is independently calculated from supplier cost", () => {
  assert.equal(expectedVenteBotMargin("12.50", "8.25"), 4.25);
  assert.equal(expectedVenteBotMargin(7, 8), -1);
  assert.equal(expectedVenteBotMargin(null, 8), null);
});

test("supplier mapping requires a valid product and pricing strategy", () => {
  assert.equal(
    isValidVenteBotMappingInput("local-product-1", "manual", 9.5, null),
    true,
  );
  assert.equal(
    isValidVenteBotMappingInput("local-product-1", "fixed_markup", null, 1.5),
    true,
  );
  assert.equal(isValidVenteBotMappingInput(null, "manual", null, null), true);
  assert.equal(
    isValidVenteBotMappingInput("local-product-1", "manual", null, null),
    false,
  );
  assert.equal(
    isValidVenteBotMappingInput("local-product-1", "fixed_markup", 9.5, 1.5),
    false,
  );
  assert.equal(
    isValidVenteBotMappingInput(null, "manual", 9.5, null),
    false,
  );
  assert.equal(
    isValidVenteBotMappingInput("local-product-1", "manual", -1, null),
    false,
  );
});

test("fixed resale markup uses exact cents while manual pricing stays independent", () => {
  assert.equal(
    calculateVenteBotResalePrice("8.25", "fixed_markup", null, 1.75),
    10,
  );
  assert.equal(
    calculateVenteBotResalePrice("0.10", "fixed_markup", null, 0.2),
    0.3,
  );
  assert.equal(
    calculateVenteBotResalePrice("8.25", "manual", 9.5, null),
    9.5,
  );
  assert.equal(
    calculateVenteBotResalePrice("-0.01", "fixed_markup", null, 1),
    null,
  );
  assert.equal(
    calculateVenteBotResalePrice("9999999999.99", "fixed_markup", null, 0.01),
    null,
  );
  assert.equal(
    isValidVenteBotResalePricingInput("fixed_markup", null, 0),
    true,
  );
  assert.equal(
    isValidVenteBotResalePricingInput("fixed_markup", null, -0.01),
    false,
  );
  assert.equal(
    isValidVenteBotResalePricingInput("manual", 9.5, 1),
    false,
  );
});

test("the same KeyTopia order always gets the same provider idempotency key", () => {
  assert.equal(
    venteBotIdempotencyKey("order-123"),
    venteBotIdempotencyKey("order-123"),
  );
  assert.notEqual(
    venteBotIdempotencyKey("order-123"),
    venteBotIdempotencyKey("order-456"),
  );
});