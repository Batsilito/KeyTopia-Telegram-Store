import { InlineKeyboard } from "grammy";

export function createProductActionKeyboard(text: string, callbackData: string) {
  return new InlineKeyboard()
    .text(text, callbackData)
    .success()
    .row();
}