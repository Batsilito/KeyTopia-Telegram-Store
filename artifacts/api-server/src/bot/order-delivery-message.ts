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
  const lines = [
    `<b>${t(language, "orderDelivered")}</b>`,
    "",
    `📦 <b>${t(language, "product")}:</b> ${escapeHtml(productName)}`,
    `🧾 <b>${t(language, "shopOrder")}:</b> <code>${escapeHtml(orderNumber)}</code>`,
    "",
    `<b>${t(language, "deliveryDetails")}:</b>`,
    `<pre>${escapeHtml(deliveryInfo)}</pre>`,
  ];

  if (deliveryType === "manual") {
    lines.push("", t(language, "manualDeliveryContact"));
  }

  return lines.join("\n");
}