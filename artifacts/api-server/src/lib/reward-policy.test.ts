import assert from "node:assert/strict";
import test from "node:test";
import { calculatePercentageAmount, rewardsAreEligible } from "./reward-policy.ts";

test("only delivered orders qualify for rewards", () => {
  assert.equal(rewardsAreEligible("paid"), false);
  assert.equal(rewardsAreEligible("processing"), false);
  assert.equal(rewardsAreEligible("cancelled"), false);
  assert.equal(rewardsAreEligible("delivered"), true);
});

test("cashback uses exact decimal arithmetic and rounds to cents", () => {
  assert.equal(calculatePercentageAmount("19.99", "2.50"), "0.50");
  assert.equal(calculatePercentageAmount("0.10", "5"), "0.01");
  assert.equal(calculatePercentageAmount("100.00", "0"), "0.00");
  assert.equal(calculatePercentageAmount("invalid", "10"), "0.00");
});
