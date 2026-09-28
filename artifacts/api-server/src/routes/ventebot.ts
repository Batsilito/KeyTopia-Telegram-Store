import { Router, type IRouter, type Request, type Response } from "express";
import { and, asc, count, desc, eq, inArray, sql } from "drizzle-orm";
import {
  CreateProductBody,
  CreateVenteBotStorefrontProductBody,
  CreateVenteBotStorefrontProductParams,
  GetVenteBotCatalogResponse,
  ListVenteBotOrdersResponse,
  RefreshVenteBotCatalogResponse,
  RetryVenteBotOrderParams,
  RetryVenteBotOrderResponse,
  TestVenteBotConnectionResponse,
  UpdateVenteBotMappingBody,
  UpdateVenteBotMappingParams,
  UpdateVenteBotMappingResponse,
} from "@workspace/api-zod";
import {
  auditLogs,
  db,
  orders,
  products,
  users,
  ventebotCatalogProducts,
  ventebotCatalogSyncState,
  ventebotOrderFulfillments,
} from "@workspace/db";
import {
  getAdminFromRequest,
} from "../lib/admin-auth";
import {
  createVenteBotClient,
  safeVenteBotErrorMessage,
} from "../lib/ventebot-client";
import {
  calculateVenteBotResalePrice,
  expectedVenteBotMargin,
  getVenteBotAvailability,
  isValidVenteBotMappingInput,
  isValidVenteBotResalePricingInput,
} from "../lib/ventebot-rules";
import { refreshVenteBotCatalog } from "../lib/ventebot-catalog-sync";
import {
  broadcastNewProduct,
  broadcastProductPriceChange,
  retryAndNotifyVenteBotOrder,
} from "../bot";

const router: IRouter = Router();

type Admin = NonNullable<Awaited<ReturnType<typeof getAdminFromRequest>>>;

async function requireAdmin(req: Request, res: Response): Promise<Admin | null> {
  const admin = await getAdminFromRequest(req);
  if (!admin) {
    res.status(401).json({ error: "Authentication required" });
    return null;
  }
  return admin;
}

function requireSuperAdmin(admin: Admin, res: Response) {
  if (admin.role === "super_admin") return true;
  res.status(403).json({ error: "Super admin access required" });
  return false;
}

function iso(value: Date | null | undefined) {
  return value?.toISOString() ?? null;
}

function asNumber(value: string | number | null | undefined) {
  return value === null || value === undefined ? null : Number(value);
}

function hasVenteBotKey() {
  return Boolean(process.env.VENTEBOT_RESELLER_KEY?.trim());
}

async function updateConnectionState(input: {
  status: "not_configured" | "untested" | "connected" | "error";
  checkedAt?: Date;
  error?: string | null;
  walletBalanceUsd?: number | null;
}) {
  const values = {
    id: 1,
    lastConnectionStatus: input.status,
    lastConnectionError: input.error ?? null,
    ...(input.checkedAt ? { lastConnectionCheckAt: input.checkedAt } : {}),
    ...(input.walletBalanceUsd !== undefined
      ? { walletBalanceUsd: input.walletBalanceUsd?.toFixed(2) ?? null }
      : {}),
    updatedAt: new Date(),
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
        ...(values.walletBalanceUsd !== undefined
          ? { walletBalanceUsd: values.walletBalanceUsd }
          : {}),
        updatedAt: values.updatedAt,
      },
    });
}

