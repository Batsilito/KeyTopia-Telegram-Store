const VENTEBOT_API_BASE =
  "https://ventetelegrambotrailway-production.up.railway.app/api/reseller";
const DEFAULT_MIN_REQUEST_INTERVAL_MS = 1_100;
const REQUEST_TIMEOUT_MS = 15_000;

export type VenteBotProduct = {
  id: number;
  name: string;
  description: string;
  emoji: string | null;
  imageUrl: string | null;
  priceUsd: number;
  standardPriceUsd: number | null;
  pricingType: string;
  specialPriceExpiresAt: string | null;
  warrantyDays: number;
  deliveryType: string;
  stock: number | null;
  apiTest: boolean;
};

export type VenteBotQuote = {
  productId: number;
  quantity: number;
  unitPriceUsd: number;
  totalUsd: number;
  deliveryType: string;
  stock: number | null;
  walletBalanceUsd: number;
};

export type VenteBotOrderItem = {
  accountData: string;
};

export type VenteBotOrder = {
  id: number;
  status: string;
  productId: number;
  quantity: number;
  amountUsd: number;
  deliveryType: string;
  items: VenteBotOrderItem[];
};

export class VenteBotApiError extends Error {
  readonly statusCode: number;

  constructor(statusCode: number) {
    super(`VenteBot returned HTTP ${statusCode}`);
    this.name = "VenteBotApiError";
    this.statusCode = statusCode;
  }
}

type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

let rateQueue: Promise<void> = Promise.resolve();
let lastRequestStartedAt = 0;

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function waitForRateLimit(minIntervalMs: number) {
  const queued = rateQueue.then(async () => {
    const waitMs = Math.max(
      0,
      lastRequestStartedAt + minIntervalMs - Date.now(),
    );
    if (waitMs > 0) await delay(waitMs);
    lastRequestStartedAt = Date.now();
  });
  rateQueue = queued.catch(() => undefined);
  await queued;
}

