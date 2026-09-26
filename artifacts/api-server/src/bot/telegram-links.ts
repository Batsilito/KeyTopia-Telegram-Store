export const TELEGRAM_BOT_USERNAME = "KeyTopiaStore_bot";
export const TELEGRAM_SHOP_START_PAYLOAD = "shop";

export function createTelegramShopLink() {
  return `https://t.me/${TELEGRAM_BOT_USERNAME}?start=${TELEGRAM_SHOP_START_PAYLOAD}`;
}

export function createTelegramReferralLink(referralCode: string) {
  return `https://t.me/${TELEGRAM_BOT_USERNAME}?start=${encodeURIComponent(referralCode)}`;
}

export function parseTelegramStartPayload(rawPayload: string) {
  const payload = rawPayload.trim();
  const openShop = payload === TELEGRAM_SHOP_START_PAYLOAD;
  return {
    openShop,
    referralCode: openShop || !payload ? undefined : payload,
  };
}