import { createHmac } from "node:crypto";
import { and, asc, eq, isNull } from "drizzle-orm";
import {
  binanceTransactionClaims,
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
import {
  BINANCE_VERIFICATION_GRACE_MS,
  evaluateBinancePayment,
  type BinancePayTransaction,
} from "./binance-verification";

const BINANCE_API_BASE_URLS = [
  "https://api.binance.com",
  "https://api-gcp.binance.com",
  "https://api1.binance.com",
  "https://api2.binance.com",
] as const;
const POLL_LOOKBACK_MS = 15 * 60 * 1000;
const MAX_PENDING_PAYMENTS = 100;

export type BinanceApiHostDiagnostic = {
  host: string;
  publicStatus: number | null;
  publicReachable: boolean;
  payHistoryStatus: number | null;
  payHistoryAccepted: boolean;
  payHistoryCode: string | null;
  message: string | null;
  error: string | null;
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

export type FailedBinancePayment = CustomerNotification & {
  kind: "failure";
  paymentKind: "wallet" | "order";
  amountUsd: string;
  transactionId: string;
  reason: string;
};

export type BinancePaymentProcessingResult =
  | ConfirmedBinancePayment
  | FailedBinancePayment;

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

  const errors: string[] = [];
  for (const baseUrl of BINANCE_API_BASE_URLS) {
    try {
      const params = new URLSearchParams({
        endTime: String(endTime),
        limit: "100",
        recvWindow: "10000",
        startTime: String(startTime),
        timestamp: String(Date.now()),
      });
      const signature = createHmac("sha256", apiSecret)
        .update(params.toString())
        .digest("hex");
      params.set("signature", signature);
      const response = await fetch(
        `${baseUrl}/sapi/v1/pay/transactions?${params.toString()}`,
        {
          headers: {
            "X-MBX-APIKEY": apiKey,
          },
          signal: AbortSignal.timeout(10_000),
        },
      );
      const body = (await response.json()) as BinancePayHistoryResponse;
      if (response.ok && body.code === "000000") {
        return body.data ?? [];
      }
      errors.push(
        `${new URL(baseUrl).hostname}=${response.status}/${body.code ?? "unknown"} ${body.message ?? response.statusText}`,
      );
      if (
        response.status !== 451 &&
        response.status < 500 &&
        String(body.code ?? "") !== "-1021"
      ) break;
    } catch (error) {
      errors.push(
        `${new URL(baseUrl).hostname}=${error instanceof Error ? error.message : "request failed"}`,
      );
    }
  }
  throw new Error(`Binance Pay history request failed: ${errors.join("; ")}`);
}

export async function testBinanceApiConnectivity() {
  const apiKey = process.env.BINANCE_API_KEY;
  const apiSecret = process.env.BINANCE_API_SECRET;
  const testedAt = new Date().toISOString();

  const hosts = await Promise.all(
    BINANCE_API_BASE_URLS.map(async (baseUrl): Promise<BinanceApiHostDiagnostic> => {
      const host = new URL(baseUrl).hostname;
      const diagnostic: BinanceApiHostDiagnostic = {
        host,
        publicStatus: null,
        publicReachable: false,
        payHistoryStatus: null,
        payHistoryAccepted: false,
        payHistoryCode: null,
        message: null,
        error: null,
      };

      try {
        const publicResponse = await fetch(`${baseUrl}/api/v3/time`, {
          signal: AbortSignal.timeout(10_000),
        });
        diagnostic.publicStatus = publicResponse.status;
        diagnostic.publicReachable = publicResponse.ok;
      } catch (error) {
        diagnostic.error = error instanceof Error ? error.message : "Public request failed";
      }

      if (!apiKey || !apiSecret) {
        diagnostic.error ??= "Binance credentials are not configured";
        return diagnostic;
      }

      try {
        const now = Date.now();
        const params = new URLSearchParams({
          endTime: String(now + 5_000),
          limit: "1",
          recvWindow: "10000",
          startTime: String(now - POLL_LOOKBACK_MS),
          timestamp: String(now),
        });
        params.set(
          "signature",
          createHmac("sha256", apiSecret).update(params.toString()).digest("hex"),
        );
        const response = await fetch(
          `${baseUrl}/sapi/v1/pay/transactions?${params.toString()}`,
          {
            headers: { "X-MBX-APIKEY": apiKey },
            signal: AbortSignal.timeout(10_000),
          },
        );
        const body = (await response.json().catch(() => ({}))) as {
          code?: string | number;
          message?: string;
          msg?: string;
        };
        diagnostic.payHistoryStatus = response.status;
        diagnostic.payHistoryAccepted = response.ok && body.code === "000000";
        diagnostic.payHistoryCode =
          body.code === undefined ? null : String(body.code);
        diagnostic.message = body.message ?? body.msg ?? null;
      } catch (error) {
        diagnostic.error =
          error instanceof Error ? error.message : "Signed request failed";
      }

      return diagnostic;
    }),
  );

  return {
    testedAt,
    reachable: hosts.some((host) => host.payHistoryAccepted),
    hosts,
  };
}

async function verifyThroughRailway(
  candidate: { transactionId: string; amountUsd: string; requestedAt: Date },
  receivingUid: string,
) {
  const verifierUrl = process.env.BINANCE_VERIFIER_URL?.trim();
  const verifierToken = process.env.VERIFIER_SERVICE_TOKEN;
  if (!verifierUrl || !verifierToken) return null;
  const response = await fetch(`${verifierUrl.replace(/\/+$/, "")}/verify`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${verifierToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      transactionId: candidate.transactionId,
      amountUsd: candidate.amountUsd,
      requestedAt: candidate.requestedAt.toISOString(),
      receivingUid,
    }),
    signal: AbortSignal.timeout(20_000),
  });
  const body = (await response.json()) as { ok?: boolean; verified?: boolean; error?: string };
  if (!response.ok || body.ok !== true) {
    throw new Error(`Remote Binance verifier failed: ${body.error ?? response.statusText}`);
  }
  return body.verified === true;
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
    const transactionClaim = await tx
      .insert(binanceTransactionClaims)
      .values({
        transactionId,
        purpose: "wallet_top_up",
        referenceId: topUp.id,
      })
      .onConflictDoNothing()
      .returning({ id: binanceTransactionClaims.id });
    if (!transactionClaim[0]) return null;

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
    if (!claimed[0]) {
      throw new Error(`Unable to confirm wallet top-up ${topUp.id}`);
    }

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
    const transactionClaim = await tx
      .insert(binanceTransactionClaims)
      .values({
        transactionId,
        purpose: "product_payment",
        referenceId: payment.id,
      })
      .onConflictDoNothing()
      .returning({ id: binanceTransactionClaims.id });
    if (!transactionClaim[0]) return null;

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
    if (!claimed[0]) {
      throw new Error(`Unable to confirm product payment ${payment.id}`);
    }

    const checkoutRows = await tx
      .select({
        checkout: checkoutSessions,
        deliveryType: products.deliveryType,
        stockType: products.stockType,
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
        stockTypeSnapshot: checkout.stockType,
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

async function failWalletTopUp(
  topUp: {
    id: string;
    userId: string;
    amountUsd: string;
    submittedTransactionId: string;
  },
  reason: string,
): Promise<FailedBinancePayment | null> {
  return db.transaction(async (tx) => {
    const failed = await tx
      .update(walletTopUps)
      .set({
        status: "verification_failed",
        verificationFailureReason: reason,
        updatedAt: new Date(),
      })
      .where(and(eq(walletTopUps.id, topUp.id), eq(walletTopUps.status, "pending")))
      .returning({ id: walletTopUps.id });
    if (!failed[0]) return null;
    const customer = await tx
      .select({ telegramUserId: users.telegramUserId, language: users.language })
      .from(users)
      .where(eq(users.id, topUp.userId))
      .limit(1);
    if (!customer[0]) return null;
    return {
      kind: "failure",
      paymentKind: "wallet",
      telegramUserId: customer[0].telegramUserId,
      language: customer[0].language,
      amountUsd: topUp.amountUsd,
      transactionId: topUp.submittedTransactionId,
      reason,
    };
  });
}

async function failProductPayment(
  payment: {
    id: string;
    userId: string;
    amountUsd: string;
    submittedTransactionId: string;
  },
  reason: string,
): Promise<FailedBinancePayment | null> {
  return db.transaction(async (tx) => {
    const failed = await tx
      .update(payments)
      .set({
        status: "verification_failed",
        verificationFailureReason: reason,
        updatedAt: new Date(),
      })
      .where(and(eq(payments.id, payment.id), eq(payments.status, "submitted")))
      .returning({ id: payments.id });
    if (!failed[0]) return null;
    const customer = await tx
      .select({ telegramUserId: users.telegramUserId, language: users.language })
      .from(users)
      .where(eq(users.id, payment.userId))
      .limit(1);
    if (!customer[0]) return null;
    return {
      kind: "failure",
      paymentKind: "order",
      telegramUserId: customer[0].telegramUserId,
      language: customer[0].language,
      amountUsd: payment.amountUsd,
      transactionId: payment.submittedTransactionId,
      reason,
    };
  });
}

async function hasClaimedTransaction(transactionId: string) {
  const claims = await db
    .select({ id: binanceTransactionClaims.id })
    .from(binanceTransactionClaims)
    .where(eq(binanceTransactionClaims.transactionId, transactionId))
    .limit(1);
  return Boolean(claims[0]);
}

export async function pollBinancePayments(): Promise<BinancePaymentProcessingResult[]> {
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
  const remoteVerifierConfigured = Boolean(
    process.env.BINANCE_VERIFIER_URL?.trim() && process.env.VERIFIER_SERVICE_TOKEN,
  );
  if (
    !remoteVerifierConfigured &&
    (!process.env.BINANCE_API_KEY || !process.env.BINANCE_API_SECRET)
  ) {
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
  const usedTransactionIds = new Set<string>();
  if (remoteVerifierConfigured) {
    const processed: BinancePaymentProcessingResult[] = [];
    const now = Date.now();
    for (const candidate of candidates) {
      if (usedTransactionIds.has(candidate.transactionId)) continue;
      const verified = await verifyThroughRailway(
        {
          transactionId: candidate.transactionId,
          amountUsd: candidate.amountUsd,
          requestedAt: candidate.requestedAt,
        },
        receivingUid,
      );
      if (!verified) {
        if (now - candidate.requestedAt.getTime() < BINANCE_VERIFICATION_GRACE_MS) continue;
        const reason =
          "Binance could not find a matching successful payment to the configured recipient for the submitted transaction ID and amount.";
        const failed =
          candidate.kind === "wallet"
            ? await failWalletTopUp(candidate.record, reason)
            : await failProductPayment(
                {
                  id: candidate.record.id,
                  userId: candidate.record.userId,
                  amountUsd: candidate.amountUsd,
                  submittedTransactionId: candidate.transactionId,
                },
                reason,
              );
        if (failed) processed.push(failed);
        continue;
      }
      if (await hasClaimedTransaction(candidate.transactionId)) {
        const reason = "This Binance transaction ID has already been used for another payment.";
        const failed =
          candidate.kind === "wallet"
            ? await failWalletTopUp(candidate.record, reason)
            : await failProductPayment(
                {
                  id: candidate.record.id,
                  userId: candidate.record.userId,
                  amountUsd: candidate.amountUsd,
                  submittedTransactionId: candidate.transactionId,
                },
                reason,
              );
        if (failed) processed.push(failed);
        continue;
      }
      if (candidate.kind === "wallet") {
        const result = await confirmWalletTopUp(candidate.record, candidate.transactionId);
        if (result) {
          usedTransactionIds.add(candidate.transactionId);
          processed.push({
            kind: "wallet",
            ...result,
            amountUsd: candidate.amountUsd,
            transactionId: candidate.transactionId,
          });
        }
      } else {
        const result = await confirmProductPayment(candidate.record, candidate.transactionId);
        if (result) {
          usedTransactionIds.add(candidate.transactionId);
          processed.push({
            kind: "order",
            telegramUserId: result.telegramUserId,
            language: result.language,
            amountUsd: candidate.amountUsd,
            transactionId: candidate.transactionId,
            orderNumber: result.order.orderNumber,
            orderId: result.order.id,
            userId: candidate.record.userId,
          });
        }
      }
    }
    return processed;
  }
  const transactions = await getPayHistory(
    Math.max(0, earliestRequest - POLL_LOOKBACK_MS),
    Date.now() + 5_000,
  );
  if (!transactions) return [];

  const claimedTransactionIds = new Set(
    (
      await db
        .select({ transactionId: binanceTransactionClaims.transactionId })
        .from(binanceTransactionClaims)
    ).map((claim) => claim.transactionId),
  );
  const processed: BinancePaymentProcessingResult[] = [];
  const now = Date.now();
  for (const candidate of candidates) {
    if (usedTransactionIds.has(candidate.transactionId)) continue;
    const decision = evaluateBinancePayment(
      candidate,
      transactions,
      receivingUid,
      now,
      new Set([...claimedTransactionIds, ...usedTransactionIds]),
    );
    if (decision.status === "pending") continue;
    if (decision.status === "failed") {
      const reason = decision.reason;
      const failed =
        candidate.kind === "wallet"
          ? await failWalletTopUp(candidate.record, reason)
          : await failProductPayment(
              {
                id: candidate.record.id,
                userId: candidate.record.userId,
                amountUsd: candidate.amountUsd,
                submittedTransactionId: candidate.transactionId,
              },
              reason,
            );
      if (failed) processed.push(failed);
      continue;
    }
    const match = decision.transactionId;

    if (candidate.kind === "wallet") {
      const result = await confirmWalletTopUp(candidate.record, match);
      if (result) {
        usedTransactionIds.add(match);
        processed.push({
          kind: "wallet",
          ...result,
          amountUsd: candidate.amountUsd,
          transactionId: match,
        });
      }
    } else {
      const result = await confirmProductPayment(candidate.record, match);
      if (result) {
        usedTransactionIds.add(match);
        processed.push({
          kind: "order",
          telegramUserId: result.telegramUserId,
          language: result.language,
          amountUsd: candidate.amountUsd,
          transactionId: match,
          orderNumber: result.order.orderNumber,
          orderId: result.order.id,
          userId: candidate.record.userId,
        });
      }
    }
  }
  return processed;
}