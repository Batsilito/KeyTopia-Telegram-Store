import { Router, type IRouter, type Request, type Response } from "express";
import { asc, count, desc, eq, sql } from "drizzle-orm";
import {
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
  expectedVenteBotMargin,
  getVenteBotAvailability,
  isValidVenteBotMappingInput,
} from "../lib/ventebot-rules";
import { retryAndNotifyVenteBotOrder } from "../bot";

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

function getCatalogRefreshErrorContext(error: unknown): Record<string, unknown> {
  const context: Record<string, unknown> = {
    errorType: error instanceof Error ? error.name : typeof error,
  };

  if (error && typeof error === "object") {
    if ("statusCode" in error) {
      const statusCode = Number(error.statusCode);
      if (Number.isFinite(statusCode)) context.supplierStatusCode = statusCode;
    }
    if (
      "code" in error &&
      typeof error.code === "string" &&
      /^[A-Z0-9_]{2,16}$/.test(error.code)
    ) {
      context.errorCode = error.code;
    }
  }

  if (error instanceof SyntaxError) {
    context.failureKind = "invalid_json";
  } else if (
    error instanceof Error &&
    (
      error.message === "Invalid VenteBot catalog response" ||
      error.message.startsWith("Invalid VenteBot response:")
    )
  ) {
    context.failureKind = "invalid_supplier_payload";
    context.validationError = error.message;
  } else if (context.supplierStatusCode !== undefined) {
    context.failureKind = "supplier_http_error";
  } else {
    context.failureKind = "network_or_internal_error";
  }

  return context;
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
  if (!hasVenteBotKey()) {
    res.status(503).json({
      error: "Add VENTEBOT_RESELLER_KEY in Replit Secrets.",
    });
    return;
  }

  const stateRows = await db.select()
    .from(ventebotCatalogSyncState)
    .where(eq(ventebotCatalogSyncState.id, 1))
    .limit(1);
  const currentState = stateRows[0];
  const syncedAt = new Date();
  try {
    const client = createVenteBotClient(process.env.VENTEBOT_RESELLER_KEY!);
    const catalog = await client.getProducts(currentState?.etag);
    if (catalog.notModified) {
      const activeCountRows = await db.select({ value: count() })
        .from(ventebotCatalogProducts)
        .where(eq(ventebotCatalogProducts.catalogActive, true));
      if (currentState) {
        await db.update(ventebotCatalogSyncState)
          .set({
            etag: catalog.etag ?? currentState.etag,
            updatedAt: syncedAt,
          })
          .where(eq(ventebotCatalogSyncState.id, 1));
      }
      await updateConnectionState({
        status: "connected",
        checkedAt: syncedAt,
        error: null,
      });
      res.json(RefreshVenteBotCatalogResponse.parse({
        notModified: true,
        lastSyncedAt: iso(currentState?.lastSyncedAt),
        supplierProductCount: Number(activeCountRows[0]?.value ?? 0),
      }));
      return;
    }

    await db.transaction(async (tx) => {
      await tx.update(ventebotCatalogProducts)
        .set({ catalogActive: false, updatedAt: syncedAt });
      if (catalog.products.length) {
        await tx.insert(ventebotCatalogProducts)
          .values(catalog.products.map((product) => ({
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
          })))
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
      }
      await tx.insert(ventebotCatalogSyncState)
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

    res.json(RefreshVenteBotCatalogResponse.parse({
      notModified: false,
      lastSyncedAt: syncedAt.toISOString(),
      supplierProductCount: catalog.products.length,
    }));
  } catch (error) {
    const message = safeVenteBotErrorMessage(error);
    await updateConnectionState({
      status: "error",
      error: message,
    });
    req.log.warn(
      getCatalogRefreshErrorContext(error),
      "VenteBot catalog refresh failed",
    );
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
    const { productId, resalePriceUsd } = body.data;
    if (!isValidVenteBotMappingInput(productId, resalePriceUsd)) {
      res.status(400).json({
        error: "Choose a KeyTopia product and resale price together, or clear both to unlink.",
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
          updatedAt: new Date(),
        })
        .where(eq(products.ventebotProductId, supplierProductId));
      res.json(UpdateVenteBotMappingResponse.parse({
        supplierProductId,
        productId: null,
        resalePriceUsd: null,
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
            priceUsd: resalePriceUsd!.toFixed(2),
            deliveryType: "automatic",
            stockType: "unlimited",
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
      res.json(UpdateVenteBotMappingResponse.parse({
        supplierProductId,
        productId: updated.id,
        resalePriceUsd: Number(updated.priceUsd),
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