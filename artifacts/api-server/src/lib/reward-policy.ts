function parseScaledDecimal(value: string | number, scale: number): bigint | null {
  const normalized = String(value).trim();
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) return null;
  const [whole, fraction = ""] = normalized.split(".");
  const units = BigInt(`${whole}${fraction.padEnd(scale, "0").slice(0, scale)}`);
  return units;
}

export function calculatePercentageAmount(
  amountUsd: string | number,
  percent: string | number,
): string {
  const cents = parseScaledDecimal(amountUsd, 2);
  const basisPoints = parseScaledDecimal(percent, 2);
  if (cents === null || basisPoints === null || cents <= 0n || basisPoints <= 0n) {
    return "0.00";
  }
  const rewardCents = (cents * basisPoints + 5_000n) / 10_000n;
  return `${rewardCents / 100n}.${String(rewardCents % 100n).padStart(2, "0")}`;
}

export function rewardsAreEligible(orderStatus: string) {
  return orderStatus === "delivered";
}
