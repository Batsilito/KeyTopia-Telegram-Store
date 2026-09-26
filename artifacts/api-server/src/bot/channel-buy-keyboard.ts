import { InlineKeyboard } from "grammy";
import { createTelegramProductLink } from "./telegram-links.ts";

export function createChannelBuyNowKeyboard(productId: string) {
  return new InlineKeyboard()
    .url("Buy now", createTelegramProductLink(productId))
    .success()
    .row();
}