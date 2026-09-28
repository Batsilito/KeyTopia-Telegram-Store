import { t, type BotLanguage } from "./locales.ts";

export interface ProductDetailsMessageInput {
  language: BotLanguage;
  name: string;
  price: string;
  inStock: boolean;
  quantity: string;
  flashSale: boolean;
  description: string;
  warranty: string;
  duration: string;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function createProductDetailsMessage({
  language,
  name,
  price,
  inStock,
  quantity,
  flashSale,
  description,
  warranty,
  duration,
}: ProductDetailsMessageInput) {
  const safeName = escapeHtml(name);
  const priceLine = `💰 <b>${t(language, "price")}:</b> ${escapeHtml(price)} USDT${flashSale ? " ⚡ Flash Sale" : ""}`;
  const stockState = inStock
    ? t(language, "available").toLowerCase()
    : t(language, "outOfStock").toLowerCase();
  const stockLine = `📦 <b>${t(language, "stock")}:</b> ${escapeHtml(quantity)} ${stockState}`;
  const highlightedDetails = [
    `❤️ <b>${safeName}</b>`,
    "",
    priceLine,
    stockLine,
    `⚡ <b>${t(language, "automaticDelivery")}</b>`,
    "",
    `📝 <b>${t(language, "description")}</b>`,
    escapeHtml(description.trim()) || "—",
    "",
    `🛡 <b>${t(language, "warranty")}</b>`,
    escapeHtml(warranty.trim()) || "—",
    "",
    `📌 <b>${t(language, "importantNotes")}</b>`,
    `• ${t(language, "duration")}: ${escapeHtml(duration)}`,
    "",
    `📖 <b>${t(language, "quickGuide")}</b>`,
    t(language, "guideReview"),
    t(language, "guideBuy"),
    t(language, "guidePay"),
    t(language, "guideDelivery"),
    "",
    `📦 ${t(language, "deliveryNotice")}`,
  ].join("\n");

  return [
    `🧩 <b>${safeName}</b>`,
    priceLine,
    stockLine,
    "",
    `<blockquote>\n${highlightedDetails}\n</blockquote>`,
  ].join("\n");
}