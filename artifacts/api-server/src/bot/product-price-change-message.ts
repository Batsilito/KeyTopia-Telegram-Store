export interface ProductPriceChangeMessageInput {
  productName: string;
  oldPriceUsd: string | number;
  newPriceUsd: string | number;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function createProductPriceChangeMessage({
  productName,
  oldPriceUsd,
  newPriceUsd,
}: ProductPriceChangeMessageInput) {
  const oldPrice = Number(oldPriceUsd);
  const newPrice = Number(newPriceUsd);
  if (oldPrice === newPrice) return null;

  const increased = newPrice > oldPrice;
  return [
    `<b>${increased ? "📈 PRICE UPDATE" : "📉 PRICE DECREASE"}</b>`,
    "",
    `📦 <b>Product:</b> ${escapeHtml(productName)}`,
    `💰 <b>Old price:</b> ${oldPrice.toFixed(2)} USDT >>> <b>New price:</b> ${newPrice.toFixed(2)} USDT`,
  ].join("\n");
}