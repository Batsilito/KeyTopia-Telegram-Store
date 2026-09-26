function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function createProductPurchaseBroadcastMessage(input: {
  productName: string;
  quantity: number;
}) {
  return [
    "<b>🎉 NEW PURCHASE</b>",
    "",
    `📦 <b>Product:</b> ${escapeHtml(input.productName)}`,
    `🔢 <b>Quantity:</b> ${input.quantity}`,
  ].join("\n");
}