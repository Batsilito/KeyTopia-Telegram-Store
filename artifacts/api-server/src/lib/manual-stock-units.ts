import { randomBytes } from "node:crypto";

export const MANUAL_STOCK_UNIT_PREFIX = "keytopia-internal-manual-stock-unit:";

export function createManualStockUnitValue() {
  return `${MANUAL_STOCK_UNIT_PREFIX}${randomBytes(32).toString("hex")}`;
}

export function isManualStockUnitValue(value: string) {
  return value.startsWith(MANUAL_STOCK_UNIT_PREFIX);
}