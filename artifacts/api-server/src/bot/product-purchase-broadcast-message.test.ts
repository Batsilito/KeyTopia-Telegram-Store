import assert from "node:assert/strict";
import { test } from "node:test";
import { createProductPurchaseBroadcastMessage } from "./product-purchase-broadcast-message.ts";

test("purchase channel broadcast includes product and quantity without customer details", () => {
  const message = createProductPurchaseBroadcastMessage({
    productName: "Gold <Plan> & Tools",
    quantity: 2,
  });

  assert.match(message, /🎉 NEW PURCHASE/);
  assert.match(message, /Gold &lt;Plan&gt; &amp; Tools/);
  assert.match(message, /Quantity:<\/b> 2/);
  assert.doesNotMatch(message, /customer|order number|email/i);
});