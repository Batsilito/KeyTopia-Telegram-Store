import { t, type BotLanguage } from "./locales.ts";

export interface WelcomeMessageOptions {
  language: BotLanguage;
  firstName: string;
  storeName: string;
  channel?: string | null;
  supportAvailable?: boolean;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function telegramChannelUrl(channel: string) {
  if (/^https?:\/\//i.test(channel)) return channel;
  return `https://t.me/${encodeURIComponent(channel.replace(/^@/, ""))}`;
}

export function createWelcomeMessage({
  language,
  firstName,
  storeName,
  channel,
  supportAvailable = true,
}: WelcomeMessageOptions) {
  const channelLine = channel
    ? t(language, "welcomeChannel").replace(
        "{url}",
        escapeHtml(telegramChannelUrl(channel)),
      )
    : null;

  return [
    t(language, "welcomeTitle").replace("{store}", escapeHtml(storeName)),
    "",
    t(language, "welcomeGreeting").replace("{name}", escapeHtml(firstName)),
    "",
    t(language, "welcomeDescription"),
    "",
    `<blockquote>\n${t(language, "welcomeHighlights")}\n</blockquote>`,
    ...(supportAvailable ? ["", t(language, "welcomeSupport")] : []),
    ...(channelLine ? ["", channelLine] : []),
    "",
    t(language, "welcomeFooter"),
  ].join("\n");
}