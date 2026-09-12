import { createHmac } from "node:crypto";
import { and, asc, eq, isNull } from "drizzle-orm";
import {
  checkoutSessions,
  db,
  orders,
  paymentMethods,
  payments,
  products,
  users,
  walletTopUps,
  walletTransactions,
} from "@workspace/db";
import { logger } from "./logger";

const BINANCE_API_BASE_URL = "https://api.binance.com";
const POLL_LOOKBACK_MS = 15 * 60 * 1000;
const MAX_PENDING_PAYMENTS = 100;

type BinancePayTransaction = {
  orderType?: string;
  transactionId?: string;
  transactionTime?: number;
  amount?: string;
  currency?: string;
  success?: boolean;
  receiverInfo?: {
    binanceId?: string;
    type?: string;
  };
};

type BinancePayHistoryResponse = {
  code?: string;
  message?: string;
  data?: BinancePayTransaction[];
};

type CustomerNotification = {
  telegramUserId: string;
  language: "en" | "ar";
};

export type ConfirmedBinanceWalletTopUp = CustomerNotification & {
  kind: "wallet";
  amountUsd: string;
  transactionId: string;
};

export type ConfirmedBinanceOrderPayment = CustomerNotification & {
  kind: "order";
  amountUsd: string;
  transactionId: string;
  orderNumber: string;
  orderId: string;
  userId: string;
};

export type ConfirmedBinancePayment =
  | ConfirmedBinanceWalletTopUp
  | ConfirmedBinanceOrderPayment;

function amountInCents(value: string | number) {
  const normalized = String(value).trim();
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) return null;
  const [whole, fraction = ""] = normalized.split(".");
  const cents = Number(`${whole}${fraction.padEnd(2, "0").slice(0, 2)}`);
  return Number.isSafeInteger(cents) ? cents : null;
}

async function getReceivingBinanceUid() {
  const configured = await db
    .select({ paymentIdentifier: paymentMethods.paymentIdentifier })
    .from(paymentMethods)
    .where(and(eq(paymentMethods.method, "binance"), eq(paymentMethods.enabled, true)))
    .limit(1);
  return configured[0]?.paymentIdentifier?.trim() || null;
}

async function getPayHistory(startTime: number, endTime: number) {
  const apiKey = process.env.BINANCE_API_KEY;
  const apiSecret = process.env.BINANCE_API_SECRET;
  if (!apiKey || !apiSecret) return null;

  const params = new URLSearchParams({
    endTime: String(endTime),
    limit: "100",
    recvWindow: "5000",
    startTime: String(startTime),
    timestamp: String(Date.now()),
  });
  const signature = createHmac("sha256", apiSecret)
    .update(params.toString())
    .digest("hex");
  params.set("signature", signature);

  const response = await fetch(
    `${BINANCE_API_BASE_URL}/sapi/v1/pay/transactions?${params.toString()}`,
    {
      headers: {
        "X-MBX-APIKEY": apiKey,
      },
      signal: AbortSignal.timeout(10_000),
    },
  );
  const body = (await response.json()) as BinancePayHistoryResponse;
  if (!response.ok || body.code !== "000000") {
    throw new Error(
      `Binance Pay history request failed (${response.status}): ${body.code ?? "unknown"} ${body.message ?? response.statusText}`,
    );
  }
  return body.data ?? [];
}

function matchesTransaction(
  transaction: BinancePayTransaction,
  candidate: { transactionId: string; amountUsd: string; requestedAt: Date },
  receivingUid: string,
) {
  const expectedCents = amountInCents(candidate.amountUsd);
  const transactionCents = amountInCents(transaction.amount ?? "");
  return Boolean(
    transaction.transactionId === candidate.transactionId &&
      transaction.orderType === "C2C" &&
      transaction.success !== false &&
      transaction.transactionTime &&
      transaction.transactionTime >= candidate.requestedAt.getTime() - 60_000 &&
      transaction.currency === "USDT" &&
      transactionCents !== null &&
      expectedCents !== null &&
      transactionCents === expectedCents &&
      transactionCents > 0 &&
      String(transaction.receiverInfo?.binanceId ?? "") === receivingUid,
  );
}

