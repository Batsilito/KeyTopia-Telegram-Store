export type ShopProductLanguage = "en" | "ar";

const TELEGRAM_CUSTOM_EMOJI_ID_PATTERN = /^\d{1,32}$/;

export function isValidTelegramCustomEmojiId(value: string): boolean {
  return TELEGRAM_CUSTOM_EMOJI_ID_PATTERN.test(value);
}

export interface ShopProductButtonInput {
  id: string;
  nameEn: string;
  nameAr: string;
  price: string;
  quantity: string;
  inStock: boolean;
  /** Accepted for caller compatibility; English labels are always displayed. */
  outOfStockLabel: string;
  isFlashSale?: boolean;
  telegramCustomEmojiId?: string | null;
}

export function createProductShopButton(
  product: ShopProductButtonInput,
  _language: ShopProductLanguage,
  includeCustomEmoji = true,
) {
  const name = product.nameEn;
  const stock = product.inStock
    ? `📦 ${product.quantity}`
    : "Out of stock";
  const iconId =
    includeCustomEmoji &&
    product.telegramCustomEmojiId &&
    isValidTelegramCustomEmojiId(product.telegramCustomEmojiId)
      ? product.telegramCustomEmojiId
      : null;

  return {
    text: `${name} | ${product.price} USDT${product.isFlashSale ? " ⚡" : ""} | ${stock}`,
    callback_data: `product:${product.id}`,
    ...(iconId ? { icon_custom_emoji_id: iconId } : {}),
  };
}