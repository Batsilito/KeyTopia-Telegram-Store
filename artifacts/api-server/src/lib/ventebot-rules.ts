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

export type VenteBotResalePricingMode = "manual" | "fixed_markup";

const MAX_USD_AMOUNT = 9_999_999_999.99;

function isValidUsdAmount(value: number | null): value is number {
  return (
    value !== null &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= MAX_USD_AMOUNT &&
    Math.abs(value * 100 - Math.round(value * 100)) < 1e-8
  );
}

export function isValidVenteBotResalePricingInput(
  pricingMode: VenteBotResalePricingMode,
  resalePriceUsd: number | null,
  resaleMarkupUsd: number | null,
): boolean {
  if (pricingMode === "manual") {
    return isValidUsdAmount(resalePriceUsd) && resaleMarkupUsd === null;
  }
  return resalePriceUsd === null && isValidUsdAmount(resaleMarkupUsd);
}

export function isValidVenteBotMappingInput(
  productId: string | null,
  pricingMode: VenteBotResalePricingMode,
  resalePriceUsd: number | null,
  resaleMarkupUsd: number | null,
): boolean {
  if (productId === null) {
    return (
      pricingMode === "manual" &&
      resalePriceUsd === null &&
      resaleMarkupUsd === null
    );
  }
  return (
    productId.trim().length > 0 &&
    isValidVenteBotResalePricingInput(
      pricingMode,
      resalePriceUsd,
      resaleMarkupUsd,
    )
  );
}

function usdToCents(value: number | string): number {
  const [whole, cents = "00"] = Number(value).toFixed(2).split(".");
  return Number(whole) * 100 + Number(cents);
}

export function calculateVenteBotResalePrice(
  supplierPriceUsd: number | string,
  pricingMode: VenteBotResalePricingMode,
  resalePriceUsd: number | null,
  resaleMarkupUsd: number | null,
): number | null {
  if (pricingMode === "manual") return resalePriceUsd;
  const supplierPrice = Number(supplierPriceUsd);
  if (
    !isValidUsdAmount(supplierPrice) ||
    !isValidUsdAmount(resaleMarkupUsd)
  ) {
    return null;
  }
  const resalePrice =
    (usdToCents(supplierPrice) + usdToCents(resaleMarkupUsd)) / 100;
  return isValidUsdAmount(resalePrice) ? resalePrice : null;
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