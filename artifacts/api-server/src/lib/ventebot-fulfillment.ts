import { and, eq, inArray, lte, or } from "drizzle-orm";
import {
  db,
  orders,
  ventebotOrderFulfillments,
} from "@workspace/db";
import { logger } from "./logger";
import {
  createVenteBotClient,
  safeVenteBotErrorMessage,
  type VenteBotOrder,
} from "./ventebot-client";
import { evaluateVenteBotProviderOrder } from "./ventebot-provider-order";
import { venteBotIdempotencyKey } from "./ventebot-rules";
import { verifyVenteBotCheckoutPrice } from "./ventebot-catalog-sync";

const ORDER_STALE_AFTER_MS = 2 * 60 * 1000;
const DELIVERY_RECHECK_DELAY_MS = 30 * 1000;

export function createVenteBotFulfillmentValues(
  orderId: string,
  ventebotProductId: number,
) {
  return {
    orderId,
    ventebotProductId,
    idempotencyKey: venteBotIdempotencyKey(orderId),
  };
}

type ProcessResult = {
  status: string;
  order: typeof orders.$inferSelect | null;
};

async function claimFulfillment(orderId: string) {
  return db.transaction(async (tx) => {
    const now = new Date();
    const staleBefore = new Date(now.getTime() - ORDER_STALE_AFTER_MS);
    const rows = await tx
      .select()
      .from(ventebotOrderFulfillments)
      .where(and(
        eq(ventebotOrderFulfillments.orderId, orderId),
        or(
          eq(ventebotOrderFulfillments.status, "pending"),
          and(
            eq(ventebotOrderFulfillments.status, "awaiting_delivery"),
            lte(ventebotOrderFulfillments.nextAttemptAt, now),
          ),
          and(
            eq(ventebotOrderFulfillments.status, "submitting"),
            lte(ventebotOrderFulfillments.updatedAt, staleBefore),
          ),
        ),
      ))
      .for("update")
      .limit(1);
    const fulfillment = rows[0];
    if (!fulfillment) {
      const currentRows = await tx
        .select()
        .from(ventebotOrderFulfillments)
        .where(eq(ventebotOrderFulfillments.orderId, orderId))
        .limit(1);
      return { kind: "not_due" as const, fulfillment: currentRows[0] ?? null };
    }

    const orderRows = await tx
      .select()
      .from(orders)
      .where(eq(orders.id, orderId))
      .for("update")
      .limit(1);
    const order = orderRows[0];
    if (!order || !["paid", "processing"].includes(order.status)) {
      const updated = await tx
        .update(ventebotOrderFulfillments)
        .set({
          status: "failed",
          lastError: "The customer order is no longer awaiting fulfillment.",
          nextAttemptAt: null,
          updatedAt: now,
        })
        .where(eq(ventebotOrderFulfillments.id, fulfillment.id))
        .returning();
      return { kind: "not_due" as const, fulfillment: updated[0] ?? fulfillment };
    }

    const claimedRows = await tx
      .update(ventebotOrderFulfillments)
      .set({
        status: "submitting",
        attempts: fulfillment.attempts + 1,
        nextAttemptAt: null,
        lastError: null,
        updatedAt: now,
      })
      .where(eq(ventebotOrderFulfillments.id, fulfillment.id))
      .returning();
    await tx
      .update(orders)
      .set({ status: "processing", updatedAt: now })
      .where(and(
        eq(orders.id, orderId),
        inArray(orders.status, ["paid", "processing"]),
      ));
    return {
      kind: "claimed" as const,
      fulfillment: claimedRows[0] ?? fulfillment,
      order,
    };
  });
}

async function failFulfillment(
  fulfillmentId: string,
  errorMessage: string,
  providerStatus?: string,
) {
  const rows = await db
    .update(ventebotOrderFulfillments)
    .set({
      status: "failed",
      providerStatus: providerStatus ?? null,
      lastError: errorMessage,
      nextAttemptAt: null,
      updatedAt: new Date(),
    })
    .where(eq(ventebotOrderFulfillments.id, fulfillmentId))
    .returning();
  return rows[0] ?? null;
}