async function confirmWalletTopUp(
  topUp: {
    id: string;
    userId: string;
    amountUsd: string;
    submittedTransactionId: string;
  },
  transactionId: string,
) {
  return db.transaction(async (tx) => {
    const claimed = await tx
      .update(walletTopUps)
      .set({
        status: "confirmed",
        confirmedBinanceTransactionId: transactionId,
        confirmedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(walletTopUps.id, topUp.id),
          eq(walletTopUps.status, "pending"),
          isNull(walletTopUps.confirmedBinanceTransactionId),
        ),
      )
      .returning();
    if (!claimed[0]) return null;

    await tx.insert(walletTransactions).values({
      userId: topUp.userId,
      type: "top_up",
      amountUsd: topUp.amountUsd,
      reason: "Automatic Binance UID wallet top-up",
      reference: `binance:${transactionId}`,
    });
    const customer = await tx
      .select({ telegramUserId: users.telegramUserId, language: users.language })
      .from(users)
      .where(eq(users.id, topUp.userId))
      .limit(1);
    return customer[0]
      ? {
          telegramUserId: customer[0].telegramUserId,
          language: customer[0].language,
        }
      : null;
  });
}

async function confirmProductPayment(
  payment: {
    id: string;
    userId: string;
    checkoutSessionId: string;
    amountUsd: string;
    submittedTransactionId: string | null;
  },
  transactionId: string,
) {
  return db.transaction(async (tx) => {
    const claimed = await tx
      .update(payments)
      .set({
        status: "confirmed",
        reviewedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(payments.id, payment.id),
          eq(payments.status, "submitted"),
          isNull(payments.orderId),
        ),
      )
      .returning();
    if (!claimed[0]) return null;

    const checkoutRows = await tx
      .select({
        checkout: checkoutSessions,
        deliveryType: products.deliveryType,
      })
      .from(checkoutSessions)
      .innerJoin(products, eq(checkoutSessions.productId, products.id))
      .where(eq(checkoutSessions.id, payment.checkoutSessionId))
      .limit(1);
    const checkout = checkoutRows[0];
    if (!checkout) {
      throw new Error(`Checkout session ${payment.checkoutSessionId} is missing`);
    }

    const orderRows = await tx
      .insert(orders)
      .values({
        orderNumber: checkout.checkout.reference,
        userId: payment.userId,
        productId: checkout.checkout.productId,
        checkoutSessionId: checkout.checkout.id,
        productNameSnapshot: checkout.checkout.productNameSnapshot,
        durationSnapshot: checkout.checkout.durationSnapshot,
        warrantySnapshot: checkout.checkout.warrantySnapshot,
        quantity: checkout.checkout.quantity,
        priceUsd: checkout.checkout.priceUsd,
        egpAmount: claimed[0].egpAmount,
        exchangeRate: claimed[0].exchangeRate,
        paymentMethod: claimed[0].paymentMethod,
        status: "paid",
        deliveryType: checkout.deliveryType,
      })
      .returning();
    const order = orderRows[0];
    if (!order) throw new Error("Unable to create paid order");

    await tx
      .update(payments)
      .set({ orderId: order.id, updatedAt: new Date() })
      .where(eq(payments.id, payment.id));
    await tx
      .update(checkoutSessions)
      .set({ status: "confirmed", updatedAt: new Date() })
      .where(eq(checkoutSessions.id, checkout.checkout.id));

    const customer = await tx
      .select({ telegramUserId: users.telegramUserId, language: users.language })
      .from(users)
      .where(eq(users.id, payment.userId))
      .limit(1);
    return customer[0]
      ? {
          order,
          telegramUserId: customer[0].telegramUserId,
          language: customer[0].language,
        }
      : { order, telegramUserId: "", language: "en" as const };
  });
}

