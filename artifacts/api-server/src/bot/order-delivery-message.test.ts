import assert from "node:assert/strict";
import test from "node:test";
import { createOrderDeliveryMessage } from "./order-delivery-message.ts";

test("manual delivery message gives the buyer a direct admin contact", () => {
  const message = createOrderDeliveryMessage({
    language: "en",
    deliveryType: "manual",
    productName: "Design Suite",
    orderNumber: "KP-1042",
    deliveryInfo: "Your subscription is ready.",
  });

  assert.match(
    message,
    /Please contact admin <a href="https:\/\/t\.me\/keytopia_support">@keytopia_support<\/a>/,
  );
  assert.match(message, /Your subscription is ready\./);
});

test("automatic delivery message omits the manual contact note and escapes order content", () => {
  const message = createOrderDeliveryMessage({
    language: "en",
    deliveryType: "automatic",
    productName: "Game <Plus>",
    orderNumber: "KP&1042",
    deliveryInfo: "Secret <value>",
  });

  assert.doesNotMatch(message, /keytopia_support/);
  assert.match(message, /Game &lt;Plus&gt;/);
  assert.match(message, /KP&amp;1042/);
  assert.match(message, /Secret &lt;value&gt;/);
});

test("manual delivery contact instruction is localized", () => {
  const message = createOrderDeliveryMessage({
    language: "ar",
    deliveryType: "manual",
    productName: "منتج",
    orderNumber: "KP-1043",
    deliveryInfo: "التسليم جاهز",
  });

  assert.match(message, /يتم تسليم هذا الطلب يدوياً/);
  assert.match(message, /@keytopia_support/);
});