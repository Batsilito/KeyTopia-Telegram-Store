import { createHmac, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";

const PORT = Number(process.env.PORT || 8080);
const SERVICE_TOKEN = process.env.VERIFIER_SERVICE_TOKEN;
const BINANCE_API_KEY = process.env.BINANCE_API_KEY;
const BINANCE_API_SECRET = process.env.BINANCE_API_SECRET;
const BINANCE_API_BASE_URLS = [
  "https://api.binance.com",
  "https://api-gcp.binance.com",
  "https://api1.binance.com",
  "https://api2.binance.com",
];

function json(res, status, body) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(body));
}

function amountInCents(value) {
  const normalized = String(value).trim();
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) return null;
  const [whole, fraction = ""] = normalized.split(".");
  const cents = Number(`${whole}${fraction.padEnd(2, "0").slice(0, 2)}`);
  return Number.isSafeInteger(cents) ? cents : null;
}

function validServiceToken(request) {
  if (!SERVICE_TOKEN) return false;
  const provided = request.headers.authorization?.replace(/^Bearer\s+/i, "") ?? "";
  const expected = Buffer.from(SERVICE_TOKEN);
  const actual = Buffer.from(provided);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function matchesTransaction(transaction, candidate) {
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
      String(transaction.receiverInfo?.binanceId ?? "") === candidate.receivingUid,
  );
}

async function getPayHistory(startTime, endTime) {
  if (!BINANCE_API_KEY || !BINANCE_API_SECRET) {
    throw new Error("Binance credentials are not configured");
  }
  const errors = [];
  for (const baseUrl of BINANCE_API_BASE_URLS) {
    try {
      const params = new URLSearchParams({
        endTime: String(endTime),
        limit: "100",
        recvWindow: "10000",
        startTime: String(startTime),
        timestamp: String(Date.now()),
      });
      const signature = createHmac("sha256", BINANCE_API_SECRET)
        .update(params.toString())
        .digest("hex");
      params.set("signature", signature);
      const response = await fetch(
        `${baseUrl}/sapi/v1/pay/transactions?${params.toString()}`,
        {
          headers: { "X-MBX-APIKEY": BINANCE_API_KEY },
          signal: AbortSignal.timeout(10_000),
        },
      );
      const body = await response.json();
      if (response.ok && body.code === "000000") return body.data ?? [];
      errors.push(`${new URL(baseUrl).hostname}=${response.status}/${body.code ?? "unknown"}`);
      if (response.status !== 451 && response.status < 500 && String(body.code ?? "") !== "-1021") {
        break;
      }
    } catch (error) {
      errors.push(`${new URL(baseUrl).hostname}=${error instanceof Error ? error.message : "request failed"}`);
    }
  }
  throw new Error(`Binance history request failed: ${errors.join("; ")}`);
}

async function readBody(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 32_768) throw new Error("Request body is too large");
  }
  return JSON.parse(body || "{}");
}

async function verify(request, response) {
  if (!validServiceToken(request)) {
    json(response, 401, { ok: false, error: "Unauthorized" });
    return;
  }

  let input;
  try {
    input = await readBody(request);
  } catch {
    json(response, 400, { ok: false, error: "Invalid JSON body" });
    return;
  }

  const transactionId = typeof input.transactionId === "string" ? input.transactionId.trim() : "";
  const receivingUid = typeof input.receivingUid === "string" ? input.receivingUid.trim() : "";
  const amountUsd = typeof input.amountUsd === "string" || typeof input.amountUsd === "number"
    ? String(input.amountUsd).trim()
    : "";
  const requestedAt = new Date(input.requestedAt);
  if (
    !/^\S{6,128}$/.test(transactionId) ||
    !receivingUid ||
    amountInCents(amountUsd) === null ||
    amountInCents(amountUsd) <= 0 ||
    Number.isNaN(requestedAt.getTime())
  ) {
    json(response, 400, { ok: false, error: "Invalid verification request" });
    return;
  }

  try {
    const transactions = await getPayHistory(
      Math.max(0, requestedAt.getTime() - 15 * 60 * 1000),
      Date.now() + 5_000,
    );
    const verified = transactions.some((transaction) =>
      matchesTransaction(transaction, { transactionId, amountUsd, receivingUid, requestedAt }),
    );
    json(response, 200, { ok: true, verified });
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Binance verification failed");
    json(response, 503, { ok: false, error: "Binance verification unavailable" });
  }
}

const server = createServer(async (request, response) => {
  try {
    if (request.method === "GET" && request.url === "/healthz") {
      json(response, 200, { ok: true, service: "binance-verifier" });
      return;
    }
    if (request.method === "POST" && request.url === "/verify") {
      await verify(request, response);
      return;
    }
    json(response, 404, { ok: false, error: "Not found" });
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Request failed");
    json(response, 500, { ok: false, error: "Internal server error" });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Binance verifier listening on ${PORT}`);
});