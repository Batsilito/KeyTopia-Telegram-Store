/**
 * Avoid a rate-limited supplier request on every shop navigation. A recent
 * successful check is shared briefly; failed checks expire sooner so buyers
 * never see supplier products while the catalog is known to be unavailable.
 */
export function createBuyerCatalogCheck(
  refresh: () => Promise<unknown>,
  reportFailure: (error: unknown) => void,
  options: {
    successTtlMs?: number;
    failureTtlMs?: number;
    now?: () => number;
  } = {},
) {
  const successTtlMs = options.successTtlMs ?? 30_000;
  const failureTtlMs = options.failureTtlMs ?? 3_000;
  const now = options.now ?? Date.now;
  let checkedAt: number | null = null;
  let available = false;
  let inFlight: Promise<boolean> | null = null;

  return (force = false): Promise<boolean> => {
    if (inFlight) return inFlight;
    if (
      !force &&
      checkedAt !== null &&
      now() - checkedAt < (available ? successTtlMs : failureTtlMs)
    ) {
      return Promise.resolve(available);
    }

    inFlight = Promise.resolve()
      .then(refresh)
      .then(
        () => {
          available = true;
          checkedAt = now();
          return true;
        },
        (error: unknown) => {
          available = false;
          checkedAt = now();
          reportFailure(error);
          return false;
        },
      )
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  };
}