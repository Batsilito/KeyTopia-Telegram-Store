import assert from "node:assert/strict";
import test from "node:test";
import { InlineKeyboard } from "grammy";
import { createProductShopButton, isValidTelegramCustomEmojiId } from "./shop-product-button.ts";

const baseProduct = {
  id: "product-1",
  nameEn: "Canva",
  nameAr: "كانفا",
  price: "1.00",
  quantity: "∞",
  inStock: true,
  outOfStockLabel: "Out of stock",
};

test("custom emoji is a separate button icon before the label, not text", () => {
  const button = createProductShopButton({
    ...baseProduct,
    telegramCustomEmojiId: "5368324170671202286",
  }, "en");

  assert.equal(button.text, "Canva | 1.00 USDT | 📦 ∞");
  assert.equal(button.callback_data, "product:product-1");
  assert.equal(button.icon_custom_emoji_id, "5368324170671202286");
  assert.equal(button.text.includes("5368324170671202286"), false);
  const markup = new InlineKeyboard().add(button).success().row();
  assert.equal(
    markup.inline_keyboard[0][0].icon_custom_emoji_id,
    "5368324170671202286",
  );
  const renderedButton = markup.inline_keyboard[0][0];
  const callbackData =
    "callback_data" in renderedButton ? renderedButton.callback_data : undefined;
  assert.equal(callbackData, "product:product-1");
});

test("missing or malformed emoji IDs produce a normal product button", () => {
  for (const emojiId of [null, "", "invalid-id"]) {
    const button = createProductShopButton({
      ...baseProduct,
      telegramCustomEmojiId: emojiId,
    }, "en");

    assert.deepEqual(button, {
      text: "Canva | 1.00 USDT | 📦 ∞",
      callback_data: "product:product-1",
    });
  }
});

test("legacy Arabic preference still uses English product names and stock labels", () => {
  const finiteStockEn = createProductShopButton({
    ...baseProduct,
    quantity: "1",
  }, "en");
  const finiteStockLegacy = createProductShopButton({
    ...baseProduct,
    quantity: "5",
    telegramCustomEmojiId: "5368324170671202286",
  }, "ar");
  const outOfStockLegacy = createProductShopButton({
    ...baseProduct,
    quantity: "0",
    inStock: false,
    outOfStockLabel: "غير متوفر",
    telegramCustomEmojiId: "5368324170671202286",
  }, "ar");
  const outOfStockEn = createProductShopButton({
    ...baseProduct,
    quantity: "0",
    inStock: false,
    outOfStockLabel: "Out of stock",
  }, "en");

  assert.equal(finiteStockEn.text, "Canva | 1.00 USDT | 📦 1");
  assert.equal(finiteStockLegacy.text, "Canva | 1.00 USDT | 📦 5");
  assert.equal(outOfStockEn.text, "Canva | 1.00 USDT | Out of stock");
  assert.equal(outOfStockLegacy.text, "Canva | 1.00 USDT | Out of stock");
  assert.equal(finiteStockLegacy.icon_custom_emoji_id, "5368324170671202286");
  assert.equal(outOfStockLegacy.icon_custom_emoji_id, "5368324170671202286");
  assert.doesNotMatch(outOfStockLegacy.text, /[\u0600-\u06FF]/);
});

test("IDs must be numeric Telegram custom emoji identifiers", () => {
  assert.equal(isValidTelegramCustomEmojiId("5368324170671202286"), true);
  assert.equal(isValidTelegramCustomEmojiId(""), false);
  assert.equal(isValidTelegramCustomEmojiId("emoji-id"), false);
});