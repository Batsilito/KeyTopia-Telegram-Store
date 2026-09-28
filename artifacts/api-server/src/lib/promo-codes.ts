import { and, count, eq, gt, isNull, ne, or, sql } from "drizzle-orm";
import {
  checkoutSessions,
  db,
  promoCodeReservations,
  promoCodes,
  promoRedemptions,
} from "@workspace/db";
import {
  calculateCheckoutPromoPricing,
  calculatePromoDiscountCents,
  formatUsdCents,
} from "./promo-pricing";

function usdToCents(value: string | number) {
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.round(amount * 100) : Number.NaN;
}

type Transaction = any;

async function countActiveReservations(
  tx: Transaction,
  promoCodeId: string,
  checkoutSessionId: string,
  userId?: string,
  now = new Date(),
) {
  const conditions = [
    eq(promoCodeReservations.promoCodeId, promoCodeId),
    ne(promoCodeReservations.checkoutSessionId, checkoutSessionId),
    or(
      and(
        eq(checkoutSessions.status, "pending"),
        gt(checkoutSessions.expiresAt, now),
      ),
      eq(checkoutSessions.status, "submitted"),
    ),
  ];
  const rows = await tx
    .select({ value: count() })
    .from(promoCodeReservations)
    .innerJoin(
      checkoutSessions,
      eq(promoCodeReservations.checkoutSessionId, checkoutSessions.id),
    )
    .where(
      and(
        ...conditions,
        ...(userId ? [eq(promoCodeReservations.userId, userId)] : []),
      ),
    );
  return Number(rows[0]?.value ?? 0);
}

export type ApplyPromoCodeResult =
  | {
      ok: true;
      code: string;
      discountUsd: string;
      totalUsd: string;
    }
  | {
      ok: false;
      reason: "invalid" | "ineligible" | "limit_reached" | "checkout_unavailable";
    };

export async function reservePromoCodeForCheckout(input: {
  checkoutSessionId: string;
  userId: string;
  code: string;
}): Promise<ApplyPromoCodeResult> {
  const normalizedCode = input.code.trim().toUpperCase();
  if (!normalizedCode || normalizedCode.length > 100) {
    return { ok: false, reason: "invalid" };
  }

  return db.transaction(async (tx) => {
    const now = new Date();
    const checkoutRows = await tx
      .select()
      .from(checkoutSessions)
      .where(
        and(
          eq(checkoutSessions.id, input.checkoutSessionId),
          eq(checkoutSessions.userId, input.userId),
          eq(checkoutSessions.status, "pending"),
          isNull(checkoutSessions.paymentMethod),
          gt(checkoutSessions.expiresAt, now),
        ),
      )
      .for("update")
      .limit(1);
    const checkout = checkoutRows[0];
    if (!checkout) return { ok: false, reason: "checkout_unavailable" };

    const promoRows = await tx
      .select()
      .from(promoCodes)
      .where(sql`upper(${promoCodes.code}) = ${normalizedCode}`)
      .for("update")
      .limit(2);
    if (promoRows.length !== 1) return { ok: false, reason: "invalid" };
    const promo = promoRows[0];
    if (!promo.active || (promo.startsAt && promo.startsAt > now) || (promo.expiresAt && promo.expiresAt <= now)) {
      return { ok: false, reason: "invalid" };
    }
    if (promo.productId && promo.productId !== checkout.productId) {
      return { ok: false, reason: "ineligible" };
    }

    const subtotalCents = usdToCents(checkout.priceUsd);
    if (
      Number.isSafeInteger(subtotalCents) &&
      subtotalCents < usdToCents(promo.minPurchaseUsd)
    ) {
      return { ok: false, reason: "ineligible" };
    }
    const discountCents = calculatePromoDiscountCents({
      subtotalUsd: checkout.priceUsd,
      discountType: promo.discountType,
      value: promo.value,
    });
    if (!discountCents) return { ok: false, reason: "ineligible" };

    const redemptions = await tx
      .select({ value: count() })
      .from(promoRedemptions)
      .where(eq(promoRedemptions.promoCodeId, promo.id));
    const customerRedemptions = await tx
      .select({ value: count() })
      .from(promoRedemptions)
      .where(
        and(
          eq(promoRedemptions.promoCodeId, promo.id),
          eq(promoRedemptions.userId, input.userId),
        ),
      );
    const reservations = await countActiveReservations(
      tx,
      promo.id,
      input.checkoutSessionId,
      undefined,
      now,
    );
    const customerReservations = await countActiveReservations(
      tx,
      promo.id,
      input.checkoutSessionId,
      input.userId,
      now,
    );
    const redeemedCount = Math.max(
      Number(promo.usedCount),
      Number(redemptions[0]?.value ?? 0),
    );
    if (
      promo.maxUses !== null &&
      redeemedCount + reservations >= promo.maxUses
    ) {
      return { ok: false, reason: "limit_reached" };
    }
    if (
      promo.maxUsesPerCustomer !== null &&
      Number(customerRedemptions[0]?.value ?? 0) + customerReservations >=
        promo.maxUsesPerCustomer
    ) {
      return { ok: false, reason: "limit_reached" };
    }

    const discountUsd = formatUsdCents(discountCents);
    const pricing = calculateCheckoutPromoPricing(checkout.priceUsd, discountUsd);
    await tx
      .insert(promoCodeReservations)
      .values({
        promoCodeId: promo.id,
        checkoutSessionId: checkout.id,
        userId: input.userId,
        discountUsd,
        expiresAt: checkout.expiresAt,
      })
      .onConflictDoUpdate({
        target: promoCodeReservations.checkoutSessionId,
        set: {
          promoCodeId: promo.id,
          userId: input.userId,
          discountUsd,
          expiresAt: checkout.expiresAt,
        },
      });

    return {
      ok: true,
      code: promo.code,
      discountUsd,
      totalUsd: pricing.totalUsd,
    };
  });
}

