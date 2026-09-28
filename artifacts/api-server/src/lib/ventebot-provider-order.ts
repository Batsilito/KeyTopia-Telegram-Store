import type { VenteBotOrder } from "./ventebot-client";

export function evaluateVenteBotProviderOrder(order: VenteBotOrder) {
  if (order.status === "COMPLETED") {
    if (
      order.items.length !== order.quantity ||
      order.items.some((item) => !item.accountData.trim())
    ) {
      return {
        kind: "failed" as const,
        error: "VenteBot reported completion without a complete set of delivery items.",
      };
    }
    const deliveryInfo = order.items
      .map((item, index) =>
        order.quantity > 1
          ? `${index + 1}. ${item.accountData.trim()}`
          : item.accountData.trim(),
      )
      .join("\n");
    return { kind: "completed" as const, deliveryInfo };
  }
  if (order.status === "PAID_PENDING_DELIVERY") {
    return { kind: "waiting" as const };
  }
  if (order.status === "AWAITING_ACTIVATION_INFO" || order.status === "AWAITING_ACTIVATION") {
    return {
      kind: "failed" as const,
      error: "VenteBot requires an activation identifier; this product is not enabled for sale.",
    };
  }
  if (order.status === "CANCELLED") {
    return {
      kind: "failed" as const,
      error: "VenteBot cancelled the supplier order. Admin review is required.",
    };
  }
  return {
    kind: "failed" as const,
    error: "VenteBot returned an unsupported order status. Admin review is required.",
  };
}