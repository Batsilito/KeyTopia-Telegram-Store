import { t, type BotLanguage } from "./locales.ts";

export interface OrderPaymentConfirmationMessageInput {
  language: BotLanguage;
  deliveryType: "automatic" | "manual";
  orderNumber: string;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function createOrderPaymentConfirmationMessage({
  language,
  deliveryType,
  orderNumber,
}: OrderPaymentConfirmationMessageInput) {
  const messageKey =
    deliveryType === "manual"
      ? "manualOrderPaymentConfirmed"
      : "orderPaymentConfirmed";

  return t(language, messageKey).replace("{order}", escapeHtml(orderNumber));
}