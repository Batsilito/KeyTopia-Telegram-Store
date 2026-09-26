function toCents(value: string | number): number {
  const normalized = typeof value === "number" ? value.toFixed(2) : value;
  const negative = normalized.startsWith("-");
  const unsigned = negative ? normalized.slice(1) : normalized;
  const [whole, fraction = ""] = unsigned.split(".");
  const cents = Number(whole) * 100 + Number((fraction + "00").slice(0, 2));
  return negative ? -cents : cents;
}

function fromCents(value: number): string {
  return `${value < 0 ? "-" : ""}${Math.floor(Math.abs(value) / 100)}.${String(
    Math.abs(value) % 100,
  ).padStart(2, "0")}`;
}

export function sumKnownUnitCosts(costs: Array<string | null>): string | null {
  if (costs.length === 0 || costs.some((cost) => cost === null)) return null;
  const totalCents = costs.reduce(
    (total, cost) => total + toCents(cost!),
    0,
  );
  return fromCents(totalCents);
}

export function getRealizedProfitUsd(
  revenueUsd: string | number,
  acquisitionCostUsd: string | null,
): number | null {
  if (acquisitionCostUsd === null) return null;
  return (toCents(revenueUsd) - toCents(acquisitionCostUsd)) / 100;
}