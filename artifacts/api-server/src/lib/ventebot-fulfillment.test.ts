import assert from "node:assert/strict";
import test from "node:test";
import { evaluateVenteBotProviderOrder } from "./ventebot-provider-order.ts";
import type { VenteBotOrder } from "./ventebot-client.ts";

function supplierOrder(
  changes: Partial<VenteBotOrder> = {},
): VenteBotOrder {
  return {
    id: 91,
    status: "COMPLETED",
    productId: 12,
    quantity: 2,
    amountUsd: 18,
    deliveryType: "stock",
    items: [
      { accountData: "  access-code-1  " },
      { accountData: "access-code-2" },
    ],
    ...changes,
  };
}

test("completed provider orders produce customer delivery only with every item", () => {
  assert.deepEqual(
    evaluateVenteBotProviderOrder(supplierOrder()),
    {
      kind: "completed",
      deliveryInfo: "1. access-code-1\n2. access-code-2",
    },
  );
  assert.equal(
    evaluateVenteBotProviderOrder(supplierOrder({
      items: [{ accountData: "one-item" }],
    })).kind,
    "failed",
  );
  assert.equal(
    evaluateVenteBotProviderOrder(supplierOrder({
      items: [
        { accountData: "one-item" },
        { accountData: "  " },
      ],
    })).kind,
    "failed",
  );
});

test("pending delivery remains recoverable and activation orders fail safely", () => {
  assert.deepEqual(
    evaluateVenteBotProviderOrder(supplierOrder({
      status: "PAID_PENDING_DELIVERY",
      items: [],
    })),
    { kind: "waiting" },
  );
  assert.equal(
    evaluateVenteBotProviderOrder(supplierOrder({
      status: "AWAITING_ACTIVATION_INFO",
      items: [],
    })).kind,
    "failed",
  );
  assert.equal(
    evaluateVenteBotProviderOrder(supplierOrder({
      status: "CANCELLED",
      items: [],
    })).kind,
    "failed",
  );
});