router.get("/ventebot/catalog", async (req, res): Promise<void> => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const [stateRows, catalogRows, localRows, activeCountRows, failedCountRows] =
    await Promise.all([
      db.select().from(ventebotCatalogSyncState)
        .where(eq(ventebotCatalogSyncState.id, 1)).limit(1),
      db.select({
        supplier: ventebotCatalogProducts,
        product: products,
      })
        .from(ventebotCatalogProducts)
        .leftJoin(
          products,
          eq(products.ventebotProductId, ventebotCatalogProducts.id),
        )
        .orderBy(asc(ventebotCatalogProducts.name)),
      db.select({
        id: products.id,
        nameEn: products.nameEn,
        priceUsd: products.priceUsd,
        active: products.active,
        ventebotProductId: products.ventebotProductId,
        resalePricingMode: products.resalePricingMode,
        resaleMarkupUsd: products.resaleMarkupUsd,
      })
        .from(products)
        .orderBy(asc(products.nameEn)),
      db.select({ value: count() })
        .from(ventebotCatalogProducts)
        .where(eq(ventebotCatalogProducts.catalogActive, true)),
      db.select({ value: count() })
        .from(ventebotOrderFulfillments)
        .where(eq(ventebotOrderFulfillments.status, "failed")),
    ]);
  const state = stateRows[0];
  const apiKeyConfigured = hasVenteBotKey();
  const connectionStatus = !apiKeyConfigured
    ? "not_configured"
    : state?.lastConnectionStatus ?? "untested";

  const response = {
    connection: {
      apiKeyConfigured,
      status: connectionStatus,
      lastConnectionCheckAt: iso(state?.lastConnectionCheckAt),
      lastConnectionError: apiKeyConfigured
        ? state?.lastConnectionError ?? null
        : "Add VENTEBOT_RESELLER_KEY in Replit Secrets.",
      walletBalanceUsd: asNumber(state?.walletBalanceUsd),
      lastSyncedAt: iso(state?.lastSyncedAt),
      activeSupplierProductCount: Number(activeCountRows[0]?.value ?? 0),
      failedFulfillmentCount: Number(failedCountRows[0]?.value ?? 0),
    },
    supplierProducts: catalogRows.map(({ supplier, product }) => {
      const availability = getVenteBotAvailability(
        supplier,
        apiKeyConfigured,
      );
      const resalePriceUsd = product ? Number(product.priceUsd) : null;
      return {
        id: supplier.id,
        name: supplier.name,
        description: supplier.description,
        emoji: supplier.emoji,
        imageUrl: supplier.imageUrl,
        priceUsd: Number(supplier.priceUsd),
        standardPriceUsd: asNumber(supplier.standardPriceUsd),
        pricingType: supplier.pricingType,
        specialPriceExpiresAt: supplier.specialPriceExpiresAt,
        warrantyDays: supplier.warrantyDays,
        deliveryType: supplier.deliveryType,
        stock: supplier.stock,
        apiTest: supplier.apiTest,
        catalogActive: supplier.catalogActive,
        lastSyncedAt: supplier.lastSyncedAt.toISOString(),
        mappedProductId: product?.id ?? null,
        mappedProductName: product?.nameEn ?? null,
        resalePriceUsd,
        resalePricingMode: product?.resalePricingMode ?? "manual",
        resaleMarkupUsd: product?.resaleMarkupUsd == null
          ? null
          : Number(product.resaleMarkupUsd),
        expectedMarginUsd: expectedVenteBotMargin(
          resalePriceUsd,
          supplier.priceUsd,
        ),
        availability,
      };
    }),
    localProducts: localRows.map((product) => ({
      ...product,
      priceUsd: Number(product.priceUsd),
      resaleMarkupUsd: product.resaleMarkupUsd === null
        ? null
        : Number(product.resaleMarkupUsd),
    })),
  };
  res.json(GetVenteBotCatalogResponse.parse(response));
});

router.post("/ventebot/test", async (req, res): Promise<void> => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  if (!requireSuperAdmin(admin, res)) return;
  const checkedAt = new Date();
  if (!hasVenteBotKey()) {
    const message = "Add VENTEBOT_RESELLER_KEY in Replit Secrets.";
    await updateConnectionState({
      status: "not_configured",
      checkedAt,
      error: message,
    });
    res.status(503).json({ error: message });
    return;
  }
  try {
    const client = createVenteBotClient(process.env.VENTEBOT_RESELLER_KEY!);
    const account = await client.getAccount();
    await updateConnectionState({
      status: "connected",
      checkedAt,
      error: null,
      walletBalanceUsd: account.walletBalanceUsd,
    });
    res.json(TestVenteBotConnectionResponse.parse({
      connected: true,
      checkedAt: checkedAt.toISOString(),
      walletBalanceUsd: account.walletBalanceUsd,
      message: "VenteBot connection verified.",
    }));
  } catch (error) {
    const message = safeVenteBotErrorMessage(error);
    await updateConnectionState({
      status: "error",
      checkedAt,
      error: message,
    });
    req.log.warn(
      {
        supplierStatusCode: error && typeof error === "object" && "statusCode" in error
          ? Number(error.statusCode)
          : undefined,
      },
      "VenteBot connection test failed",
    );
    res.status(503).json({ error: message });
  }
});

