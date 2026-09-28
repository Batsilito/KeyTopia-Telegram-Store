import assert from "node:assert/strict";
import test from "node:test";
import { createOrderDeliveryMessage } from "./order-delivery-message.ts";

test("manual delivery completion confirms the order and includes the delivered product", () => {
  const message = createOrderDeliveryMessage({
    language: "en",
    deliveryType: "manual",
    productName: "Design Suite",
    orderNumber: "KP-1042",
    deliveryInfo: "Your subscription is ready.",
  });

  assert.match(message, /Your order is completed/);
  assert.match(message, /Design Suite/);
  assert.match(message, /KP-1042/);
  assert.match(message, /Your subscription is ready\./);
  assert.doesNotMatch(message, /keytopia_(support|admin)/);
});

test("automatic delivery keeps its delivered status and escapes order content", () => {
  const message = createOrderDeliveryMessage({
    language: "en",
    deliveryType: "automatic",
    productName: "Game <Plus>",
    orderNumber: "KP&1042",
    deliveryInfo: "Secret <value>",
  });

  assert.match(message, /Your order has been delivered/);
  assert.match(message, /Game &lt;Plus&gt;/);
  assert.match(message, /KP&amp;1042/);
  assert.match(message, /Secret &lt;value&gt;/);
});

test("legacy Arabic preference still gets English delivery notifications", () => {
  const message = createOrderDeliveryMessage({
    language: "ar",
    deliveryType: "manual",
    productName: "Product",
    orderNumber: "KP-1043",
    deliveryInfo: "Delivery is ready",
  });

  assert.match(message, /Your order is completed/);
  assert.match(message, /<b>Product:<\/b> Product/);
  assert.match(message, /Delivery is ready/);
  assert.doesNotMatch(message, /[\u0600-\u06FF]/);
});