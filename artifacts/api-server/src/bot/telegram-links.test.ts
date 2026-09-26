import assert from "node:assert/strict";
import test from "node:test";
import {
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