router.post("/ventebot/catalog/refresh", async (req, res): Promise<void> => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  if (!requireSuperAdmin(admin, res)) return;
  try {
    const result = await refreshVenteBotCatalog();
    res.json(RefreshVenteBotCatalogResponse.parse(result));
  } catch (error) {
    const message = safeVenteBotErrorMessage(error);
    req.log.warn({ err: error }, "VenteBot catalog refresh failed");
    res.status(503).json({ error: message });
  }
});

router.patch(
  "/ventebot/catalog/:supplierProductId/mapping",
  async (req, res): Promise<void> => {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    if (!requireSuperAdmin(admin, res)) return;
    const params = UpdateVenteBotMappingParams.safeParse({
      supplierProductId: Number(req.params.supplierProductId),
    });
    const body = UpdateVenteBotMappingBody.safeParse(req.body);
    if (!params.success || !body.success) {
      res.status(400).json({ error: "Invalid supplier mapping." });
      return;
    }
    const { supplierProductId } = params.data;
    const {
      productId,
      resalePricingMode,
      resalePriceUsd,
      resaleMarkupUsd,
      copyDescription = false,
    } = body.data;
    if (!isValidVenteBotMappingInput(
      productId,
      resalePricingMode,
      resalePriceUsd,
      resaleMarkupUsd,
    )) {
      res.status(400).json({
        error: "Choose a valid pricing mode and matching price or markup.",
      });
      return;
    }

    const supplierRows = await db.select()
      .from(ventebotCatalogProducts)
      .where(eq(ventebotCatalogProducts.id, supplierProductId))
      .limit(1);
    const supplierProduct = supplierRows[0];
    if (!supplierProduct) {
      res.status(404).json({ error: "Supplier product was not found." });
      return;
    }

    if (productId === null) {
      await db.update(products)
        .set({
          ventebotProductId: null,
          active: false,
          resalePricingMode: "manual",
          resaleMarkupUsd: null,
          updatedAt: new Date(),
        })
        .where(eq(products.ventebotProductId, supplierProductId));
      res.json(UpdateVenteBotMappingResponse.parse({
        supplierProductId,
        productId: null,
        resalePriceUsd: null,
        resalePricingMode: "manual",
        resaleMarkupUsd: null,
        expectedMarginUsd: null,
      }));
      return;
    }

    const productRows = await db.select()
      .from(products)
      .where(eq(products.id, productId))
      .limit(1);
    const product = productRows[0];
    if (!product) {
      res.status(404).json({ error: "KeyTopia product was not found." });
      return;
    }
    const effectiveResalePriceUsd = calculateVenteBotResalePrice(
      supplierProduct.priceUsd,
      resalePricingMode,
      resalePriceUsd,
      resaleMarkupUsd,
    );
    if (
      effectiveResalePriceUsd === null ||
      !isValidVenteBotResalePricingInput(
        "manual",
        effectiveResalePriceUsd,
        null,
      )
    ) {
      res.status(400).json({
        error: "The calculated resale price is outside the supported range.",
      });
      return;
    }
    try {
      const updated = await db.transaction(async (tx) => {
        const existingMappingRows = await tx.select({ id: products.id })
          .from(products)
          .where(eq(products.ventebotProductId, supplierProductId))
          .limit(1);
        if (existingMappingRows[0] && existingMappingRows[0].id !== productId) {
          await tx.update(products)
            .set({
              ventebotProductId: null,
              active: false,
              updatedAt: new Date(),
            })
            .where(eq(products.id, existingMappingRows[0].id));
        }
        const updatedRows = await tx.update(products)
          .set({
            ventebotProductId: supplierProductId,
            priceUsd: effectiveResalePriceUsd.toFixed(2),
            resalePricingMode,
            resaleMarkupUsd: resalePricingMode === "fixed_markup"
              ? resaleMarkupUsd!.toFixed(2)
              : null,
            deliveryType: "automatic",
            stockType: "unlimited",
            ...(copyDescription
              ? { instructionsEn: supplierProduct.description }
              : {}),
            updatedAt: new Date(),
          })
          .where(eq(products.id, productId))
          .returning();
        return updatedRows[0];
      });
      if (!updated) {
        res.status(404).json({ error: "KeyTopia product was not found." });
        return;
      }
      if (updated.active && updated.priceUsd !== product.priceUsd) {
        void broadcastProductPriceChange(updated, product.priceUsd);
      }
      res.json(UpdateVenteBotMappingResponse.parse({
        supplierProductId,
        productId: updated.id,
        resalePriceUsd: Number(updated.priceUsd),
        resalePricingMode: updated.resalePricingMode,
        resaleMarkupUsd: updated.resaleMarkupUsd === null
          ? null
          : Number(updated.resaleMarkupUsd),
        expectedMarginUsd: expectedVenteBotMargin(
          updated.priceUsd,
          supplierProduct.priceUsd,
        ),
      }));
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "23505") {
        res.status(409).json({
          error: "This supplier product is already mapped to another KeyTopia product.",
        });
        return;
      }
      throw error;
    }
  },
);

