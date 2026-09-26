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
  outOfStockLabel: string;
  isFlashSale?: boolean;
  telegramCustomEmojiId?: string | null;
}

export function createProductShopButton(
  product: ShopProductButtonInput,
  language: ShopProductLanguage,
  includeCustomEmoji = true,
) {
  const name = language === "ar" ? product.nameAr : product.nameEn;
  const stock = product.inStock
    ? `📦 ${product.quantity}`
    : product.outOfStockLabel;
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