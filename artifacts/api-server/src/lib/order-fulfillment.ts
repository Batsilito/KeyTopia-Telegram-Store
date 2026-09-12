import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { db, inventoryItems, inventoryReservations, orders, products } from "@workspace/db";

export type AutomaticFulfillmentResult = {
  order: typeof orders.$inferSelect;
  status: "delivered" | "waiting";
};

export async function fulfillAutomaticOrder(
  orderId: string,
): Promise<AutomaticFulfillmentResult | null> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .select({ order: orders, product: products })
      .from(orders)
      .innerJoin(products, eq(orders.productId, products.id))
      .where(eq(orders.id, orderId))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    if (row.order.status === "delivered") {
      return { order: row.order, status: "delivered" };
    }
    if (
      row.order.deliveryType !== "automatic" ||
      !["paid", "processing"].includes(row.order.status)
    ) {
      return { order: row.order, status: "waiting" };
    }

    let deliveryInfo = "";
    if ((row.order.stockTypeSnapshot ?? row.product.stockType) === "limited") {
      const reserved = row.order.checkoutSessionId
        ? await tx
            .select({ id: inventoryItems.id, secretValue: inventoryItems.secretValue })
            .from(inventoryReservations)
            .innerJoin(inventoryItems, eq(inventoryReservations.inventoryItemId, inventoryItems.id))
            .where(and(
              eq(inventoryReservations.checkoutSessionId, row.order.checkoutSessionId),
              eq(inventoryItems.status, "reserved"),
            ))
            .orderBy(asc(inventoryItems.createdAt))
            .limit(row.order.quantity)
        : [];
      // The available fallback supports orders created before reservations were
      // introduced. New checkouts always consume their own reserved stock.
      const available = reserved.length === row.order.quantity ? reserved : await tx
        .select({
          id: inventoryItems.id,
          secretValue: inventoryItems.secretValue,
        })
        .from(inventoryItems)
        .where(
          and(
            eq(inventoryItems.productId, row.order.productId),
            eq(inventoryItems.status, "available"),
          ),
        )
        .orderBy(asc(inventoryItems.createdAt))
        .limit(row.order.quantity);
      if (available.length < row.order.quantity) {
        return { order: row.order, status: "waiting" };
      }

      const expectedStatus = reserved.length === row.order.quantity ? "reserved" : "available";
      const claimed = await tx
        .update(inventoryItems)
        .set({
          status: "delivered",
          orderId: row.order.id,
          deliveredAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            inArray(inventoryItems.id, available.map((item) => item.id)),
            eq(inventoryItems.status, expectedStatus),
          ),
        )
        .returning({ secretValue: inventoryItems.secretValue });
      if (claimed.length !== row.order.quantity) {
        throw new Error(`Unable to claim inventory for order ${row.order.orderNumber}`);
      }
      if (row.order.checkoutSessionId) {
        await tx.update(inventoryReservations)
          .set({ releasedAt: new Date() })
          .where(and(
            eq(inventoryReservations.checkoutSessionId, row.order.checkoutSessionId),
            isNull(inventoryReservations.releasedAt),
          ));
      }
      deliveryInfo = claimed
        .map((item, index) =>
          claimed.length > 1 ? `${index + 1}. ${item.secretValue}` : item.secretValue,
        )
        .join("\n");
    } else {
      deliveryInfo = row.product.instructionsEn.trim();
      if (!deliveryInfo) {
        return { order: row.order, status: "waiting" };
      }
    }

    const delivered = await tx
      .update(orders)
      .set({
        deliveryInfo,
        status: "delivered",
        deliveredAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(orders.id, row.order.id),
          inArray(orders.status, ["paid", "processing"]),
        ),
      )
      .returning();
    if (!delivered[0]) {
      throw new Error(`Unable to complete automatic delivery for ${row.order.orderNumber}`);
    }
    return { order: delivered[0], status: "delivered" };
  });
}
