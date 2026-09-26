import assert from "node:assert/strict";
import test from "node:test";
import { createChannelBuyNowKeyboard } from "./channel-buy-keyboard.ts";

test("channel buy button is green and opens the matching bot product", () => {
  const markup = createChannelBuyNowKeyboard("00000000-0000-4000-8000-000000000001");
  const button = markup.inline_keyboard[0][0];

  assert.equal(button.text, "Buy now");
  assert.equal(button.style, "success");
  assert.equal(
    "url" in button ? button.url : undefined,
    "https://t.me/KeyTopiaStore_bot?start=product_00000000-0000-4000-8000-000000000001",
  );
});