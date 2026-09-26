export const TELEGRAM_BOT_USERNAME = "KeyTopiaStore_bot";
export const TELEGRAM_SHOP_START_PAYLOAD = "shop";

export function createTelegramShopLink() {
  return `https://t.me/${TELEGRAM_BOT_USERNAME}?start=${TELEGRAM_SHOP_START_PAYLOAD}`;
}

export function createTelegramProductLink(productId: string) {
  return `https://t.me/${TELEGRAM_BOT_USERNAME}?start=${encodeURIComponent(`product_${productId}`)}`;
}

export function createTelegramReferralLink(referralCode: string) {
  return `https://t.me/${TELEGRAM_BOT_USERNAME}?start=${encodeURIComponent(referralCode)}`;
}

export function parseTelegramStartPayload(rawPayload: string) {
  const payload = rawPayload.trim();
  const openShop = payload === TELEGRAM_SHOP_START_PAYLOAD;
  const productId = /^product_([0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12})$/i.exec(payload)?.[1];
  return {
    openShop,
    ...(productId ? { productId } : {}),
    referralCode: openShop || productId || !payload ? undefined : payload,
  };
}