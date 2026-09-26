import { t, type BotLanguage } from "./locales.ts";

export interface OrderDeliveryMessageInput {
  language: BotLanguage;
  deliveryType: "automatic" | "manual";
  productName: string;
  orderNumber: string;
  deliveryInfo: string;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function createOrderDeliveryMessage({
  language,
  deliveryType,
  productName,
  orderNumber,
  deliveryInfo,
}: OrderDeliveryMessageInput) {
  const statusMessage =
    deliveryType === "manual"
      ? t(language, "orderCompleted")
      : t(language, "orderDelivered");
  return [
    `<b>${statusMessage}</b>`,
    "",
    `📦 <b>${t(language, "product")}:</b> ${escapeHtml(productName)}`,
    `🧾 <b>${t(language, "shopOrder")}:</b> <code>${escapeHtml(orderNumber)}</code>`,
    "",
    `<b>${t(language, "deliveryDetails")}:</b>`,
    `<pre>${escapeHtml(deliveryInfo)}</pre>`,
  ].join("\n");
}