import { and, count, desc, eq, gt, inArray, lte, sql } from "drizzle-orm";
import {
  db,
  checkoutSessions,
  flashSales,
  products,
  ventebotCatalogProducts,
  ventebotCatalogSyncState,
} from "@workspace/db";
import {
  createVenteBotClient,
  safeVenteBotErrorMessage,
  type VenteBotQuote,
} from "./ventebot-client";
import {
  calculateVenteBotResalePriceAfterCostChange,
  isValidVenteBotResalePricingInput,
} from "./ventebot-rules";

export type VenteBotCatalogRefreshResult = {
  notModified: boolean;
  lastSyncedAt: string | null;
  supplierProductCount: number;
};

async function updateConnectionState(input: {
  status: "not_configured" | "connected" | "error";
  checkedAt?: Date;
  error?: string | null;
}) {
  const now = new Date();
  const values = {
    id: 1,
    lastConnectionStatus: input.status,
    lastConnectionError: input.error ?? null,
    ...(input.checkedAt ? { lastConnectionCheckAt: input.checkedAt } : {}),
    updatedAt: now,
  };
  await db
    .insert(ventebotCatalogSyncState)
    .values(values)
    .onConflictDoUpdate({
      target: ventebotCatalogSyncState.id,
      set: {
        lastConnectionStatus: values.lastConnectionStatus,
        lastConnectionError: values.lastConnectionError,
        ...(values.lastConnectionCheckAt
          ? { lastConnectionCheckAt: values.lastConnectionCheckAt }
          : {}),
        updatedAt: values.updatedAt,
      },
    });
}

