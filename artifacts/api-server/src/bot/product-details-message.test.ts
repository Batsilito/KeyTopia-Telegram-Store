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

test("legacy Arabic preference still gets English labels and escaped product content", () => {
  const message = createProductDetailsMessage({
    language: "ar",
    name: "Special <Product>",
    price: "7.50",
    inStock: false,
    quantity: "0",
    flashSale: true,
    description: "Description & details",
    warranty: "Full warranty",
    duration: "30 days",
  });

  assert.match(message, /Special &lt;Product&gt;/);
  assert.match(message, /<b>Price:<\/b> 7\.50 USDT ⚡ Flash Sale/);
  assert.match(message, /<b>Stock:<\/b> 0 out of stock/);
  assert.match(message, /Description &amp; details/);
  assert.match(message, /<blockquote>/);
  assert.doesNotMatch(message, /[\u0600-\u06FF]/);
});