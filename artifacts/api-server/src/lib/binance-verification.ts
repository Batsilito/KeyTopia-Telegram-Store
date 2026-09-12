export type BinancePayTransaction = {
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

export type BinanceVerificationCandidate = {
  transactionId: string;
  amountUsd: string;
  requestedAt: Date;
};

export type BinanceVerificationResult =
  | {
      status: "confirmed";
      transactionId: string;
    }
  | {
      status: "pending";
    }
  | {
      status: "failed";
      reason: string;
    };

export type BinanceFailureNotificationInput = {
  paymentKind: "wallet" | "order";
  amountUsd: string;
  transactionId: string;
  reason: string;
};

export type BinanceFailureNotificationPlan = {
  customerMessageKey: "topUpVerificationFailed" | "paymentVerificationFailed";
  targets: readonly ["buyer", "admin"];
  paymentKind: "wallet" | "order";
  amountUsd: string;
  transactionId: string;
  reason: string;
};

export const BINANCE_VERIFICATION_GRACE_MS = 5 * 60 * 1000;

export function createBinanceFailureNotificationPlan(
  payment: BinanceFailureNotificationInput,
): BinanceFailureNotificationPlan {
  return {
    customerMessageKey:
      payment.paymentKind === "wallet"
        ? "topUpVerificationFailed"
        : "paymentVerificationFailed",
    targets: ["buyer", "admin"],
    ...payment,
  };
}

function amountInCents(value: string | number) {
  const normalized = String(value).trim();
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) return null;
  const [whole, fraction = ""] = normalized.split(".");
  const cents = Number(`${whole}${fraction.padEnd(2, "0").slice(0, 2)}`);
  return Number.isSafeInteger(cents) ? cents : null;
}

export function matchesBinanceTransaction(
  transaction: BinancePayTransaction,
  candidate: BinanceVerificationCandidate,
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

export function evaluateBinancePayment(
  candidate: BinanceVerificationCandidate,
  transactions: BinancePayTransaction[],
  receivingUid: string,
  now: number,
  claimedTransactionIds: ReadonlySet<string> = new Set(),
): BinanceVerificationResult {
  const match = transactions.find((transaction) =>
    matchesBinanceTransaction(transaction, candidate, receivingUid),
  );

  if (!match?.transactionId) {
    return now - candidate.requestedAt.getTime() < BINANCE_VERIFICATION_GRACE_MS
      ? { status: "pending" }
      : {
          status: "failed",
          reason:
            "No Binance record matched the submitted transaction ID, amount, currency, recipient, and payment type.",
        };
  }

  if (claimedTransactionIds.has(match.transactionId)) {
    return {
      status: "failed",
      reason: "This Binance transaction ID has already been used for another payment.",
    };
  }

  return {
    status: "confirmed",
    transactionId: match.transactionId,
  };
}