export async function refreshVenteBotCatalog(): Promise<VenteBotCatalogRefreshResult> {
  const apiKey = process.env.VENTEBOT_RESELLER_KEY?.trim();
  if (!apiKey) {
    const error = new Error("VenteBot reseller API key is not configured");
    await updateConnectionState({ status: "not_configured", error: error.message });
    throw error;
  }

  const stateRows = await db
    .select()
    .from(ventebotCatalogSyncState)
    .where(eq(ventebotCatalogSyncState.id, 1))
    .limit(1);
  const currentState = stateRows[0];
  const syncedAt = new Date();

  try {
    const client = createVenteBotClient(apiKey);
    const catalog = await client.getProducts(currentState?.etag);
    if (catalog.notModified) {
      const activeCountRows = await db
        .select({ value: count() })
        .from(ventebotCatalogProducts)
        .where(eq(ventebotCatalogProducts.catalogActive, true));
      if (currentState) {
        await db
          .update(ventebotCatalogSyncState)
          .set({
            etag: catalog.etag ?? currentState.etag,
            lastConnectionCheckAt: syncedAt,
            lastConnectionStatus: "connected",
            lastConnectionError: null,
            updatedAt: syncedAt,
          })
          .where(eq(ventebotCatalogSyncState.id, 1));
      } else {
        await updateConnectionState({
          status: "connected",
          checkedAt: syncedAt,
          error: null,
        });
      }
      return {
        notModified: true,
        lastSyncedAt: currentState?.lastSyncedAt?.toISOString() ?? null,
        supplierProductCount: Number(activeCountRows[0]?.value ?? 0),
      };
    }

    await db.transaction(async (tx) => {
      const supplierProductIds = catalog.products.map((product) => product.id);
      const previousCatalogRows = supplierProductIds.length
        ? await tx
            .select({
              id: ventebotCatalogProducts.id,
              priceUsd: ventebotCatalogProducts.priceUsd,
            })
            .from(ventebotCatalogProducts)
            .where(inArray(ventebotCatalogProducts.id, supplierProductIds))
        : [];
      const previousSupplierPriceById = new Map(
        previousCatalogRows.map((row) => [row.id, row.priceUsd]),
      );

      await tx
        .update(ventebotCatalogProducts)
        .set({ catalogActive: false, updatedAt: syncedAt });

      if (catalog.products.length) {
        await tx
          .insert(ventebotCatalogProducts)
          .values(
            catalog.products.map((product) => ({
              id: product.id,
              name: product.name,
              description: product.description,
              emoji: product.emoji,
              imageUrl: product.imageUrl,
              priceUsd: product.priceUsd.toFixed(2),
              standardPriceUsd: product.standardPriceUsd?.toFixed(2) ?? null,
              pricingType: product.pricingType,
              specialPriceExpiresAt: product.specialPriceExpiresAt,
              warrantyDays: product.warrantyDays,
              deliveryType: product.deliveryType,
              stock: product.stock,
              apiTest: product.apiTest,
              catalogActive: true,
              lastSyncedAt: syncedAt,
              updatedAt: syncedAt,
            })),
          )
          .onConflictDoUpdate({
            target: ventebotCatalogProducts.id,
            set: {
              name: sql`excluded.name`,
              description: sql`excluded.description`,
              emoji: sql`excluded.emoji`,
              imageUrl: sql`excluded.image_url`,
              priceUsd: sql`excluded.price_usd`,
              standardPriceUsd: sql`excluded.standard_price_usd`,
              pricingType: sql`excluded.pricing_type`,
              specialPriceExpiresAt: sql`excluded.special_price_expires_at`,
              warrantyDays: sql`excluded.warranty_days`,
              deliveryType: sql`excluded.delivery_type`,
              stock: sql`excluded.stock`,
              apiTest: sql`excluded.api_test`,
              catalogActive: true,
              lastSyncedAt: syncedAt,
              updatedAt: syncedAt,
            },
          });

        const mappedProducts = await tx
          .select({
            id: products.id,
            supplierProductId: products.ventebotProductId,
            priceUsd: products.priceUsd,
            resalePricingMode: products.resalePricingMode,
            resaleMarkupUsd: products.resaleMarkupUsd,
          })
          .from(products)
          .where(inArray(products.ventebotProductId, supplierProductIds))
          .for("update");
        const supplierPriceById = new Map(
          catalog.products.map((product) => [
            product.id,
            product.priceUsd.toFixed(2),
          ]),
        );

        for (const product of mappedProducts) {
          const supplierProductId = product.supplierProductId;
          if (supplierProductId === null) continue;
          const pricingMode =
            product.resalePricingMode === "fixed_markup"
              ? "fixed_markup"
              : product.resalePricingMode === "manual"
                ? "manual"
                : null;
          if (pricingMode === null) {
            await tx
              .update(products)
              .set({ active: false, updatedAt: syncedAt })
              .where(eq(products.id, product.id));
            continue;
          }
          const supplierPriceUsd = supplierPriceById.get(supplierProductId);
          if (supplierPriceUsd === undefined) continue;
          const previousSupplierPriceUsd =
            previousSupplierPriceById.get(supplierProductId) ?? null;
          const nextResalePriceUsd =
            pricingMode === "manual" && previousSupplierPriceUsd === null
              ? Number(product.priceUsd)
              : calculateVenteBotResalePriceAfterCostChange({
                  previousSupplierPriceUsd,
                  supplierPriceUsd,
                  pricingMode,
                  resalePriceUsd: product.priceUsd,
                  resaleMarkupUsd: product.resaleMarkupUsd,
                });
          if (
            nextResalePriceUsd === null ||
            !isValidVenteBotResalePricingInput(
              "manual",
              nextResalePriceUsd,
              null,
            )
          ) {
            await tx
              .update(products)
              .set({ active: false, updatedAt: syncedAt })
              .where(eq(products.id, product.id));
            continue;
          }
          if (Number(product.priceUsd) !== nextResalePriceUsd) {
            await tx
              .update(products)
              .set({
                priceUsd: nextResalePriceUsd.toFixed(2),
                updatedAt: syncedAt,
              })
              .where(eq(products.id, product.id));
          }
        }
      }

      await tx
        .insert(ventebotCatalogSyncState)
        .values({
          id: 1,
          etag: catalog.etag,
          lastSyncedAt: syncedAt,
          lastConnectionCheckAt: syncedAt,
          lastConnectionStatus: "connected",
          lastConnectionError: null,
          updatedAt: syncedAt,
        })
        .onConflictDoUpdate({
          target: ventebotCatalogSyncState.id,
          set: {
            etag: catalog.etag,
            lastSyncedAt: syncedAt,
            lastConnectionCheckAt: syncedAt,
            lastConnectionStatus: "connected",
            lastConnectionError: null,
            updatedAt: syncedAt,
          },
        });
    });

    return {
      notModified: false,
      lastSyncedAt: syncedAt.toISOString(),
      supplierProductCount: catalog.products.length,
    };
  } catch (error) {
    const message = safeVenteBotErrorMessage(error);
    await updateConnectionState({
      status: "error",
      error: message,
    }).catch(() => undefined);
    throw error;
  }
}