export async function getCheckoutPromoPricing(
  checkoutSessionId: string,
  subtotalUsd: string | number,
  executor: Transaction = db,
) {
  const rows = await executor
    .select({
      code: promoCodes.code,
      discountUsd: promoCodeReservations.discountUsd,
    })
    .from(promoCodeReservations)
    .innerJoin(promoCodes, eq(promoCodeReservations.promoCodeId, promoCodes.id))
    .where(eq(promoCodeReservations.checkoutSessionId, checkoutSessionId))
    .limit(1);
  const reservation = rows[0];
  return {
    ...calculateCheckoutPromoPricing(
      subtotalUsd,
      reservation?.discountUsd ?? "0.00",
    ),
    code: reservation?.code ?? null,
  };
}

export async function removePromoCodeFromCheckout(
  checkoutSessionId: string,
  userId: string,
) {
  return db.transaction(async (tx) => {
    const checkoutRows = await tx
      .select({ id: checkoutSessions.id })
      .from(checkoutSessions)
      .where(
        and(
          eq(checkoutSessions.id, checkoutSessionId),
          eq(checkoutSessions.userId, userId),
          eq(checkoutSessions.status, "pending"),
          isNull(checkoutSessions.paymentMethod),
          gt(checkoutSessions.expiresAt, new Date()),
        ),
      )
      .for("update")
      .limit(1);
    if (!checkoutRows[0]) return false;
    await tx
      .delete(promoCodeReservations)
      .where(eq(promoCodeReservations.checkoutSessionId, checkoutSessionId));
    return true;
  });
}

export async function releasePromoCodeReservation(
  tx: Transaction,
  checkoutSessionId: string,
) {
  await tx
    .delete(promoCodeReservations)
    .where(eq(promoCodeReservations.checkoutSessionId, checkoutSessionId));
}

export async function redeemPromoCodeReservation(
  tx: Transaction,
  input: {
    checkoutSessionId: string;
    userId: string;
    orderId: string;
  },
) {
  const rows = await tx
    .select()
    .from(promoCodeReservations)
    .where(
      and(
        eq(promoCodeReservations.checkoutSessionId, input.checkoutSessionId),
        eq(promoCodeReservations.userId, input.userId),
      ),
    )
    .for("update")
    .limit(1);
  const reservation = rows[0];
  if (!reservation) return "0.00";

  await tx.insert(promoRedemptions).values({
    promoCodeId: reservation.promoCodeId,
    userId: reservation.userId,
    orderId: input.orderId,
    discountUsd: reservation.discountUsd,
  });
  await tx
    .update(promoCodes)
    .set({
      usedCount: sql`${promoCodes.usedCount} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(promoCodes.id, reservation.promoCodeId));
  await releasePromoCodeReservation(tx, input.checkoutSessionId);
  return reservation.discountUsd;
}