export async function pollBinancePayments(): Promise<ConfirmedBinancePayment[]> {
  const [receivingUid, pendingTopUps, pendingPayments] = await Promise.all([
    getReceivingBinanceUid(),
    db
      .select({
        id: walletTopUps.id,
        userId: walletTopUps.userId,
        amountUsd: walletTopUps.amountUsd,
        submittedTransactionId: walletTopUps.submittedTransactionId,
        requestedAt: walletTopUps.requestedAt,
      })
      .from(walletTopUps)
      .where(
        and(
          eq(walletTopUps.status, "pending"),
          isNull(walletTopUps.confirmedBinanceTransactionId),
        ),
      )
      .orderBy(asc(walletTopUps.requestedAt))
      .limit(MAX_PENDING_PAYMENTS),
    db
      .select({
        id: payments.id,
        userId: payments.userId,
        checkoutSessionId: payments.checkoutSessionId,
        amountUsd: payments.usdAmount,
        submittedTransactionId: payments.transactionReference,
        submittedAt: payments.submittedAt,
      })
      .from(payments)
      .where(
        and(
          eq(payments.paymentMethod, "binance"),
          eq(payments.status, "submitted"),
          isNull(payments.orderId),
        ),
      )
      .orderBy(asc(payments.submittedAt))
      .limit(MAX_PENDING_PAYMENTS),
  ]);

  if (!receivingUid || (pendingTopUps.length === 0 && pendingPayments.length === 0)) {
    return [];
  }
  if (!process.env.BINANCE_API_KEY || !process.env.BINANCE_API_SECRET) {
    logger.warn("Binance payment polling is disabled because API credentials are missing");
    return [];
  }

  const candidates = [
    ...pendingTopUps.map((topUp) => ({
      kind: "wallet" as const,
      record: topUp,
      transactionId: topUp.submittedTransactionId,
      amountUsd: topUp.amountUsd,
      requestedAt: topUp.requestedAt,
    })),
    ...pendingPayments
      .filter((payment) => payment.submittedTransactionId && payment.submittedAt)
      .map((payment) => ({
        kind: "order" as const,
        record: payment,
        transactionId: payment.submittedTransactionId!,
        amountUsd: payment.amountUsd,
        requestedAt: payment.submittedAt!,
      })),
  ];
  const earliestRequest = Math.min(...candidates.map((candidate) => candidate.requestedAt.getTime()));
  const transactions = await getPayHistory(
    Math.max(0, earliestRequest - POLL_LOOKBACK_MS),
    Date.now() + 5_000,
  );
  if (!transactions) return [];

  const confirmed: ConfirmedBinancePayment[] = [];
  const usedTransactionIds = new Set<string>();
  for (const candidate of candidates) {
    if (usedTransactionIds.has(candidate.transactionId)) continue;
    const match = transactions.find((transaction) =>
      matchesTransaction(transaction, candidate, receivingUid),
    );
    if (!match?.transactionId) continue;

    if (candidate.kind === "wallet") {
      const result = await confirmWalletTopUp(candidate.record, match.transactionId);
      if (result) {
        usedTransactionIds.add(match.transactionId);
        confirmed.push({
          kind: "wallet",
          ...result,
          amountUsd: candidate.amountUsd,
          transactionId: match.transactionId,
        });
      }
    } else {
      const result = await confirmProductPayment(candidate.record, match.transactionId);
      if (result) {
        usedTransactionIds.add(match.transactionId);
        confirmed.push({
          kind: "order",
          telegramUserId: result.telegramUserId,
          language: result.language,
          amountUsd: candidate.amountUsd,
          transactionId: match.transactionId,
          orderNumber: result.order.orderNumber,
          orderId: result.order.id,
          userId: candidate.record.userId,
        });
      }
    }
  }
  return confirmed;
}