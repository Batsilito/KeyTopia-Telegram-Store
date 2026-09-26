import assert from "node:assert/strict";
import test from "node:test";
import { createProductPriceChangeMessage } from "./product-price-change-message.ts";

test("price increase message shows the old and new prices", () => {
  const message = createProductPriceChangeMessage({
    productName: "Pro subscription",
    oldPriceUsd: "9.50",
    newPriceUsd: "12",
  });

  assert.ok(message);
  assert.match(message, /PRICE UPDATE/);
  assert.match(message, /Old price:<\/b> 9\.50 USDT >>> <b>New price:<\/b> 12\.00 USDT/);
});

test("price decrease message shows the old and new prices", () => {
  const message = createProductPriceChangeMessage({
    productName: "Pro subscription",
    oldPriceUsd: "12",
    newPriceUsd: "9.5",
  });

  assert.ok(message);
  assert.match(message, /PRICE DECREASE/);
  assert.match(message, /Old price:<\/b> 12\.00 USDT >>> <b>New price:<\/b> 9\.50 USDT/);
});

test("unchanged price does not create a notification", () => {
  assert.equal(
    createProductPriceChangeMessage({
      productName: "Pro subscription",
      oldPriceUsd: "9.50",
      newPriceUsd: 9.5,
    }),
    null,
  );
});

test("product names are escaped for Telegram HTML", () => {
  const message = createProductPriceChangeMessage({
    productName: "<Pro & Plus>",
    oldPriceUsd: 9,
    newPriceUsd: 10,
  });

  assert.ok(message);
  assert.match(message, /&lt;Pro &amp; Plus&gt;/);
});