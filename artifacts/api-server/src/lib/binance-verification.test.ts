import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateBinancePayment,
  createBinanceFailureNotificationPlan,
  type BinancePayTransaction,
} from "./binance-verification.ts";

const now = Date.parse("2026-09-12T12:00:00.000Z");
const receivingUid = "receiver-uid";

function candidate(overrides: Partial<{
  transactionId: string;
  amountUsd: string;
  requestedAt: Date;
}> = {}) {
  return {
    transactionId: overrides.transactionId ?? "tx-wallet-001",
    amountUsd: overrides.amountUsd ?? "12.50",
    requestedAt: overrides.requestedAt ?? new Date(now - 10 * 60 * 1000),
  };
}

function transaction(overrides: Partial<BinancePayTransaction> = {}): BinancePayTransaction {
  return {
    orderType: "C2C",
    transactionId: "tx-wallet-001",
    transactionTime: now - 9 * 60 * 1000,
    amount: "12.50",
    currency: "USDT",
    success: true,
    receiverInfo: { binanceId: receivingUid },
    ...overrides,
  };
}

test("confirms an exact Binance match for a wallet top-up", () => {
  const result = evaluateBinancePayment(
    candidate(),
    [transaction()],
    receivingUid,
    now,
  );

  assert.deepEqual(result, {
    status: "confirmed",
    transactionId: "tx-wallet-001",
  });
  assert.equal(result.status === "confirmed" && result.transactionId, "tx-wallet-001");
});

test("confirms an exact Binance match for a product payment", () => {
  const result = evaluateBinancePayment(
    candidate({ transactionId: "tx-product-001", amountUsd: "49.99" }),
    [transaction({
      transactionId: "tx-product-001",
      amount: "49.99",
    })],
    receivingUid,
    now,
  );

  assert.deepEqual(result, {
    status: "confirmed",
    transactionId: "tx-product-001",
  });
});

test("fails a wrong transaction ID without authorizing a payment", () => {
  const result = evaluateBinancePayment(
    candidate({ transactionId: "tx-submitted-wrong" }),
    [transaction({ transactionId: "tx-real-payment" })],
    receivingUid,
    now,
  );

  assert.equal(result.status, "failed");
  assert.match(result.status === "failed" ? result.reason : "", /No Binance record matched/);
  assert.notEqual(result.status, "confirmed");
});

test("fails a wrong amount without authorizing a payment", () => {
  const result = evaluateBinancePayment(
    candidate({ amountUsd: "12.51" }),
    [transaction()],
    receivingUid,
    now,
  );

  assert.equal(result.status, "failed");
  assert.notEqual(result.status, "confirmed");
});

test("fails a wrong recipient without authorizing a payment", () => {
  const result = evaluateBinancePayment(
    candidate(),
    [transaction({ receiverInfo: { binanceId: "attacker-uid" } })],
    receivingUid,
    now,
  );

  assert.equal(result.status, "failed");
  assert.notEqual(result.status, "confirmed");
});

test("keeps a payment pending when Binance visibility is delayed within the grace period", () => {
  const result = evaluateBinancePayment(
    candidate({ requestedAt: new Date(now - 4 * 60 * 1000) }),
    [],
    receivingUid,
    now,
  );

  assert.deepEqual(result, { status: "pending" });
  assert.notEqual(result.status, "confirmed");
});

test("fails an unmatched payment after the grace period so no wallet transaction or order can be created", () => {
  const result = evaluateBinancePayment(
    candidate({ requestedAt: new Date(now - 6 * 60 * 1000) }),
    [],
    receivingUid,
    now,
  );

  assert.equal(result.status, "failed");
  assert.notEqual(result.status, "confirmed");
});

test("fails duplicate transaction reuse before authorizing a second payment", () => {
  const result = evaluateBinancePayment(
    candidate(),
    [transaction()],
    receivingUid,
    now,
    new Set(["tx-wallet-001"]),
  );

  assert.deepEqual(result, {
    status: "failed",
    reason: "This Binance transaction ID has already been used for another payment.",
  });
});

test("routes verification failures to both the buyer and admin without a credit or order action", () => {
  for (const paymentKind of ["wallet", "order"] as const) {
    const result = evaluateBinancePayment(
      candidate({ requestedAt: new Date(now - 6 * 60 * 1000) }),
      [transaction({ receiverInfo: { binanceId: "wrong-recipient" } })],
      receivingUid,
      now,
    );
    assert.equal(result.status, "failed");

    const plan = createBinanceFailureNotificationPlan({
      paymentKind,
      amountUsd: candidate().amountUsd,
      transactionId: candidate().transactionId,
      reason: result.status === "failed" ? result.reason : "",
    });

    assert.deepEqual(plan.targets, ["buyer", "admin"]);
    assert.equal(
      plan.customerMessageKey,
      paymentKind === "wallet"
        ? "topUpVerificationFailed"
        : "paymentVerificationFailed",
    );
    assert.notEqual(result.status, "confirmed");
  }
});