export type VerifiedVenteBotProductQuote = {
  product: typeof products.$inferSelect;
  quote: VenteBotQuote;
  inStock: boolean;
  maxQuantity: number;
};

export async function refreshVenteBotProductQuote(
  supplierProductId: number,
  quantity: number,
): Promise<VerifiedVenteBotProductQuote> {
  const apiKey = process.env.VENTEBOT_RESELLER_KEY?.trim();
  if (!apiKey) throw new Error("VenteBot reseller API key is not configured");
  if (!Number.isInteger(quantity) || quantity < 1) {
    throw new Error("A valid VenteBot quote quantity is required");
  }

  const mappedRows = await db
    .select()
    .from(products)
    .where(eq(products.ventebotProductId, supplierProductId))
    .limit(1);
  const product = mappedRows[0];
  if (!product?.active) throw new Error("This VenteBot product is not available");
  const catalogRows = await db
    .select()
    .from(ventebotCatalogProducts)
    .where(eq(ventebotCatalogProducts.id, supplierProductId))
    .limit(1);
  const catalogProduct = catalogRows[0];
  if (!catalogProduct?.catalogActive || catalogProduct.apiTest) {
    throw new Error("VenteBot product is not active for sale");
  }

  const checkedAt = new Date();
  try {
    const quote = await createVenteBotClient(apiKey).quote(
      supplierProductId,
      quantity,
    );
    const supportedDelivery =
      quote.deliveryType === "stock" ||
      quote.deliveryType === "supplier_api";
    if (
      !supportedDelivery ||
      (quote.deliveryType === "stock" && quote.stock === null)
    ) {
      throw new Error("VenteBot product delivery or stock cannot be verified");
    }
    if (quote.walletBalanceUsd < quote.totalUsd) {
      throw new Error("VenteBot supplier wallet balance is insufficient");
    }

    const supplierPriceUsd = Number(quote.unitPriceUsd.toFixed(2));
    const pricingMode =
      product.resalePricingMode === "fixed_markup"
        ? "fixed_markup"
        : product.resalePricingMode === "manual"
          ? "manual"
          : null;
    if (pricingMode === null) {
      throw new Error("VenteBot product has an unsupported resale pricing mode");
    }
    const nextResalePriceUsd = calculateVenteBotResalePriceAfterCostChange({
      previousSupplierPriceUsd: catalogProduct.priceUsd,
      supplierPriceUsd,
      pricingMode,
      resalePriceUsd: product.priceUsd,
      resaleMarkupUsd: product.resaleMarkupUsd,
    });
    if (
      nextResalePriceUsd === null ||
      !isValidVenteBotResalePricingInput(
        "manual",
        nextResalePriceUsd,
        null,
      )
    ) {
      await db
        .update(products)
        .set({ active: false, updatedAt: checkedAt })
        .where(eq(products.id, product.id));
      throw new Error("The verified VenteBot resale price is outside the supported range");
    }

    const updatedProductRows = await db.transaction(async (tx) => {
      await tx
        .update(ventebotCatalogProducts)
        .set({
          priceUsd: supplierPriceUsd.toFixed(2),
          stock: quote.stock,
          deliveryType: quote.deliveryType,
          lastSyncedAt: checkedAt,
          updatedAt: checkedAt,
        })
        .where(eq(ventebotCatalogProducts.id, supplierProductId));
      return tx
        .update(products)
        .set({
          priceUsd: nextResalePriceUsd.toFixed(2),
          updatedAt: checkedAt,
        })
        .where(eq(products.id, product.id))
        .returning();
    });
    const updatedProduct = updatedProductRows[0];
    if (!updatedProduct) throw new Error("VenteBot product mapping changed during quote verification");

    await updateConnectionState({
      status: "connected",
      checkedAt,
      error: null,
    });
    const maxQuantity = quote.stock ?? 99;
    return {
      product: updatedProduct,
      quote,
      inStock: quote.stock === null || quote.stock >= quantity,
      maxQuantity,
    };
  } catch (error) {
    await updateConnectionState({
      status: "error",
      error: safeVenteBotErrorMessage(error),
    }).catch(() => undefined);
    throw error;
  }
}

