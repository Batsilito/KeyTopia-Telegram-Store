import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateCheckoutPromoPricing,
  calculatePromoDiscountCents,
  formatUsdCents,
} from "./promo-pricing.ts";

test("calculates percentage discounts in cents", () => {
  assert.equal(
    calculatePromoDiscountCents({
      subtotalUsd: "15.99",
      discountType: "percentage",
      value: "10",
    }),
    160,
  );
});

test("caps fixed discounts so the checkout remains payable", () => {
  const discount = calculatePromoDiscountCents({
    subtotalUsd: "5.00",
    discountType: "fixed_usd",
    value: "20",
  });
  assert.equal(discount, 499);
  assert.deepEqual(calculateCheckoutPromoPricing("5.00", formatUsdCents(discount)), {
    subtotalUsd: "5.00",
    discountUsd: "4.99",
    totalUsd: "0.01",
  });
});

test("rejects invalid percentage values and zero-value discounts", () => {
  assert.equal(
    calculatePromoDiscountCents({
      subtotalUsd: "10.00",
      discountType: "percentage",
      value: "150",
    }),
    0,
  );
  assert.equal(
    calculatePromoDiscountCents({
      subtotalUsd: "10.00",
      discountType: "fixed_usd",
      value: "0",
    }),
    0,
  );
});

test("preserves a one-cent checkout amount after a full percentage discount", () => {
  assert.deepEqual(
    calculateCheckoutPromoPricing(
      "1.00",
      formatUsdCents(
        calculatePromoDiscountCents({
          subtotalUsd: "1.00",
          discountType: "percentage",
          value: 100,
        }),
      ),
    ),
    {
      subtotalUsd: "1.00",
      discountUsd: "0.99",
      totalUsd: "0.01",
    },
  );
});