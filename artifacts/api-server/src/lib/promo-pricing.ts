function usdToCents(value: string | number) {
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.round(amount * 100) : Number.NaN;
}

export function formatUsdCents(cents: number) {
  return (cents / 100).toFixed(2);
}

export function calculatePromoDiscountCents(input: {
  subtotalUsd: string | number;
  discountType: string;
  value: string | number;
}) {
  const subtotalCents = usdToCents(input.subtotalUsd);
  const value = Number(input.value);
  if (
    !Number.isSafeInteger(subtotalCents) ||
    subtotalCents <= 1 ||
    !Number.isFinite(value) ||
    value <= 0
  ) {
    return 0;
  }

  let discountCents: number;
  if (input.discountType === "percentage" && value <= 100) {
    discountCents = Math.round((subtotalCents * value) / 100);
  } else if (input.discountType === "fixed_usd") {
    discountCents = Math.round(value * 100);
  } else {
    return 0;
  }

  // Keep a positive payment amount so every checkout continues through the
  // existing payment and order-confirmation paths.
  return Math.min(Math.max(0, discountCents), subtotalCents - 1);
}

export function calculateCheckoutPromoPricing(
  subtotalUsd: string | number,
  discountUsd: string | number = 0,
) {
  const subtotalCents = Math.max(0, usdToCents(subtotalUsd));
  const discountCents = Math.min(
    Math.max(0, usdToCents(discountUsd)),
    Math.max(0, subtotalCents - 1),
  );
  return {
    subtotalUsd: formatUsdCents(subtotalCents),
    discountUsd: formatUsdCents(discountCents),
    totalUsd: formatUsdCents(subtotalCents - discountCents),
  };
}