router.post(
  "/ventebot/catalog/:supplierProductId/store-product",
  async (req, res): Promise<void> => {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    if (!requireSuperAdmin(admin, res)) return;
    const params = CreateVenteBotStorefrontProductParams.safeParse({
      supplierProductId: Number(req.params.supplierProductId),
    });
    const body = CreateVenteBotStorefrontProductBody.safeParse(req.body);
    if (!params.success || !body.success) {
      res.status(400).json({ error: "Invalid supplier product setup." });
      return;
    }
    const { supplierProductId } = params.data;
    const supplierRows = await db.select()
      .from(ventebotCatalogProducts)
      .where(eq(ventebotCatalogProducts.id, supplierProductId))
      .limit(1);
    const supplierProduct = supplierRows[0];
    if (!supplierProduct) {
      res.status(404).json({ error: "Supplier product was not found." });
      return;
    }
    const {
      resalePricingMode,
      resalePriceUsd,
      resaleMarkupUsd,
      copyDescription,
    } = body.data;
    if (!isValidVenteBotResalePricingInput(
      resalePricingMode,
      resalePriceUsd,
      resaleMarkupUsd,
    )) {
      res.status(400).json({
        error: "Provide either a manual resale price or a fixed supplier-price markup.",
      });
      return;
    }
    const effectiveResalePriceUsd = calculateVenteBotResalePrice(
      supplierProduct.priceUsd,
      resalePricingMode,
      resalePriceUsd,
      resaleMarkupUsd,
    );
    if (
      effectiveResalePriceUsd === null ||
      !isValidVenteBotResalePricingInput(
        "manual",
        effectiveResalePriceUsd,
        null,
      )
    ) {
      res.status(400).json({
        error: "The calculated resale price is outside the supported range.",
      });
      return;
    }
    const supplierName = supplierProduct.name.trim();
    if (!supplierName) {
      res.status(400).json({
        error: "The supplier listing needs a name before it can be added to the store.",
      });
      return;
    }

    const availability = getVenteBotAvailability(
      supplierProduct,
      hasVenteBotKey(),
    );
    const candidate = CreateProductBody.safeParse({
      nameEn: supplierName,
      nameAr: supplierName,
      duration: "Supplier fulfilled",
      warranty: supplierProduct.warrantyDays > 0
        ? `${supplierProduct.warrantyDays} days`
        : "No warranty",
      priceUsd: effectiveResalePriceUsd,
      deliveryType: "automatic",
      stockType: "unlimited",
      active: availability.available,
      displayStock: false,
      lowStockThreshold: 3,
      imageUrl: supplierProduct.imageUrl,
      telegramCustomEmojiId: null,
      instructionsEn: body.data.copyDescription
        ? supplierProduct.description
        : "",
      instructionsAr: "",
    });
    if (!candidate.success) {
      res.status(400).json({
        error: "The supplier listing is missing details required for a store product.",
      });
      return;
    }

    try {
      const createdProduct = await db.transaction(async (tx) => {
        const currentMappingRows = await tx.select({ id: products.id })
          .from(products)
          .where(eq(products.ventebotProductId, supplierProductId))
          .limit(1)
          .for("update");
        const currentMappedProductId = currentMappingRows[0]?.id ?? null;
        if (currentMappedProductId !== body.data.replaceMappedProductId) {
          return null;
        }
        if (currentMappedProductId) {
          await tx.update(products)
            .set({
              ventebotProductId: null,
              active: false,
              updatedAt: new Date(),
            })
            .where(eq(products.id, currentMappedProductId));
        }
        const rows = await tx.insert(products)
          .values({
            ...candidate.data,
            priceUsd: candidate.data.priceUsd.toFixed(2),
            resalePricingMode,
            resaleMarkupUsd: resalePricingMode === "fixed_markup"
              ? resaleMarkupUsd!.toFixed(2)
              : null,
            ventebotProductId: supplierProductId,
          })
          .returning();
        const created = rows[0];
        await tx.insert(auditLogs).values({
          adminId: admin.id,
          action: "product_created_from_ventebot",
          entityType: "product",
          entityId: created.id,
          afterValues: {
            ...candidate.data,
            priceUsd: created.priceUsd,
            resalePricingMode: created.resalePricingMode,
            resaleMarkupUsd: created.resaleMarkupUsd,
            ventebotProductId: supplierProductId,
          },
        });
        return created;
      });
      if (!createdProduct) {
        res.status(409).json({
          error: "The supplier mapping changed. Refresh the catalog and try again.",
        });
        return;
      }
      if (createdProduct.active) void broadcastNewProduct(createdProduct);
      res.status(201).json(UpdateVenteBotMappingResponse.parse({
        supplierProductId,
        productId: createdProduct.id,
        resalePriceUsd: Number(createdProduct.priceUsd),
        resalePricingMode: createdProduct.resalePricingMode,
        resaleMarkupUsd: createdProduct.resaleMarkupUsd === null
          ? null
          : Number(createdProduct.resaleMarkupUsd),
        expectedMarginUsd: expectedVenteBotMargin(
          createdProduct.priceUsd,
          supplierProduct.priceUsd,
        ),
      }));
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "23505"
      ) {
        res.status(409).json({
          error: "This supplier product was mapped by another request.",
        });
        return;
      }
      throw error;
    }
  },
);

