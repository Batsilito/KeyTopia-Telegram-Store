import assert from "node:assert/strict";
import test from "node:test";
import { createProductActionKeyboard } from "./product-action-keyboard.ts";

test("product broadcast action buttons are green and keep their callback", () => {
  const keyboard = createProductActionKeyboard("Buy now", "product:product-1");
  const button = keyboard.inline_keyboard[0][0];

  assert.equal(button.text, "Buy now");
  assert.equal(button.style, "success");
  assert.equal(
    "callback_data" in button ? button.callback_data : undefined,
    "product:product-1",
  );
});