async function recordProviderOrder(
  fulfillmentId: string,
  providerOrder: VenteBotOrder,
  acquisitionCostUsd: number,
): Promise<ProcessResult> {
  const result = evaluateVenteBotProviderOrder(providerOrder);
  if (result.kind === "failed") {
    const fulfillment = await failFulfillment(
      fulfillmentId,
      result.error,
      providerOrder.status,
    );
    const orderRows = fulfillment
      ? await db.select().from(orders)
          .where(eq(orders.id, fulfillment.orderId)).limit(1)
      : [];
    return {
      status: "failed",
      order: orderRows[0] ?? null,
    };
  }

  if (result.kind === "waiting") {
    const now = new Date();
    const rows = await db
      .update(ventebotOrderFulfillments)
      .set({
        ventebotOrderId: providerOrder.id,
        providerStatus: providerOrder.status,
        acquisitionCostUsd: acquisitionCostUsd.toFixed(2),
        status: "awaiting_delivery",
        nextAttemptAt: new Date(now.getTime() + DELIVERY_RECHECK_DELAY_MS),
        updatedAt: now,
      })
      .where(eq(ventebotOrderFulfillments.id, fulfillmentId))
      .returning();
    const fulfillment = rows[0];
    const orderRows = fulfillment
      ? await db.select().from(orders)
          .where(eq(orders.id, fulfillment.orderId)).limit(1)
      : [];
    return {
      status: "awaiting_delivery",
      order: orderRows[0] ?? null,
    };
  }

  const deliveryInfo = result.deliveryInfo;

  return db.transaction(async (tx) => {
    const now = new Date();
    const fulfillmentRows = await tx
      .select()
      .from(ventebotOrderFulfillments)
      .where(eq(ventebotOrderFulfillments.id, fulfillmentId))
      .for("update")
      .limit(1);
    const fulfillment = fulfillmentRows[0];
    if (!fulfillment) return { status: "failed", order: null };

    const orderRows = await tx
      .update(orders)
      .set({
        deliveryInfo,
        acquisitionCostUsd: acquisitionCostUsd.toFixed(2),
        status: "delivered",
        deliveredAt: now,
        updatedAt: now,
      })
      .where(and(
        eq(orders.id, fulfillment.orderId),
        inArray(orders.status, ["paid", "processing"]),
      ))
      .returning();
    if (!orderRows[0]) {
      await tx
        .update(ventebotOrderFulfillments)
        .set({
          ventebotOrderId: providerOrder.id,
          providerStatus: providerOrder.status,
          status: "failed",
          lastError: "The customer order changed before supplier delivery could be recorded.",
          nextAttemptAt: null,
          updatedAt: now,
        })
        .where(eq(ventebotOrderFulfillments.id, fulfillment.id));
      const currentOrderRows = await tx
        .select()
        .from(orders)
        .where(eq(orders.id, fulfillment.orderId))
        .limit(1);
      return { status: "failed", order: currentOrderRows[0] ?? null };
    }

    await tx
      .update(ventebotOrderFulfillments)
      .set({
        ventebotOrderId: providerOrder.id,
        providerStatus: providerOrder.status,
        acquisitionCostUsd: acquisitionCostUsd.toFixed(2),
        status: "completed",
        lastError: null,
        nextAttemptAt: null,
        completedAt: now,
        updatedAt: now,
      })
      .where(eq(ventebotOrderFulfillments.id, fulfillment.id));
    return { status: "completed", order: orderRows[0] };
  });
}