router.get("/ventebot/orders", async (req, res): Promise<void> => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  const rows = await db.select({
    fulfillment: ventebotOrderFulfillments,
    order: orders,
    customer: users,
  })
    .from(ventebotOrderFulfillments)
    .innerJoin(orders, eq(orders.id, ventebotOrderFulfillments.orderId))
    .innerJoin(users, eq(users.id, orders.userId))
    .orderBy(desc(ventebotOrderFulfillments.createdAt))
    .limit(100);
  const response = {
    items: rows.map(({ fulfillment, order, customer }) => ({
      orderId: order.id,
      orderNumber: order.orderNumber,
      customerName: `${customer.firstName}${customer.lastName ? ` ${customer.lastName}` : ""}`,
      productName: order.productNameSnapshot,
      supplierProductId: fulfillment.ventebotProductId,
      providerOrderId: fulfillment.ventebotOrderId,
      providerStatus: fulfillment.providerStatus,
      status: fulfillment.status,
      priceUsd: Number(order.priceUsd),
      acquisitionCostUsd: asNumber(fulfillment.acquisitionCostUsd),
      attempts: fulfillment.attempts,
      lastError: fulfillment.lastError,
      nextAttemptAt: iso(fulfillment.nextAttemptAt),
      createdAt: fulfillment.createdAt.toISOString(),
      canRetry: fulfillment.status === "failed",
    })),
  };
  res.json(ListVenteBotOrdersResponse.parse(response));
});

router.post(
  "/ventebot/orders/:orderId/retry",
  async (req, res): Promise<void> => {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    if (!requireSuperAdmin(admin, res)) return;
    const params = RetryVenteBotOrderParams.safeParse({
      orderId: req.params.orderId,
    });
    if (!params.success) {
      res.status(400).json({ error: "Invalid customer order ID." });
      return;
    }
    const result = await retryAndNotifyVenteBotOrder(params.data.orderId);
    if (result.status === "missing") {
      res.status(404).json({ error: "Supplier fulfillment was not found." });
      return;
    }
    if (!["failed", "completed", "awaiting_delivery", "submitting", "pending"].includes(result.status)) {
      res.status(409).json({ error: "Supplier fulfillment is not ready to retry." });
      return;
    }
    res.json(RetryVenteBotOrderResponse.parse({
      status: result.status,
      orderStatus: result.order?.status ?? null,
    }));
  },
);

export default router;