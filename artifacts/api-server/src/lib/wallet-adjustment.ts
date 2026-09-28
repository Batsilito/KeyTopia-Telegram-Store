const USD_CENTS_PATTERN = /^(-?)(\d+)(?:\.(\d{1,2}))?$/;

export const MAX_USD_CENTS = 999_999_999_999n;

export function parseUsdCents(value: string | number): bigint | null {
  const match = USD_CENTS_PATTERN.exec(String(value));
  if (!match) return null;

  const [, sign, whole, fraction = ""] = match;
  const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
  return sign === "-" ? -cents : cents;
}

export function formatUsdCents(cents: bigint): string {
  const sign = cents < 0n ? "-" : "";
  const absolute = cents < 0n ? -cents : cents;
  const whole = absolute / 100n;
  const fraction = String(absolute % 100n).padStart(2, "0");
  return `${sign}${whole}.${fraction}`;
}