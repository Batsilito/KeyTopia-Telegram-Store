import assert from "node:assert/strict";
import test from "node:test";
import {
  createTelegramProductLink,
  createTelegramReferralLink,
  createTelegramShopLink,
  parseTelegramStartPayload,
} from "./telegram-links.ts";

test("shop deep link opens the bot shop directly", () => {
  assert.equal(
    createTelegramShopLink(),
    "https://t.me/KeyTopiaStore_bot?start=shop",
  );
  assert.deepEqual(parseTelegramStartPayload("shop"), {
    openShop: true,
    referralCode: undefined,
  });
});

test("referral deep links keep their referral code payload", () => {
  assert.equal(
    createTelegramReferralLink("KT123"),
    "https://t.me/KeyTopiaStore_bot?start=KT123",
  );
  assert.deepEqual(parseTelegramStartPayload("KT123"), {
    openShop: false,
    referralCode: "KT123",
  });
});

test("product deep links open the bot with the product selected", () => {
  const productId = "00000000-0000-4000-8000-000000000001";
  assert.equal(
    createTelegramProductLink(productId),
    `https://t.me/KeyTopiaStore_bot?start=product_${productId}`,
  );
  assert.deepEqual(parseTelegramStartPayload(`product_${productId}`), {
    openShop: false,
    productId,
    referralCode: undefined,
  });
});