export type VenteBotCheckoutVerification = {
  verified: boolean;
  supplierLinked: boolean;
  priceChanged: boolean;
  oldUnitPriceUsd: string;
  currentUnitPriceUsd: string | null;
  expectedTotalUsd: string | null;
  reason: string | null;
  quote: VenteBotQuote | null;
};

export async function verifyVenteBotCheckoutPrice(
  checkoutId: string,
): Promise<VenteBotCheckoutVerification> {
  const checkoutRows = await db
    .select({
      checkout: checkoutSessions,
      product: products,
    })
    .from(checkoutSessions)
    .innerJoin(products, eq(checkoutSessions.productId, products.id))
    .where(eq(checkoutSessions.id, checkoutId))
    .limit(1);
  const row = checkoutRows[0];
  if (!row) {
    return {
      verified: false,
      supplierLinked: false,
      priceChanged: false,
      oldUnitPriceUsd: "0.00",
      currentUnitPriceUsd: null,
      expectedTotalUsd: null,
      reason: "Checkout session is missing",
      quote: null,
    };
  }
  if (row.checkout.ventebotProductId === null) {
    return {
      verified: true,
      supplierLinked: false,
      priceChanged: false,
      oldUnitPriceUsd: row.checkout.quantity > 0
        ? (Number(row.checkout.priceUsd) / row.checkout.quantity).toFixed(2)
        : "0.00",
      currentUnitPriceUsd: null,
      expectedTotalUsd: null,
      reason: null,
      quote: null,
    };
  }

  try {
    const verified = await refreshVenteBotProductQuote(
      row.checkout.ventebotProductId,
      row.checkout.quantity,
    );
    if (!verified.inStock) {
      return {
        verified: false,
        supplierLinked: true,
        priceChanged: false,
        oldUnitPriceUsd: row.checkout.quantity > 0
          ? (Number(row.checkout.priceUsd) / row.checkout.quantity).toFixed(2)
          : "0.00",
        currentUnitPriceUsd: null,
        expectedTotalUsd: null,
        reason: "VenteBot has insufficient stock for this checkout",
        quote: verified.quote,
      };
    }

    const saleRows = await db
      .select({ salePriceUsd: flashSales.salePriceUsd })
      .from(flashSales)
      .where(and(
        eq(flashSales.productId, row.product.id),
        eq(flashSales.status, "active"),
        lte(flashSales.startsAt, new Date()),
        gt(flashSales.endsAt, new Date()),
      ))
      .orderBy(desc(flashSales.startsAt))
      .limit(1);
    const currentUnitPrice = Number(
      saleRows[0]?.salePriceUsd ?? verified.product.priceUsd,
    );
    const expectedTotalUsd =
      (currentUnitPrice * row.checkout.quantity).toFixed(2);
    const oldUnitPriceUsd =
      (Number(row.checkout.priceUsd) / row.checkout.quantity).toFixed(2);
    return {
      verified: true,
      supplierLinked: true,
      priceChanged:
        Number(expectedTotalUsd) !== Number(row.checkout.priceUsd),
      oldUnitPriceUsd,
      currentUnitPriceUsd: currentUnitPrice.toFixed(2),
      expectedTotalUsd,
      reason: null,
      quote: verified.quote,
    };
  } catch (error) {
    return {
      verified: false,
      supplierLinked: true,
      priceChanged: false,
      oldUnitPriceUsd: row.checkout.quantity > 0
        ? (Number(row.checkout.priceUsd) / row.checkout.quantity).toFixed(2)
        : "0.00",
      currentUnitPriceUsd: null,
      expectedTotalUsd: null,
      reason: safeVenteBotErrorMessage(error),
      quote: null,
    };
  }
}