function objectValue(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Invalid VenteBot response: ${field}`);
  }
  return value as Record<string, unknown>;
}

function numericValue(value: unknown, field: string): number {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) {
    throw new Error(`Invalid VenteBot response: ${field}`);
  }
  return number;
}

function nullableNumber(value: unknown, field: string): number | null {
  if (value === null || value === undefined) return null;
  const number = numericValue(value, field);
  if (!Number.isInteger(number) || number < 0) {
    throw new Error(`Invalid VenteBot response: ${field}`);
  }
  return number;
}

function nullableString(value: unknown, field: string): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") {
    throw new Error(`Invalid VenteBot response: ${field}`);
  }
  return value;
}

function parseProduct(value: unknown): VenteBotProduct {
  const product = objectValue(value, "product");
  const id = numericValue(product.id, "product.id");
  const warrantyDays = numericValue(product.warranty_days, "product.warranty_days");
  if (!Number.isInteger(id) || id < 1 || !Number.isInteger(warrantyDays)) {
    throw new Error("Invalid VenteBot response: product identifiers");
  }
  if (
    typeof product.name !== "string" ||
    typeof product.description !== "string" ||
    typeof product.delivery_type !== "string" ||
    typeof product.pricing_type !== "string"
  ) {
    throw new Error("Invalid VenteBot response: product fields");
  }
  return {
    id,
    name: product.name,
    description: product.description,
    emoji: nullableString(product.emoji, "product.emoji"),
    imageUrl: nullableString(product.image_url, "product.image_url"),
    priceUsd: numericValue(product.price_usd, "product.price_usd"),
    standardPriceUsd: product.standard_price_usd === null
      ? null
      : numericValue(product.standard_price_usd, "product.standard_price_usd"),
    pricingType: product.pricing_type,
    specialPriceExpiresAt: nullableString(
      product.special_price_expires_at,
      "product.special_price_expires_at",
    ),
    warrantyDays,
    deliveryType: product.delivery_type,
    stock: nullableNumber(product.stock, "product.stock"),
    apiTest: product.api_test === true,
  };
}

function parseOrder(value: unknown): VenteBotOrder {
  const order = objectValue(value, "order");
  const id = numericValue(order.id, "order.id");
  const productId = numericValue(order.product_id, "order.product_id");
  const quantity = numericValue(order.quantity, "order.quantity");
  if (
    !Number.isInteger(id) ||
    !Number.isInteger(productId) ||
    !Number.isInteger(quantity) ||
    quantity < 1 ||
    typeof order.status !== "string" ||
    typeof order.delivery_type !== "string"
  ) {
    throw new Error("Invalid VenteBot response: order fields");
  }
  const items = Array.isArray(order.items) ? order.items.map((rawItem) => {
    const item = objectValue(rawItem, "order item");
    if (typeof item.account_data !== "string") {
      throw new Error("Invalid VenteBot response: order item data");
    }
    return { accountData: item.account_data };
  }) : [];
  return {
    id,
    status: order.status,
    productId,
    quantity,
    amountUsd: numericValue(order.amount_usd, "order.amount_usd"),
    deliveryType: order.delivery_type,
    items,
  };
}

export function createVenteBotClient(
  apiKey: string,
  options: {
    fetchImpl?: FetchLike;
    minRequestIntervalMs?: number;
  } = {},
) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const minRequestIntervalMs =
    options.minRequestIntervalMs ?? DEFAULT_MIN_REQUEST_INTERVAL_MS;

  async function request(
    path: string,
    init: RequestInit = {},
    allowedStatuses: number[] = [],
  ) {
    if (!apiKey.trim()) throw new Error("VenteBot API key is not configured");
    await waitForRateLimit(minRequestIntervalMs);
    const response = await fetchImpl(`${VENTEBOT_API_BASE}${path}`, {
      ...init,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: {
        "X-Reseller-Key": apiKey,
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
    });
    if (!response.ok && !allowedStatuses.includes(response.status)) {
      throw new VenteBotApiError(response.status);
    }
    return response;
  }

  return {
    async getAccount() {
      const response = await request("/me");
      const body = objectValue(await response.json(), "account");
      if (body.success !== true) throw new Error("Invalid VenteBot account response");
      return {
        walletBalanceUsd: numericValue(
          body.wallet_balance,
          "account.wallet_balance",
        ),
      };
    },

    async getProducts(etag?: string | null) {
      const headers = etag ? { "If-None-Match": etag } : undefined;
      const response = await request(
        "/products?lang=en",
        { headers },
        [304],
      );
      const nextEtag = response.headers.get("ETag");
      if (response.status === 304) {
        return { notModified: true as const, etag: nextEtag ?? etag ?? null };
      }
      const body = objectValue(await response.json(), "catalog");
      if (body.success !== true || !Array.isArray(body.products)) {
        throw new Error("Invalid VenteBot catalog response");
      }
      return {
        notModified: false as const,
        etag: nextEtag,
        products: body.products.map(parseProduct),
      };
    },

    async quote(productId: number, quantity: number): Promise<VenteBotQuote> {
      const response = await request("/quote", {
        method: "POST",
        body: JSON.stringify({ product_id: productId, quantity }),
      });
      const body = objectValue(await response.json(), "quote response");
      const quote = objectValue(body.quote, "quote");
      if (body.success !== true) throw new Error("Invalid VenteBot quote response");
      const parsedProductId = numericValue(quote.product_id, "quote.product_id");
      const parsedQuantity = numericValue(quote.quantity, "quote.quantity");
      const deliveryType = quote.delivery_type;
      if (
        parsedProductId !== productId ||
        parsedQuantity !== quantity ||
        typeof deliveryType !== "string"
      ) {
        throw new Error("Invalid VenteBot quote response");
      }
      return {
        productId: parsedProductId,
        quantity: parsedQuantity,
        unitPriceUsd: numericValue(quote.unit_price, "quote.unit_price"),
        totalUsd: numericValue(quote.total, "quote.total"),
        deliveryType,
        stock: nullableNumber(quote.stock, "quote.stock"),
        walletBalanceUsd: numericValue(body.wallet_balance, "quote.wallet_balance"),
      };
    },

    async createOrder(input: {
      productId: number;
      quantity: number;
      customerReference: string;
      idempotencyKey: string;
    }): Promise<VenteBotOrder> {
      const response = await request("/orders", {
        method: "POST",
        body: JSON.stringify({
          product_id: input.productId,
          quantity: input.quantity,
          customer_reference: input.customerReference,
          idempotency_key: input.idempotencyKey,
        }),
      });
      const body = objectValue(await response.json(), "order response");
      if (body.success !== true) throw new Error("Invalid VenteBot order response");
      return parseOrder(body.order);
    },

    async getOrder(orderId: number): Promise<VenteBotOrder> {
      const response = await request(`/orders/${orderId}`);
      const body = objectValue(await response.json(), "order response");
      if (body.success !== true) throw new Error("Invalid VenteBot order response");
      return parseOrder(body.order);
    },
  };
}

export function safeVenteBotErrorMessage(error: unknown): string {
  if (error instanceof VenteBotApiError) {
    if (error.statusCode === 401 || error.statusCode === 403) {
      return "VenteBot authorization failed. Check the reseller key and IP restrictions.";
    }
    if (error.statusCode === 402) {
      return "VenteBot wallet balance is insufficient.";
    }
    if (error.statusCode === 429) {
      return "VenteBot rate limit reached. Retry after the supplier cooldown.";
    }
    if (error.statusCode === 404) {
      return "The VenteBot product or order was not found.";
    }
    return `VenteBot request failed (HTTP ${error.statusCode}).`;
  }
  if (error instanceof Error && error.name === "TimeoutError") {
    return "VenteBot timed out. Retry after the supplier service recovers.";
  }
  return "VenteBot is unreachable or returned an invalid response.";
}