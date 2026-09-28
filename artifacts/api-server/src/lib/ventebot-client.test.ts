import assert from "node:assert/strict";
import test from "node:test";
import { createVenteBotClient } from "./ventebot-client.ts";

test("catalog refresh sends and reuses the supplier ETag", async () => {
  const requests: Array<{ url: string; headers: Headers }> = [];
  const client = createVenteBotClient("unit-test-key", {
    minRequestIntervalMs: 0,
    fetchImpl: async (input, init) => {
      const url = String(input);
      const headers = new Headers(init?.headers);
      requests.push({ url, headers });
      if (headers.get("If-None-Match")) {
        return new Response(null, {
          status: 304,
          headers: { ETag: '"catalog-v1"' },
        });
      }
      return new Response(JSON.stringify({
        success: true,
        products: [{
          id: 10,
          name: "Digital subscription",
          description: "A test listing",
          emoji: null,
          image_url: null,
          price_usd: 3.5,
          standard_price_usd: 4,
          pricing_type: "fixed",
          special_price_expires_at: null,
          warranty_days: 7,
          delivery_type: "stock",
          stock: 4,
          api_test: false,
        }],
      }), {
        status: 200,
        headers: {
          ETag: '"catalog-v1"',
          "Content-Type": "application/json",
        },
      });
    },
  });

  const first = await client.getProducts();
  assert.equal(first.notModified, false);
  if (first.notModified) return;
  assert.equal(first.products[0]?.id, 10);
  assert.equal(first.products[0]?.stock, 4);
  assert.equal(requests[0]?.headers.get("X-Reseller-Key"), "unit-test-key");

  const second = await client.getProducts(first.etag);
  assert.equal(second.notModified, true);
  assert.equal(requests[1]?.headers.get("If-None-Match"), '"catalog-v1"');
});

test("fresh quote and repeated order submission preserve one idempotency key", async () => {
  const orderBodies: Array<Record<string, unknown>> = [];
  const client = createVenteBotClient("unit-test-key", {
    minRequestIntervalMs: 0,
    fetchImpl: async (input, init) => {
      const url = String(input);
      if (url.endsWith("/quote")) {
        return new Response(JSON.stringify({
          success: true,
          quote: {
            product_id: 10,
            quantity: 2,
            unit_price: 3.5,
            total: 7,
            delivery_type: "stock",
            stock: 5,
          },
          wallet_balance: 25,
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      orderBodies.push(body);
      return new Response(JSON.stringify({
        success: true,
        total: 7,
        order: {
          id: 95,
          status: "COMPLETED",
          product_id: 10,
          quantity: 2,
          amount_usd: 7,
          delivery_type: "stock",
          items: [
            { account_data: "item-one" },
            { account_data: "item-two" },
          ],
        },
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    },
  });

  const quote = await client.quote(10, 2);
  assert.equal(quote.totalUsd, 7);
  assert.equal(quote.stock, 5);

  const orderInput = {
    productId: 10,
    quantity: 2,
    customerReference: "KT-ORDER-1",
    idempotencyKey: "keytopia-order-order-1",
  };
  const firstOrder = await client.createOrder(orderInput);
  const replayedOrder = await client.createOrder(orderInput);
  assert.equal(firstOrder.id, replayedOrder.id);
  assert.deepEqual(orderBodies[0], orderBodies[1]);
  assert.equal(orderBodies[0]?.idempotency_key, orderInput.idempotencyKey);
});