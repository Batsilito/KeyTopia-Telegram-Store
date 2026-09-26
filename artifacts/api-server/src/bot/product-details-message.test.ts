import assert from "node:assert/strict";
import test from "node:test";
import { createProductDetailsMessage } from "./product-details-message.ts";

test("product title, price, stock and description render inside a Telegram quote block", () => {
  const message = createProductDetailsMessage({
    language: "en",
    name: "Perplexity Pro 30 Days",
    price: "7.50",
    inStock: true,
    quantity: "48",
    flashSale: false,
    description: "Official renewal with fast delivery.",
    warranty: "Full warranty",
    duration: "30 days",
  });

  assert.match(message, /^🧩 <b>Perplexity Pro 30 Days<\/b>/);
  assert.match(message, /<blockquote>\n❤️ <b>Perplexity Pro 30 Days<\/b>/);
  assert.match(message, /<b>Price:<\/b> 7\.50 USDT/);
  assert.match(message, /<b>Stock:<\/b> 48 available/);
  assert.match(message, /<b>Automatic delivery<\/b>/);
  assert.match(message, /<b>Description<\/b>\nOfficial renewal with fast delivery\./);
  assert.match(message, /<b>Quick Guide<\/b>/);
  assert.match(message, /<\/blockquote>$/);
});

test("product detail content is localized and dynamic HTML is escaped", () => {
  const message = createProductDetailsMessage({
    language: "ar",
    name: "منتج <مميز>",
    price: "7.50",
    inStock: false,
    quantity: "0",
    flashSale: true,
    description: "وصف & تفاصيل",
    warranty: "ضمان",
    duration: "30 يوماً",
  });

  assert.match(message, /منتج &lt;مميز&gt;/);
  assert.match(message, /<b>السعر:<\/b> 7\.50 USDT ⚡ Flash Sale/);
  assert.match(message, /<b>المخزون:<\/b> 0/);
  assert.match(message, /وصف &amp; تفاصيل/);
  assert.match(message, /<blockquote>/);
});