export async function processVenteBotFulfillment(
  orderId: string,
): Promise<ProcessResult> {
  const claim = await claimFulfillment(orderId);
  if (claim.kind !== "claimed") {
    const orderRows = claim.fulfillment
      ? await db.select().from(orders)
          .where(eq(orders.id, claim.fulfillment.orderId)).limit(1)
      : [];
    return {
      status: claim.fulfillment?.status ?? "missing",
      order: orderRows[0] ?? null,
    };
  }

  const fulfillment = claim.fulfillment;
  const order = claim.order;
  try {
    const apiKey = process.env.VENTEBOT_RESELLER_KEY ?? "";
    const client = createVenteBotClient(apiKey);
    let providerOrder: VenteBotOrder;
    let acquisitionCostUsd = Number(fulfillment.quoteTotalUsd ?? 0);

    if (fulfillment.ventebotOrderId !== null) {
      providerOrder = await client.getOrder(fulfillment.ventebotOrderId);
      acquisitionCostUsd = Number(
        fulfillment.acquisitionCostUsd ?? fulfillment.quoteTotalUsd ?? providerOrder.amountUsd,
      );
    } else if (fulfillment.orderRequestStartedAt) {
      // A prior request may have reached VenteBot before this process timed out.
      // Replaying the same body and key recovers that order without a second debit.
      providerOrder = await client.createOrder({
        productId: fulfillment.ventebotProductId,
        quantity: order.quantity,
        customerReference: order.orderNumber,
        idempotencyKey: fulfillment.idempotencyKey,
      });
      acquisitionCostUsd = providerOrder.amountUsd;
    } else {
      if (!order.checkoutSessionId) {
        throw new Error(
          "VenteBot checkout price snapshot is missing; supplier fulfillment is blocked.",
        );
      }
      const verification = await verifyVenteBotCheckoutPrice(
        order.checkoutSessionId,
      );
      if (!verification.verified) {
        throw new Error(
          `Unable to verify VenteBot price and stock before fulfillment: ${verification.reason ?? "unknown supplier error"}`,
        );
      }
      if (verification.priceChanged) {
        throw new Error(
          "VenteBot resale price changed after customer payment; supplier fulfillment is blocked for review.",
        );
      }
      const quote = verification.quote;
      if (!quote) {
        throw new Error("VenteBot did not provide a current checkout quote.");
      }
      if (quote.deliveryType === "activation") {
        throw new Error(
          "VenteBot requires an activation identifier; this product is not enabled for sale.",
        );
      }
      if (quote.deliveryType === "api_test") {
        throw new Error("VenteBot API test products cannot be sold to customers.");
      }
      if (quote.deliveryType === "stock" && quote.stock === null) {
        throw new Error("VenteBot returned unknown stock for a stock-delivery product.");
      }
      if (
        quote.stock !== null &&
        quote.stock < order.quantity
      ) {
        throw new Error("VenteBot has insufficient stock for this order.");
      }
      if (quote.walletBalanceUsd < quote.totalUsd) {
        throw new Error("VenteBot wallet balance is insufficient.");
      }

      acquisitionCostUsd = quote.totalUsd;
      const requestStartedAt = new Date();
      await db
        .update(ventebotOrderFulfillments)
        .set({
          quoteTotalUsd: quote.totalUsd.toFixed(2),
          quotedAt: requestStartedAt,
          orderRequestStartedAt: requestStartedAt,
          updatedAt: requestStartedAt,
        })
        .where(and(
          eq(ventebotOrderFulfillments.id, fulfillment.id),
          eq(ventebotOrderFulfillments.status, "submitting"),
        ));
      providerOrder = await client.createOrder({
        productId: fulfillment.ventebotProductId,
        quantity: order.quantity,
        customerReference: order.orderNumber,
        idempotencyKey: fulfillment.idempotencyKey,
      });
      acquisitionCostUsd = providerOrder.amountUsd;
    }

    return recordProviderOrder(
      fulfillment.id,
      providerOrder,
      acquisitionCostUsd,
    );
  } catch (error) {
    const message = error instanceof Error && (
      error.message.startsWith("VenteBot requires an activation identifier") ||
      error.message.startsWith("VenteBot API test products") ||
      error.message.startsWith("VenteBot returned unknown stock") ||
      error.message.startsWith("VenteBot has insufficient stock") ||
      error.message.startsWith("VenteBot wallet balance is insufficient")
    )
      ? error.message
      : safeVenteBotErrorMessage(error);
    const updated = await failFulfillment(fulfillment.id, message);
    logger.warn(
      {
        orderId,
        supplierStatusCode: error && typeof error === "object" && "statusCode" in error
          ? Number(error.statusCode)
          : undefined,
      },
      "VenteBot supplier fulfillment requires review",
    );
    const orderRows = updated
      ? await db.select().from(orders)
          .where(eq(orders.id, orderId)).limit(1)
      : [];
    return { status: "failed", order: orderRows[0] ?? null };
  }
}

export async function retryVenteBotFulfillment(orderId: string) {
  const rows = await db
    .update(ventebotOrderFulfillments)
    .set({
      status: "pending",
      lastError: null,
      nextAttemptAt: null,
      updatedAt: new Date(),
    })
    .where(and(
      eq(ventebotOrderFulfillments.orderId, orderId),
      eq(ventebotOrderFulfillments.status, "failed"),
    ))
    .returning();
  if (rows[0]) return processVenteBotFulfillment(orderId);
  const existing = await db
    .select({ status: ventebotOrderFulfillments.status })
    .from(ventebotOrderFulfillments)
    .where(eq(ventebotOrderFulfillments.orderId, orderId))
    .limit(1);
  return { status: existing[0]?.status ?? "missing", order: null };
}

export async function listDueVenteBotOrderIds(limit = 20) {
  const now = new Date();
  const staleBefore = new Date(now.getTime() - ORDER_STALE_AFTER_MS);
  const rows = await db
    .select({ orderId: ventebotOrderFulfillments.orderId })
    .from(ventebotOrderFulfillments)
    .where(or(
      eq(ventebotOrderFulfillments.status, "pending"),
      and(
        eq(ventebotOrderFulfillments.status, "awaiting_delivery"),
        lte(ventebotOrderFulfillments.nextAttemptAt, now),
      ),
      and(
        eq(ventebotOrderFulfillments.status, "submitting"),
        lte(ventebotOrderFulfillments.updatedAt, staleBefore),
      ),
    ))
    .orderBy(ventebotOrderFulfillments.createdAt)
    .limit(limit);
  return rows.map((row) => row.orderId);
}