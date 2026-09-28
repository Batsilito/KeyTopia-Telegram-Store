export type VenteBotCatalogAvailability = {
  catalogActive: boolean;
  deliveryType: string;
  stock: number | null;
  apiTest: boolean;
};

export type VenteBotAvailabilityResult = {
  available: boolean;
  quantity: number | null;
  reason:
    | "not_configured"
    | "inactive"
    | "test_product"
    | "activation_required"
    | "unsupported_delivery"
    | "stock_unknown"
    | "out_of_stock"
    | null;
};

export function isValidVenteBotMappingInput(
  productId: string | null,
  resalePriceUsd: number | null,
): boolean {
  if (productId === null) return resalePriceUsd === null;
  return (
    productId.trim().length > 0 &&
    resalePriceUsd !== null &&
    Number.isFinite(resalePriceUsd) &&
    resalePriceUsd >= 0
  );
}

export function getVenteBotAvailability(
  product: VenteBotCatalogAvailability,
  apiKeyConfigured: boolean,
  requestedQuantity = 1,
): VenteBotAvailabilityResult {
  if (!apiKeyConfigured) {
    return { available: false, quantity: 0, reason: "not_configured" };
  }
  if (!product.catalogActive) {
    return { available: false, quantity: 0, reason: "inactive" };
  }
  if (product.apiTest || product.deliveryType === "api_test") {
    return { available: false, quantity: 0, reason: "test_product" };
  }
  if (product.deliveryType === "activation") {
    return { available: false, quantity: 0, reason: "activation_required" };
  }
  if (product.deliveryType === "stock") {
    if (product.stock === null) {
      return { available: false, quantity: null, reason: "stock_unknown" };
    }
    return product.stock >= requestedQuantity
      ? { available: true, quantity: product.stock, reason: null }
      : { available: false, quantity: product.stock, reason: "out_of_stock" };
  }
  if (product.deliveryType === "supplier_api") {
    if (product.stock !== null && product.stock < requestedQuantity) {
      return { available: false, quantity: product.stock, reason: "out_of_stock" };
    }
    // Supplier-managed API products do not have a locally countable stock pool;
    // the purchase-time quote remains the authoritative availability check.
    return { available: true, quantity: product.stock, reason: null };
  }
  return { available: false, quantity: 0, reason: "unsupported_delivery" };
}

export function expectedVenteBotMargin(
  resalePriceUsd: number | string | null | undefined,
  supplierPriceUsd: number | string | null | undefined,
): number | null {
  const resale = Number(resalePriceUsd);
  const supplier = Number(supplierPriceUsd);
  if (
    resalePriceUsd === null ||
    resalePriceUsd === undefined ||
    supplierPriceUsd === null ||
    supplierPriceUsd === undefined ||
    !Number.isFinite(resale) ||
    !Number.isFinite(supplier)
  ) {
    return null;
  }
  return Math.round((resale - supplier + Number.EPSILON) * 100) / 100;
}

export function venteBotIdempotencyKey(orderId: string): string {
  return `keytopia-order-${orderId}`;
}