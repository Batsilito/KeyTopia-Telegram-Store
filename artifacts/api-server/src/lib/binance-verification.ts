export type BinancePayTransaction = {
  orderType?: string;
  transactionId?: string | number;
  orderId?: string | number;
  prepayId?: string | number;
  merchantTradeNo?: string | number;
  transactionTime?: number;
  amount?: string;
  currency?: string;
  success?: boolean;
  receiverInfo?: {
    binanceId?: string;
    accountId?: string;
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

export const BINANCE_VERIFICATION_GRACE_MS = 20 * 1000;
const SUPPORTED_INCOMING_ORDER_TYPES = new Set(["C2C", "PAY"]);

function normalizedIdentifier(value: string | number | undefined) {
  return String(value ?? "").trim();
}

function submittedIdentifierMatches(
  transaction: BinancePayTransaction,
  submittedIdentifier: string,
) {
  return [
    transaction.orderId,
    transaction.prepayId,
    transaction.merchantTradeNo,
    transaction.transactionId,
  ].some(
    (identifier) => normalizedIdentifier(identifier) === submittedIdentifier.trim(),
  );
}

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
  receivingIdentifier: string,
) {
  const expectedCents = amountInCents(candidate.amountUsd);
  const transactionCents = amountInCents(transaction.amount ?? "");
  const receiverMatches = [
    transaction.receiverInfo?.binanceId,
    transaction.receiverInfo?.accountId,
  ].some((identifier) => String(identifier ?? "").trim() === receivingIdentifier);
  return Boolean(
    submittedIdentifierMatches(transaction, candidate.transactionId) &&
      transaction.orderType &&
      SUPPORTED_INCOMING_ORDER_TYPES.has(transaction.orderType) &&
      transaction.success !== false &&
      transaction.transactionTime &&
      transaction.transactionTime >= candidate.requestedAt.getTime() - 60_000 &&
      transaction.currency === "USDT" &&
      transactionCents !== null &&
      expectedCents !== null &&
      transactionCents === expectedCents &&
      transactionCents > 0 &&
      receiverMatches,
  );
}

function mismatchReason(
  transaction: BinancePayTransaction | undefined,
  candidate: BinanceVerificationCandidate,
  receivingIdentifier: string,
) {
  if (!transaction) {
    return "No Binance record matched the submitted transaction ID.";
  }
  if (!transaction.orderType || !SUPPORTED_INCOMING_ORDER_TYPES.has(transaction.orderType)) {
    return "The Binance transaction type is not an accepted incoming Pay transfer.";
  }
  if (transaction.success === false) {
    return "The Binance transaction is not marked successful.";
  }
  if (
    !transaction.transactionTime ||
    transaction.transactionTime < candidate.requestedAt.getTime() - 60_000
  ) {
    return "The Binance transaction time does not match this payment request.";
  }
  if (transaction.currency !== "USDT") {
    return "The Binance transaction currency is not USDT.";
  }
  const expectedCents = amountInCents(candidate.amountUsd);
  const transactionCents = amountInCents(transaction.amount ?? "");
  if (
    expectedCents === null ||
    transactionCents === null ||
    transactionCents <= 0 ||
    transactionCents !== expectedCents
  ) {
    return "The Binance transaction amount does not match the requested amount.";
  }
  const receiverMatches = [
    transaction.receiverInfo?.binanceId,
    transaction.receiverInfo?.accountId,
  ].some((identifier) => String(identifier ?? "").trim() === receivingIdentifier);
  if (!receiverMatches) {
    return "The Binance transaction recipient does not match the configured Binance UID or Pay ID.";
  }
  return "The Binance transaction did not satisfy all verification checks.";
}

export function evaluateBinancePayment(
  candidate: BinanceVerificationCandidate,
  transactions: BinancePayTransaction[],
  receivingUid: string,
  now: number,
  claimedTransactionIds: ReadonlySet<string> = new Set(),
): BinanceVerificationResult {
  const submittedTransaction = transactions.find(
    (transaction) => submittedIdentifierMatches(transaction, candidate.transactionId),
  );
  const match =
    submittedTransaction &&
    matchesBinanceTransaction(submittedTransaction, candidate, receivingUid)
      ? submittedTransaction
      : undefined;

  if (!match) {
    return now - candidate.requestedAt.getTime() < BINANCE_VERIFICATION_GRACE_MS
      ? { status: "pending" }
      : {
          status: "failed",
          reason: mismatchReason(
            submittedTransaction,
            candidate,
            receivingUid,
          ),
        };
  }

  if (claimedTransactionIds.has(candidate.transactionId)) {
    return {
      status: "failed",
      reason: "This Binance transaction ID has already been used for another payment.",
    };
  }

  return {
    status: "confirmed",
    transactionId: candidate.transactionId,
  };
}