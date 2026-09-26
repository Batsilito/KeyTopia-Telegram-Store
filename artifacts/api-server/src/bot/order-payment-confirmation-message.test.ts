import assert from "node:assert/strict";
import test from "node:test";
import { createOrderPaymentConfirmationMessage } from "./order-payment-confirmation-message.ts";

test("manual payment confirmation directs the customer to the admin with the order number", () => {
  const message = createOrderPaymentConfirmationMessage({
    language: "en",
    deliveryType: "manual",
    orderNumber: "KP-1042",
  });

  assert.match(message, /manual order <code>KP-1042<\/code>/);
  assert.match(
    message,
    /contact <a href="https:\/\/t\.me\/keytopia_admin">@keytopia_admin<\/a> and include your order number/,
  );
});

test("manual payment confirmation is localized and escapes the order number", () => {
  const message = createOrderPaymentConfirmationMessage({
    language: "ar",
    deliveryType: "manual",
    orderNumber: "KP<&1042",
  });

  assert.match(message, /تم تأكيد الدفع للطلب اليدوي <code>KP&lt;&amp;1042<\/code>/);
  assert.match(message, /@keytopia_admin/);
});

test("automatic payment confirmation keeps its existing processing message", () => {
  const message = createOrderPaymentConfirmationMessage({
    language: "en",
    deliveryType: "automatic",
    orderNumber: "KP-1042",
  });

  assert.match(message, /Payment confirmed for order KP-1042/);
  assert.doesNotMatch(message, /keytopia_admin/);
});