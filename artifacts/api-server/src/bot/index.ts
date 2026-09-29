import { Bot, GrammyError, InlineKeyboard, InputFile, Keyboard, webhookCallback, type Context } from "grammy";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { and, count, desc, eq, gt, inArray, isNull, lte, ne, or, sql, sum } from "drizzle-orm";
import {
  checkoutSessions,
  db,
  flashSales,
  inventoryItems,
  inventoryReservations,
  orders,
  orderRewardClaims,
  paymentMethods,
  payments,
  products,
  storeSettings,
  supportMessages,
  supportTickets,
  telegramPaymentNotifications,
  referrals,
  ventebotCatalogProducts,
  ventebotOrderFulfillments,
  walletTopUps,
  walletTransactions,
  users,
} from "@workspace/db";
import { logger } from "../lib/logger";
import {
  pollBinancePayments,
  upsertTelegramPaymentNotification,
  type FailedBinancePayment,
} from "../lib/binance-topups";
import { createBinanceFailureNotificationPlan } from "../lib/binance-verification";
import { fulfillAutomaticOrder } from "../lib/order-fulfillment";
import {
  createVenteBotFulfillmentValues,
  listDueVenteBotOrderIds,
  processVenteBotFulfillment,
  retryVenteBotFulfillment,
} from "../lib/ventebot-fulfillment";
import { getVenteBotAvailability } from "../lib/ventebot-rules";
import {
  refreshVenteBotCatalog,
  refreshVenteBotProductQuote,
  verifyVenteBotCheckoutPrice,
} from "../lib/ventebot-catalog-sync";
import {
  calculatePercentageAmount,
  rewardsAreEligible,
  VERIFIED_REFERRAL_REWARD_USD,
} from "../lib/reward-policy";
import { t, type BotLanguage } from "./locales";
import { createChannelBuyNowKeyboard } from "./channel-buy-keyboard";
import { createProductActionKeyboard } from "./product-action-keyboard";
import { createProductShopButton, isValidTelegramCustomEmojiId } from "./shop-product-button";
import { createProductDetailsMessage } from "./product-details-message";
import { createProductPriceChangeMessage } from "./product-price-change-message";
import { createProductPurchaseBroadcastMessage } from "./product-purchase-broadcast-message";
import {
  createTelegramReferralLink,
  parseTelegramStartPayload,
} from "./telegram-links";
import { createOrderDeliveryMessage } from "./order-delivery-message";
import { createOrderPaymentConfirmationMessage } from "./order-payment-confirmation-message";
import { createWelcomeMessage } from "./welcome-message";
import { ObjectStorageService } from "../lib/objectStorage";
import {
  getCheckoutPromoPricing,
  redeemPromoCodeReservation,
  releasePromoCodeReservation,
  removePromoCodeFromCheckout,
  reservePromoCodeForCheckout,
} from "../lib/promo-codes";

export const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN;
export const telegramBot = telegramBotToken ? new Bot(telegramBotToken) : null;
const objectStorageService = new ObjectStorageService();
let binanceProcessingPromise: Promise<void> | null = null;
let paymentNotificationPromise: Promise<void> | null = null;
let supplierFulfillmentPromise: Promise<void> | null = null;
let schedulerStarted = false;
const FLASH_SALE_REMINDER_INTERVAL_MS = 30 * 60 * 1000;
const flashSaleReminderAt = new Map<string, number>();
const BINANCE_POLL_INTERVAL_MS = 5_000;
const BINANCE_SUBMISSION_RETRY_DELAYS_MS = [250, 1_000, 2_500, 5_000, 10_000, 20_000] as const;
const verificationAnimationTimers = new Map<string, ReturnType<typeof setInterval>>();
const promoCodeInputs = new Map<string, string>();

export async function validateTelegramCustomEmojiId(
  value: string | null | undefined,
): Promise<string | null> {
  const id = value?.trim() || null;
  if (!id) return null;
  if (!isValidTelegramCustomEmojiId(id)) {
    throw new Error("Telegram Custom Emoji ID must be a numeric ID.");
  }
  if (!telegramBot) return id;

  try {
    const stickers = await telegramBot.api.getCustomEmojiStickers([id]);
    if (
      !stickers.some(
        (sticker) =>
          sticker.type === "custom_emoji" && sticker.custom_emoji_id === id,
      )
    ) {
      throw new Error("Telegram did not return a custom emoji for this ID.");
    }
  } catch (error) {
    if (
      error instanceof GrammyError &&
      /invalid|not found|cannot find|can't find/i.test(error.description)
    ) {
      throw new Error("Telegram could not find that Custom Emoji ID.");
    }
    if (error instanceof Error && error.message === "Telegram did not return a custom emoji for this ID.") {
      throw error;
    }
    logger.warn(
      { err: error },
      "Unable to validate Telegram Custom Emoji ID; it will be checked when rendering the shop",
    );
  }
  return id;
}

function languageOf(_user: typeof users.$inferSelect): BotLanguage {
  return "en";
}

function customerKeyboard(language: BotLanguage) {
  return new Keyboard()
    .text(t(language, "menu"))
    .resized();
}

function verificationAnimationKey(telegramUserId: string, messageId: number) {
  return `${telegramUserId}:${messageId}`;
}

function startVerificationAnimation(
  telegramUserId: string,
  messageId: number,
  language: BotLanguage,
) {
  if (!telegramBot) return;
  const key = verificationAnimationKey(telegramUserId, messageId);
  const previous = verificationAnimationTimers.get(key);
  if (previous) clearInterval(previous);
  let frame = 0;
  let ticks = 0;
  const timer = setInterval(() => {
    ticks += 1;
    if (ticks >= 60) {
      clearInterval(timer);
      verificationAnimationTimers.delete(key);
      return;
    }
    frame = (frame + 1) % 4;
    void telegramBot.api
      .editMessageText(
        telegramUserId,
        messageId,
        t(language, "paymentVerificationLoading").replace("{dots}", ".".repeat(frame)),
      )
      .catch(() => {
        // The final notification or a deleted Telegram message ends the animation.
      });
  }, 700);
  timer.unref();
  verificationAnimationTimers.set(key, timer);
}

async function showVerificationLoading(
  ctx: Context,
  user: typeof users.$inferSelect,
  eventKey: string,
  payload: Record<string, unknown>,
) {
  const language = languageOf(user);
  let verificationMessageId: number | undefined;
  try {
    const message = await ctx.reply(
      t(language, "paymentVerificationLoading").replace("{dots}", ""),
      { reply_markup: customerKeyboard(language) },
    );
    verificationMessageId = message.message_id;
    startVerificationAnimation(user.telegramUserId, verificationMessageId, language);
  } catch (error) {
    logger.warn({ err: error, eventKey }, "Unable to send Binance verification loading message");
  }
  try {
    await upsertTelegramPaymentNotification(db, {
      eventKey,
      telegramUserId: user.telegramUserId,
      language,
      eventType: "verification_pending",
      payload: {
        ...payload,
        verificationMessageId,
      },
    });
  } catch (error) {
    await dismissVerificationMessage(user.telegramUserId, verificationMessageId);
    throw error;
  }
}

async function dismissVerificationMessage(
  telegramUserId: string,
  messageId: number | undefined,
) {
  if (!telegramBot || !messageId) return;
  const key = verificationAnimationKey(telegramUserId, messageId);
  const timer = verificationAnimationTimers.get(key);
  if (timer) {
    clearInterval(timer);
    verificationAnimationTimers.delete(key);
  }
  try {
    await telegramBot.api.deleteMessage(telegramUserId, messageId);
  } catch {
    // The message may already have been removed or become inaccessible.
  }
}

export async function clearPaymentVerificationMessage(eventKey: string) {
  const events = await db
    .select({
      id: telegramPaymentNotifications.id,
      telegramUserId: telegramPaymentNotifications.telegramUserId,
      payload: telegramPaymentNotifications.payload,
    })
    .from(telegramPaymentNotifications)
    .where(eq(telegramPaymentNotifications.eventKey, eventKey))
    .limit(1);
  const event = events[0];
  if (!event) return;
  const payload = event.payload as { verificationMessageId?: number };
  await dismissVerificationMessage(event.telegramUserId, Number(payload.verificationMessageId));
  await db
    .update(telegramPaymentNotifications)
    .set({ sentAt: new Date(), updatedAt: new Date() })
    .where(eq(telegramPaymentNotifications.id, event.id));
}

function mainMenuKeyboard(language: BotLanguage) {
  return new Keyboard()
    .text(t(language, "shop"))
    .row()
    .text(t(language, "profile"))
    .text(t(language, "deposit"))
    .row()
    .text(t(language, "orders"))
    .row()
    .text(t(language, "support"))
    .row()
    .text(t(language, "refer"))
    .resized();
}

function paymentMethodLabel(method: string, language?: BotLanguage) {
  if (method === "wallet" && language) return t(language, "payWithWallet");
  const labels: Record<string, string> = {
    wallet: "💳 PAY WITH WALLET",
    binance: "🟡 BINANCE",
    bybit: "🔷 BYBIT",
    vodafone_cash: "📱 VODAFONE CASH",
    instapay: "🏦 INSTAPAY",
  };
  return labels[method] ?? `💳 ${method.replace("_", " ").toUpperCase()}`;
}

function paymentLogoPath(method: string) {
  const filenames: Record<string, string> = {
    vodafone_cash: "vodafone-cash-logo.png",
  };
  const filename = filenames[method];
  if (!filename) return null;
  const path = resolve(process.cwd(), "artifacts/api-server/assets", filename);
  return existsSync(path) ? path : null;
}

function escapeHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

export async function sendSupportReply(
  user: typeof users.$inferSelect,
  ticketId: string,
  ticketNumber: string,
  body: string,
) {
  if (!telegramBot) return false;
  try {
    await telegramBot.api.sendMessage(
      user.telegramUserId,
      [
        `<b>${t(user.language, "supportAdminReply")}</b>`,
        "",
        `<b>${t(user.language, "ticketNumber")}:</b> <code>${escapeHtml(ticketNumber)}</code>`,
        "",
        escapeHtml(body),
      ].join("\n"),
      {
        parse_mode: "HTML",
        reply_markup: new InlineKeyboard()
          .text(t(user.language, "supportReply"), `support:ticket:${ticketId}`)
          .row()
          .text(t(user.language, "menu"), "nav:home"),
      },
    );
    logger.info({ ticketNumber }, "Delivered admin support reply to Telegram");
    return true;
  } catch (error) {
    logger.warn({ err: error, telegramUserId: user.telegramUserId, ticketNumber }, "Unable to deliver admin support reply to Telegram");
    return false;
  }
}

function maskedCustomerName(user: Pick<typeof users.$inferSelect, "firstName" | "lastName">) {
  const fullName = [user.firstName, user.lastName].filter(Boolean).join(" ").trim() || "Customer";
  if (fullName.length <= 3) return `${fullName.slice(0, 1)}•••`;
  return `${fullName.slice(0, 2)}•••${fullName.slice(-1)}`;
}

export async function sendAdminTelegramTest() {
  if (!telegramBot) return { sent: false, reason: "unavailable" as const };
  const settings = await db
    .select({ adminTelegramChatId: storeSettings.adminTelegramChatId })
    .from(storeSettings)
    .limit(1);
  const chatId = settings[0]?.adminTelegramChatId?.trim();
  if (!chatId) return { sent: false, reason: "not_configured" as const };
  try {
    await telegramBot.api.sendMessage(
      chatId,
      [
        "<b>✅ KeyTopia admin notifications connected</b>",
        "",
        "You will receive masked sale alerts here when a product payment is confirmed.",
      ].join("\n"),
      { parse_mode: "HTML" },
    );
    return { sent: true as const };
  } catch (error) {
    logger.warn({ err: error }, "Unable to send admin Telegram test notification");
    return { sent: false, reason: "delivery_failed" as const };
  }
}

export async function notifyAdminProductSold(orderId: string) {
  if (!telegramBot) return false;
  const [settings, rows] = await Promise.all([
    db
      .select({ adminTelegramChatId: storeSettings.adminTelegramChatId })
      .from(storeSettings)
      .limit(1),
    db
      .select({ order: orders, user: users, product: products })
      .from(orders)
      .innerJoin(users, eq(orders.userId, users.id))
      .innerJoin(products, eq(orders.productId, products.id))
      .where(and(eq(orders.id, orderId), isNull(orders.adminSaleNotifiedAt)))
      .limit(1),
  ]);
  const chatId = settings[0]?.adminTelegramChatId?.trim();
  const row = rows[0];
  if (!chatId || !row) return false;
  try {
    await telegramBot.api.sendMessage(
      chatId,
      [
        "<b>🛍️ PRODUCT SOLD</b>",
        "",
        `📦 <b>Product:</b> ${escapeHtml(row.product.nameEn)}`,
        `👤 <b>Customer:</b> ${escapeHtml(maskedCustomerName(row.user))}`,
        `🔢 <b>Quantity:</b> ${row.order.quantity}`,
        `💰 <b>Amount:</b> ${escapeHtml(String(row.order.priceUsd))} USDT`,
        `🧾 <b>Order:</b> <code>${escapeHtml(row.order.orderNumber)}</code>`,
      ].join("\n"),
      { parse_mode: "HTML" },
    );
    const marked = await db
      .update(orders)
      .set({ adminSaleNotifiedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(orders.id, orderId), isNull(orders.adminSaleNotifiedAt)))
      .returning({ id: orders.id });
    return Boolean(marked[0]);
  } catch (error) {
    logger.warn({ err: error, orderId }, "Unable to send product sale notification to admin");
    return false;
  }
}

async function notifyAdminBinanceVerificationFailure(payment: FailedBinancePayment) {
  if (!telegramBot) return false;
  const settings = await db
    .select({ adminTelegramChatId: storeSettings.adminTelegramChatId })
    .from(storeSettings)
    .limit(1);
  const chatId = settings[0]?.adminTelegramChatId?.trim();
  if (!chatId) return false;
  try {
    await telegramBot.api.sendMessage(
      chatId,
      [
        "<b>⚠️ BINANCE VERIFICATION FAILED</b>",
        "",
        `🧾 <b>Type:</b> ${payment.paymentKind === "wallet" ? "Wallet top-up" : "Product payment"}`,
        `👤 <b>Customer Telegram ID:</b> <code>${escapeHtml(payment.telegramUserId)}</code>`,
        `💰 <b>Amount:</b> ${escapeHtml(payment.amountUsd)} USDT`,
        `🔗 <b>Transaction ID:</b> <code>${escapeHtml(payment.transactionId)}</code>`,
        `📝 <b>Reason:</b> ${escapeHtml(payment.reason)}`,
      ].join("\n"),
      { parse_mode: "HTML" },
    );
    return true;
  } catch (error) {
    logger.warn(
      { err: error, transactionId: payment.transactionId },
      "Unable to send Binance verification failure to admin",
    );
    return false;
  }
}

export async function notifyOrderDelivered(orderId: string) {
  if (!telegramBot) return false;
  const rows = await db
    .select({
      order: orders,
      telegramUserId: users.telegramUserId,
      language: users.language,
    })
    .from(orders)
    .innerJoin(users, eq(orders.userId, users.id))
    .where(eq(orders.id, orderId))
    .limit(1);
  const row = rows[0];
  if (!row?.order.deliveryInfo) return false;
  try {
    await telegramBot.api.sendMessage(
      row.telegramUserId,
      createOrderDeliveryMessage({
        language: row.language,
        deliveryType: row.order.deliveryType,
        productName: row.order.productNameSnapshot,
        orderNumber: row.order.orderNumber,
        deliveryInfo: row.order.deliveryInfo,
      }),
      {
        parse_mode: "HTML",
        reply_markup: customerKeyboard(row.language),
      },
    );
    await db
      .update(orders)
      .set({ deliveryNotifiedAt: new Date(), updatedAt: new Date() })
      .where(eq(orders.id, orderId));
    return true;
  } catch (error) {
    logger.warn({ err: error, orderId }, "Unable to send order delivery to Telegram");
    return false;
  }
}

async function queueProductPurchaseBroadcast(order: typeof orders.$inferSelect) {
  if (!telegramBot) return;
  const channel = await channelConfigured();
  try {
    await db
      .insert(telegramPaymentNotifications)
      .values({
        eventKey: `product-purchase:${order.id}:channel`,
        telegramUserId: channel,
        language: "en",
        eventType: "product_purchase_broadcast",
        payload: {
          productId: order.productId,
          productName: order.productNameSnapshot,
          quantity: order.quantity,
        },
      })
      .onConflictDoNothing({ target: telegramPaymentNotifications.eventKey });
    await processTelegramPaymentNotifications();
  } catch (error) {
    logger.warn(
      { err: error, orderId: order.id, channel },
      "Unable to queue product purchase channel broadcast",
    );
  }
}

export async function notifyOrderConfirmed(orderId: string) {
  const fulfillment = await fulfillAutomaticOrder(orderId);
  if (!fulfillment) return false;
  const supplierOrder = fulfillment.order.ventebotProductId !== null;
  await queueProductPurchaseBroadcast(fulfillment.order);
  await notifyAdminProductSold(fulfillment.order.id);
  if (fulfillment.status === "delivered") {
    await issueReferralRewardForOrder(fulfillment.order);
  }
  if (!telegramBot) {
    if (supplierOrder) dispatchVenteBotFulfillment(orderId);
    return false;
  }
  if (fulfillment.status === "delivered" && fulfillment.order.deliveryInfo) {
    return notifyOrderDelivered(orderId);
  }
  const customer = await db
    .select({
      telegramUserId: users.telegramUserId,
      language: users.language,
    })
    .from(users)
    .where(eq(users.id, fulfillment.order.userId))
    .limit(1);
  if (!customer[0]) {
    if (supplierOrder) dispatchVenteBotFulfillment(orderId);
    return false;
  }
  try {
    await telegramBot.api.sendMessage(
      customer[0].telegramUserId,
      createOrderPaymentConfirmationMessage({
        language: customer[0].language,
        deliveryType: fulfillment.order.deliveryType,
        orderNumber: fulfillment.order.orderNumber,
      }),
      {
        parse_mode: "HTML",
        reply_markup: customerKeyboard(customer[0].language),
      },
    );
    await db
      .update(orders)
      .set({ paymentNotifiedAt: new Date(), updatedAt: new Date() })
      .where(eq(orders.id, orderId));
    if (supplierOrder) dispatchVenteBotFulfillment(orderId);
    return true;
  } catch (error) {
    logger.warn({ err: error, orderId }, "Unable to send order confirmation to Telegram");
    if (supplierOrder) dispatchVenteBotFulfillment(orderId);
    return false;
  }
}

function dispatchVenteBotFulfillment(orderId: string) {
  void processAndNotifyVenteBotOrder(orderId).catch((error) => {
    logger.error({ err: error, orderId }, "VenteBot fulfillment dispatch failed");
  });
}

async function processAndNotifyVenteBotOrder(orderId: string) {
  const result = await processVenteBotFulfillment(orderId);
  if (result.status === "completed" && result.order) {
    await issueReferralRewardForOrder(result.order);
    await notifyOrderDelivered(orderId);
  }
}

export async function retryAndNotifyVenteBotOrder(orderId: string) {
  const result = await retryVenteBotFulfillment(orderId);
  if (result.status === "completed" && result.order) {
    await issueReferralRewardForOrder(result.order);
    await notifyOrderDelivered(orderId);
  }
  return result;
}

async function recoverVenteBotFulfillments() {
  const dueOrderIds = await listDueVenteBotOrderIds();
  for (const orderId of dueOrderIds) {
    await processAndNotifyVenteBotOrder(orderId);
  }
}

type BroadcastRecipient = {
  telegramUserId: string;
  language: BotLanguage;
};

async function broadcastToCustomers(
  message: (language: BotLanguage) => string,
  keyboard: (language: BotLanguage) => InlineKeyboard | Keyboard,
) {
  if (!telegramBot) return;
  const recipients = await db
    .select({ telegramUserId: users.telegramUserId, language: users.language })
    .from(users);
  let sent = 0;
  let failed = 0;
  for (const recipient of recipients as BroadcastRecipient[]) {
    try {
      await telegramBot.api.sendMessage(recipient.telegramUserId, message(recipient.language), {
        parse_mode: "HTML",
        reply_markup: keyboard(recipient.language),
      });
      sent += 1;
    } catch (error) {
      failed += 1;
      logger.warn({ err: error }, "Unable to send store notification");
    }
  }
  logger.info({ sent, failed }, "Store notification broadcast completed");
}

export function broadcastProductRestocked(
  product: typeof products.$inferSelect,
  restockedCount: number,
  availableStock: number,
) {
  return Promise.all([
    broadcastToCustomers(
      () => {
        return [
          "<b>🔔 PRODUCT RESTOCKED</b>",
          "",
          `📦 <b>Product:</b> ${escapeHtml(product.nameEn)}`,
          `➕ <b>Restocked:</b> ${restockedCount}`,
          `📊 <b>Available now:</b> ${availableStock}`,
          `💰 <b>Price:</b> ${product.priceUsd} USDT`,
        ].join("\n");
      },
      () => createProductActionKeyboard(
        "Buy now",
        `product:${product.id}`,
      ),
    ),
    broadcastProductRestockedToChannel(product, restockedCount, availableStock),
  ]);
}

async function broadcastProductRestockedToChannel(
  product: typeof products.$inferSelect,
  restockedCount: number,
  availableStock: number,
) {
  if (!telegramBot) return;
  const channel = await channelConfigured();
  if (!channel) return;
  const message = [
    "<b>🔔 PRODUCT RESTOCKED</b>",
    "",
    `📦 <b>Product:</b> ${escapeHtml(product.nameEn)}`,
    `➕ <b>Restocked:</b> ${restockedCount}`,
    `📊 <b>Available now:</b> ${availableStock}`,
    `💰 <b>Price:</b> ${escapeHtml(product.priceUsd)} USDT`,
  ].join("\n");
  try {
    await telegramBot.api.sendMessage(channel, message, {
      parse_mode: "HTML",
      reply_markup: createChannelBuyNowKeyboard(product.id),
    });
  } catch (error) {
    logger.warn(
      { err: error, channel, productId: product.id },
      "Unable to send product restock to Telegram channel",
    );
  }
}

export function broadcastNewProduct(product: typeof products.$inferSelect, availableStock = 0) {
  return broadcastToCustomers(
    () => {
      const stock = product.stockType === "unlimited" ? "Unlimited" : String(availableStock);
      return [
        "<b>🆕 NEW PRODUCT</b>",
        "",
        `📦 <b>Product:</b> ${escapeHtml(product.nameEn)}`,
        `📊 <b>Available:</b> ${stock}`,
        `💰 <b>Price:</b> ${product.priceUsd} USDT`,
      ].join("\n");
    },
    () => createProductActionKeyboard(
      "View product",
      `product:${product.id}`,
    ),
  );
}

export async function broadcastProductPriceChange(
  product: typeof products.$inferSelect,
  oldPriceUsd: string,
) {
  if (!telegramBot) return false;
  const message = createProductPriceChangeMessage({
    productName: product.nameEn,
    oldPriceUsd,
    newPriceUsd: product.priceUsd,
  });
  if (!message) return false;
  const channel = await channelConfigured();
  if (!channel) return false;
  try {
    await telegramBot.api.sendMessage(channel, message, {
      parse_mode: "HTML",
      reply_markup: createChannelBuyNowKeyboard(product.id),
    });
    return true;
  } catch (error) {
    logger.warn(
      { err: error, channel, productId: product.id },
      "Unable to send product price change to Telegram channel",
    );
    return false;
  }
}

function formatFlashSaleRemaining(endsAt: Date, _language: BotLanguage, now = new Date()) {
  const totalMinutes = Math.max(1, Math.ceil(Math.max(0, endsAt.getTime() - now.getTime()) / 60_000));
  const days = Math.floor(totalMinutes / 1_440);
  const hours = Math.floor((totalMinutes % 1_440) / 60);
  const minutes = totalMinutes % 60;
  const parts = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (minutes || parts.length === 0) parts.push(`${minutes}m`);
  return parts.join(" ");
}

function flashSaleMessage(
  sale: typeof flashSales.$inferSelect,
  product: typeof products.$inferSelect,
  language: BotLanguage,
  reminder: boolean,
  now = new Date(),
) {
  const heading = reminder
    ? "⏰ FLASH SALE IS STILL ON"
    : "🔥 FLASH SALE STARTED";
  return [
    `<b>${heading}</b>`,
    "",
    `📦 <b>Product:</b> ${escapeHtml(product.nameEn)}`,
    `🏷️ <b>Old price:</b> ${sale.originalPriceUsd} USDT`,
    `💰 <b>Sale price:</b> ${sale.salePriceUsd} USDT`,
    `⏳ <b>Time remaining:</b> ${formatFlashSaleRemaining(sale.endsAt, language, now)}`,
  ].join("\n");
}

async function broadcastFlashSaleToChannel(
  sale: typeof flashSales.$inferSelect,
  product: typeof products.$inferSelect,
  reminder: boolean,
) {
  if (!telegramBot) return;
  const channel = await channelConfigured();
  if (!channel) return;
  try {
    await telegramBot.api.sendMessage(
      channel,
      flashSaleMessage(sale, product, "en", reminder),
      {
        parse_mode: "HTML",
        reply_markup: createChannelBuyNowKeyboard(product.id),
      },
    );
  } catch (error) {
    logger.warn({ err: error, channel, saleId: sale.id }, "Unable to send flash sale channel notification");
  }
}

export async function broadcastFlashSale(
  sale: typeof flashSales.$inferSelect,
  product: typeof products.$inferSelect,
) {
  await broadcastFlashSaleToChannel(sale, product, false);
}

export async function broadcastFlashSaleReminder(
  sale: typeof flashSales.$inferSelect,
  product: typeof products.$inferSelect,
) {
  await broadcastToCustomers(
    () => flashSaleMessage(sale, product, "en", true),
    () => createProductActionKeyboard(
      "Buy now",
      "nav:shop",
    ),
  );
  await broadcastFlashSaleToChannel(sale, product, true);
}

export async function notifyDueFlashSales() {
  const now = new Date();
  await db.update(flashSales)
    .set({ status: "expired", updatedAt: new Date() })
    .where(and(eq(flashSales.status, "active"), lte(flashSales.endsAt, now)));
  if (!telegramBot) return;
  const dueSales = await db
    .select({ sale: flashSales, product: products })
    .from(flashSales)
    .innerJoin(products, eq(flashSales.productId, products.id))
    .where(and(
      eq(flashSales.status, "scheduled"),
      lte(flashSales.startsAt, now),
      gt(flashSales.endsAt, now),
    ));
  for (const due of dueSales) {
    const activated = await db
      .update(flashSales)
      .set({ status: "active", updatedAt: new Date() })
      .where(and(eq(flashSales.id, due.sale.id), eq(flashSales.status, "scheduled")))
      .returning();
    if (activated[0]) {
      flashSaleReminderAt.set(activated[0].id, now.getTime() + FLASH_SALE_REMINDER_INTERVAL_MS);
      await broadcastFlashSale(activated[0], due.product);
    }
  }
  const activeSales = await db
    .select({ sale: flashSales, product: products })
    .from(flashSales)
    .innerJoin(products, eq(flashSales.productId, products.id))
    .where(and(
      eq(flashSales.status, "active"),
      lte(flashSales.startsAt, now),
      gt(flashSales.endsAt, now),
    ));
  const activeSaleIds = new Set(activeSales.map(({ sale }) => sale.id));
  for (const saleId of flashSaleReminderAt.keys()) {
    if (!activeSaleIds.has(saleId)) flashSaleReminderAt.delete(saleId);
  }
  for (const active of activeSales) {
    const reminderAt = flashSaleReminderAt.get(active.sale.id)
      ?? active.sale.startsAt.getTime() + FLASH_SALE_REMINDER_INTERVAL_MS;
    if (now.getTime() < reminderAt) {
      flashSaleReminderAt.set(active.sale.id, reminderAt);
      continue;
    }
    flashSaleReminderAt.set(active.sale.id, now.getTime() + FLASH_SALE_REMINDER_INTERVAL_MS);
    await broadcastFlashSaleReminder(active.sale, active.product);
  }
}

export async function releaseExpiredCheckouts() {
  const expired = await db
    .select({ id: checkoutSessions.id })
    .from(checkoutSessions)
    .where(and(eq(checkoutSessions.status, "pending"), lte(checkoutSessions.expiresAt, new Date())))
    .limit(100);
  for (const checkout of expired) {
    await db.transaction(async (tx) => {
      const cancelled = await tx.update(checkoutSessions)
        .set({ status: "cancelled", updatedAt: new Date() })
        .where(and(eq(checkoutSessions.id, checkout.id), eq(checkoutSessions.status, "pending")))
        .returning({ id: checkoutSessions.id });
      if (!cancelled[0]) return;
      await releasePromoCodeReservation(tx, checkout.id);
      const reservations = await tx.update(inventoryReservations)
        .set({ releasedAt: new Date() })
        .where(and(eq(inventoryReservations.checkoutSessionId, checkout.id), isNull(inventoryReservations.releasedAt)))
        .returning({ inventoryItemId: inventoryReservations.inventoryItemId });
      if (reservations.length) {
        await tx.update(inventoryItems)
          .set({ status: "available", updatedAt: new Date() })
          .where(and(
            inArray(inventoryItems.id, reservations.map((item) => item.inventoryItemId)),
            eq(inventoryItems.status, "reserved"),
          ));
      }
    });
  }
  return expired.length;
}

export function processBinancePayments() {
  if (!telegramBot) return Promise.resolve();
  if (binanceProcessingPromise) return binanceProcessingPromise;

  const run = (async () => {
    const processedPayments = await pollBinancePayments();
    for (const payment of processedPayments) {
      try {
        if (payment.kind === "failure") {
          await notifyAdminBinanceVerificationFailure(payment);
        } else if (payment.kind === "order") {
          await clearPaymentVerificationMessage(
            `product-payment:${payment.paymentId}:verification`,
          );
          await notifyOrderConfirmed(payment.orderId);
        }
      } catch (error) {
        logger.warn(
          { err: error, telegramUserId: payment.telegramUserId, transactionId: payment.transactionId },
          "Unable to finalize Binance payment",
        );
      }
    }
    await processTelegramPaymentNotifications();
  })();

  binanceProcessingPromise = run;
  void run.then(
    () => {
      if (binanceProcessingPromise === run) binanceProcessingPromise = null;
    },
    () => {
      if (binanceProcessingPromise === run) binanceProcessingPromise = null;
    },
  );
  return run;
}

export function processTelegramPaymentNotifications() {
  if (!telegramBot) return Promise.resolve();
  if (paymentNotificationPromise) return paymentNotificationPromise;
  const run = (async () => {
    const events = await db
      .select()
      .from(telegramPaymentNotifications)
      .where(
        and(
          isNull(telegramPaymentNotifications.sentAt),
          ne(telegramPaymentNotifications.eventType, "verification_pending"),
        ),
      )
      .orderBy(telegramPaymentNotifications.createdAt)
      .limit(50);
    for (const event of events) {
      try {
        const payload = event.payload as {
          paymentKind?: "wallet" | "order" | "wallet top-up" | "product payment";
          amountUsd?: string;
          transactionId?: string;
          reason?: string;
          verificationMessageId?: number;
          productId?: string;
          productName?: string;
          quantity?: number;
        };
        if (event.eventType === "product_purchase_broadcast") {
          const productId = payload.productId?.trim();
          const productName = payload.productName;
          const quantity = payload.quantity;
          if (
            !productId ||
            !productName ||
            typeof quantity !== "number" ||
            !Number.isSafeInteger(quantity) ||
            quantity < 1
          ) {
            throw new Error("Invalid product purchase broadcast payload");
          }
          await telegramBot!.api.sendMessage(
            event.telegramUserId,
            createProductPurchaseBroadcastMessage({ productName, quantity }),
            {
              parse_mode: "HTML",
              reply_markup: createChannelBuyNowKeyboard(productId),
            },
          );
        } else {
          let message: string;
          if (event.eventType === "wallet_top_up_confirmed") {
            message = t(event.language, "topUpConfirmed").replace(
              "{amount}",
              Number(payload.amountUsd ?? 0).toFixed(2),
            );
          } else if (event.eventType === "payment_declined") {
            message = t(event.language, "paymentDeclinedByAdmin")
              .replace("{kind}", escapeHtml(payload.paymentKind ?? "payment"))
              .replace("{amount}", Number(payload.amountUsd ?? 0).toFixed(2))
              .replace("{transaction}", escapeHtml(payload.transactionId ?? "Not provided"))
              .replace("{reason}", escapeHtml(payload.reason ?? "Declined by admin"));
          } else {
            const key =
              payload.paymentKind === "wallet"
                ? "topUpVerificationFailed"
                : "paymentVerificationFailed";
            message = t(event.language, key)
              .replace("{amount}", Number(payload.amountUsd ?? 0).toFixed(2))
              .replace("{transaction}", escapeHtml(payload.transactionId ?? "Not provided"))
              .replace("{reason}", escapeHtml(payload.reason ?? "Automatic verification failed"));
          }
          await dismissVerificationMessage(
            event.telegramUserId,
            Number(payload.verificationMessageId),
          );
          await telegramBot!.api.sendMessage(event.telegramUserId, message, {
            parse_mode: "HTML",
            reply_markup: customerKeyboard(event.language),
          });
        }
        await db
          .update(telegramPaymentNotifications)
          .set({ sentAt: new Date(), lastError: null, updatedAt: new Date() })
          .where(
            and(
              eq(telegramPaymentNotifications.id, event.id),
              isNull(telegramPaymentNotifications.sentAt),
            ),
          );
      } catch (error) {
        await db
          .update(telegramPaymentNotifications)
          .set({
            attempts: sql`${telegramPaymentNotifications.attempts} + 1`,
            lastError: error instanceof Error ? error.message.slice(0, 500) : "Telegram send failed",
            updatedAt: new Date(),
          })
          .where(eq(telegramPaymentNotifications.id, event.id));
        logger.warn({ err: error, notificationId: event.id }, "Unable to send Telegram notification");
      }
    }
  })();
  paymentNotificationPromise = run;
  void run.then(
    () => {
      if (paymentNotificationPromise === run) paymentNotificationPromise = null;
    },
    () => {
      if (paymentNotificationPromise === run) paymentNotificationPromise = null;
    },
  );
  return run;
}

export async function notifyWalletTopUpConfirmedByAdmin(input: {
  telegramUserId: string;
  language: "en" | "ar";
  amountUsd: string;
}) {
  if (!telegramBot || !input.telegramUserId) return;
  await telegramBot.api.sendMessage(
    input.telegramUserId,
    t(input.language, "topUpConfirmed").replace(
      "{amount}",
      Number(input.amountUsd).toFixed(2),
    ),
    {
      parse_mode: "HTML",
      reply_markup: customerKeyboard(input.language),
    },
  );
}

export async function notifyPaymentDeclinedByAdmin(input: {
  telegramUserId: string;
  language: "en" | "ar";
  paymentKind: "wallet top-up" | "product payment";
  amountUsd: string;
  transactionId: string;
  reason: string;
}) {
  if (!telegramBot || !input.telegramUserId) return;
  await telegramBot.api.sendMessage(
    input.telegramUserId,
    t(input.language, "paymentDeclinedByAdmin")
      .replace("{kind}", escapeHtml(input.paymentKind))
      .replace("{amount}", Number(input.amountUsd).toFixed(2))
      .replace("{transaction}", escapeHtml(input.transactionId))
      .replace("{reason}", escapeHtml(input.reason)),
    {
      parse_mode: "HTML",
      reply_markup: customerKeyboard(input.language),
    },
  );
}

function scheduleBinancePaymentProcessing() {
  for (const delay of BINANCE_SUBMISSION_RETRY_DELAYS_MS) {
    setTimeout(() => {
      void processBinancePayments().catch((error) => {
        logger.error({ err: error }, "Deferred Binance payment check failed");
      });
    }, delay);
  }
}

async function recoverOrderNotifications() {
  const pendingOrders = await db
    .select({ id: orders.id })
    .from(orders)
    .where(
      or(
        and(
          eq(orders.deliveryType, "automatic"),
          inArray(orders.status, ["paid", "processing"]),
          isNull(orders.ventebotProductId),
        ),
        and(
          inArray(orders.status, ["paid", "processing"]),
          isNull(orders.paymentNotifiedAt),
        ),
        and(
          eq(orders.status, "delivered"),
          isNull(orders.deliveryNotifiedAt),
        ),
      ),
    )
    .limit(100);
  for (const order of pendingOrders) {
    await notifyOrderConfirmed(order.id);
  }
}

export function startStoreNotificationScheduler() {
  if (!telegramBot || schedulerStarted) return;
  schedulerStarted = true;
  const runMaintenance = async () => {
    await releaseExpiredCheckouts();
    await notifyDueFlashSales();
    await recoverOrderNotifications();
    await recoverVenteBotFulfillments();
  };
  const runMaintenanceSafely = () => {
    void runMaintenance().catch((error) => {
      logger.error({ err: error }, "Store notification or Binance top-up job failed");
    });
  };
  const runBinanceSafely = () => {
    void processBinancePayments().then(processTelegramPaymentNotifications).catch((error) => {
      logger.error({ err: error }, "Scheduled Binance payment check failed");
    });
  };
  runMaintenanceSafely();
  runBinanceSafely();
  const maintenanceInterval = setInterval(runMaintenanceSafely, 30_000);
  const binanceInterval = setInterval(runBinanceSafely, BINANCE_POLL_INTERVAL_MS);
  maintenanceInterval.unref();
  binanceInterval.unref();
}

type ReferralRewardOrder = Pick<
  typeof orders.$inferSelect,
  "id" | "userId" | "orderNumber"
>;

export async function issueReferralRewardForOrder(order: ReferralRewardOrder) {
  const issuedReward = await db.transaction(async (tx) => {
    // Never trust the caller's lifecycle state: rewards only follow a committed
    // delivery, and the claim table makes retries/concurrent workers harmless.
    const deliveredOrders = await tx
      .select({ id: orders.id, priceUsd: orders.priceUsd, status: orders.status })
      .from(orders)
      .where(eq(orders.id, order.id))
      .limit(1);
    const deliveredOrder = deliveredOrders[0];
    if (!deliveredOrder || !rewardsAreEligible(deliveredOrder.status)) return null;

    const settings = await tx
      .select({
        cashbackPercent: storeSettings.cashbackPercent,
      })
      .from(storeSettings)
      .limit(1);
    const cashbackPercent = Number(settings[0]?.cashbackPercent ?? 0);
    if (cashbackPercent > 0) {
      const transactionId = randomUUID();
      const claim = await tx
        .insert(orderRewardClaims)
        .values({ orderId: order.id, rewardType: "cashback", walletTransactionId: transactionId })
        .onConflictDoNothing()
        .returning({ id: orderRewardClaims.id });
      if (claim[0]) {
        const cashback = calculatePercentageAmount(deliveredOrder.priceUsd, cashbackPercent);
        if (Number(cashback) > 0) {
          await tx.insert(walletTransactions).values({
            id: transactionId,
            userId: order.userId,
            orderId: order.id,
            type: "cashback",
            amountUsd: cashback,
            reason: `Cashback for delivered order ${order.orderNumber}`,
            reference: order.orderNumber,
          });
        } else {
          await tx.delete(orderRewardClaims).where(eq(orderRewardClaims.id, claim[0].id));
        }
      }
    }

    const candidates = await tx
      .select({
        referralId: referrals.id,
        referrerId: users.id,
        referrerTelegramUserId: users.telegramUserId,
        referrerLanguage: users.language,
      })
      .from(referrals)
      .innerJoin(users, eq(referrals.referrerId, users.id))
      .where(
        and(
          eq(referrals.referredUserId, order.userId),
          eq(referrals.rewardIssued, false),
        ),
      )
      .limit(1);
    const candidate = candidates[0];
    if (!candidate) return null;

    const reward = VERIFIED_REFERRAL_REWARD_USD;
    const updated = await tx
      .update(referrals)
      .set({
        rewardIssued: true,
        qualifyingOrderId: order.id,
      })
      .where(
        and(
          eq(referrals.id, candidate.referralId),
          eq(referrals.rewardIssued, false),
        ),
      )
      .returning({ id: referrals.id });
    if (!updated[0]) return null;

    const transactionId = randomUUID();
    const claim = await tx.insert(orderRewardClaims).values({
      orderId: order.id,
      rewardType: "referral_reward",
      walletTransactionId: transactionId,
    }).onConflictDoNothing().returning({ id: orderRewardClaims.id });
    if (!claim[0]) return null;

    await tx.insert(walletTransactions).values({
      id: transactionId,
      userId: candidate.referrerId,
      orderId: order.id,
      type: "referral_reward",
      amountUsd: reward,
      reason: `Referral reward for order ${order.orderNumber}`,
      reference: order.orderNumber,
    });

    return {
      amount: Number(reward),
      telegramUserId: candidate.referrerTelegramUserId,
      language: candidate.referrerLanguage,
    };
  });

  if (!issuedReward || !telegramBot) return issuedReward;

  const message = t(issuedReward.language, "referralRewardIssued")
    .replace("{amount}", issuedReward.amount.toFixed(2))
    .replace("{order}", escapeHtml(order.orderNumber));
  try {
    await telegramBot.api.sendMessage(issuedReward.telegramUserId, message, {
      parse_mode: "HTML",
      reply_markup: customerKeyboard(issuedReward.language),
    });
  } catch (error) {
    logger.warn(
      { err: error, orderId: order.id, telegramUserId: issuedReward.telegramUserId },
      "Unable to send referral reward notification",
    );
  }
  return issuedReward;
}

type CustomerUser = typeof users.$inferSelect & { joinedNow: boolean };

async function notifyVerifiedReferralReward(
  reward: {
    amount: string;
    referredName: string;
  },
) {
  await broadcastToCustomers(
    (language) =>
      t(language, "referralRewardVerified")
        .replace("{name}", escapeHtml(reward.referredName))
        .replace("{amount}", Number(reward.amount).toFixed(2)),
    customerKeyboard,
  );
}

function paymentMethodDescription(method: string, _language: BotLanguage) {
  const descriptions: Record<string, string> = {
    wallet: t("en", "walletPaymentDescription"),
    binance: "Send from your Binance UID to the recipient UID shown in the instructions. Your transfer is checked automatically.",
    bybit: "Bybit transfer instructions are shown after you choose Bybit.",
    vodafone_cash: "Vodafone Cash transfer instructions are shown after you choose Vodafone Cash.",
  };
  return descriptions[method] ?? "";
}

type CheckoutPaymentMethod = "wallet" | "binance" | "bybit" | "vodafone_cash";
const checkoutPaymentMethods = new Set<CheckoutPaymentMethod>([
  "wallet",
  "binance",
  "bybit",
  "vodafone_cash",
]);

function isCheckoutPaymentMethod(method: string): method is CheckoutPaymentMethod {
  return checkoutPaymentMethods.has(method as CheckoutPaymentMethod);
}

const supportDraftUsers = new Set<string>();
const supportReplyDrafts = new Map<string, string>();
const walletTopUpDrafts = new Map<string, { method: "binance"; amount?: number }>();
const customQuantityProducts = new Map<
  string,
  { productId: string; expectedPriceCents?: number }
>();

function createSupportTicketNumber() {
  return `KT-${Date.now().toString(36).toUpperCase()}-${randomBytes(3).toString("hex").toUpperCase()}`;
}

async function findOrCreateCustomer(ctx: Context): Promise<CustomerUser | null> {
  const from = ctx.from;
  if (!from) return null;
  const existing = await db
    .select()
    .from(users)
    .where(eq(users.telegramUserId, String(from.id)))
    .limit(1);
  if (existing[0]) {
    await db
      .update(users)
      .set({
        username: from.username,
        firstName: from.first_name,
        lastName: from.last_name,
        lastActivityAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(users.id, existing[0].id));
    return {
      ...existing[0],
      username: from.username ?? null,
      firstName: from.first_name,
      lastName: from.last_name ?? null,
      joinedNow: false,
    };
  }
  const referralCode = `KT${from.id.toString(36).toUpperCase()}`;
  const created = await db
    .insert(users)
    .values({
      telegramUserId: String(from.id),
      username: from.username,
      firstName: from.first_name,
      lastName: from.last_name,
      referralCode,
    })
    .returning();
  return created[0] ? { ...created[0], joinedNow: true } : null;
}

async function applyReferralCode(user: CustomerUser, rawCode: string | undefined) {
  const code = rawCode?.trim();
  if (!user.joinedNow || !code || code === user.referralCode || user.referredById) return user;
  const result = await db.transaction(async (tx) => {
    const referrerRows = await tx
      .select({
        id: users.id,
      })
      .from(users)
      .where(eq(users.referralCode, code))
      .limit(1);
    const referrer = referrerRows[0];
    if (!referrer || referrer.id === user.id) return null;

    const updatedUser = await tx
      .update(users)
      .set({ referredById: referrer.id, updatedAt: new Date() })
      .where(and(eq(users.id, user.id), isNull(users.referredById)))
      .returning({ id: users.id });
    if (!updatedUser[0]) return null;

    const referralRows = await tx
      .insert(referrals)
      .values({
        referrerId: referrer.id,
        referredUserId: user.id,
        rewardIssued: true,
      })
      .returning({ id: referrals.id });
    if (!referralRows[0]) return null;

    const transactionId = randomUUID();
    await tx.insert(walletTransactions).values({
      id: transactionId,
      userId: referrer.id,
      type: "referral_reward",
      amountUsd: VERIFIED_REFERRAL_REWARD_USD,
      reason: "Reward for a verified new referral",
      reference: `referral:${referralRows[0].id}`,
    });

    return {
      user: { ...user, referredById: referrer.id },
      reward: {
        amount: VERIFIED_REFERRAL_REWARD_USD,
        referredName:
          [user.firstName, user.lastName].filter(Boolean).join(" ").trim() ||
          user.username ||
          "Customer",
      },
    };
  });
  if (!result) return user;
  await notifyVerifiedReferralReward(result.reward);
  return result.user;
}

async function channelConfigured() {
  return "@KeytopiaChannel";
}

async function isChannelMember(ctx: Context, channel: string | null) {
  if (!channel || !ctx.from || !telegramBot) return true;
  try {
    const member = await telegramBot.api.getChatMember(channel, ctx.from.id);
    return (
      ["creator", "administrator", "member"].includes(member.status) ||
      (member.status === "restricted" && member.is_member)
    );
  } catch (error) {
    logger.warn({ err: error }, "Unable to verify Telegram channel membership");
    return false;
  }
}

async function ensureAccess(ctx: Context, user: typeof users.$inferSelect) {
  const channel = await channelConfigured();
  const member = await isChannelMember(ctx, channel);
  if (member) {
    if (!user.channelMember) {
      await db.update(users).set({ channelMember: true }).where(eq(users.id, user.id));
    }
    return true;
  }
  await db.update(users).set({ channelMember: false }).where(eq(users.id, user.id));
  const language = languageOf(user);
  const username = channel?.replace(/^@/, "") ?? "";
  const keyboard = new InlineKeyboard()
    .url(t(language, "joinChannel"), username ? `https://t.me/${username}` : "https://t.me")
    .row()
    .text(t(language, "iveJoined"), "channel:recheck");
  await ctx.reply(t(language, "joinRequired"), { reply_markup: keyboard });
  return false;
}

async function showHome(
  ctx: Context,
  user: typeof users.$inferSelect,
  includeShop = false,
) {
  const language = languageOf(user);
  const [settings, channel] = await Promise.all([
    db
      .select({
        storeName: storeSettings.storeName,
        supportAvailable: storeSettings.supportAvailable,
      })
      .from(storeSettings)
      .limit(1),
    channelConfigured(),
  ]);
  const store = settings[0];
  await ctx.reply(
    createWelcomeMessage({
      language,
      firstName: user.firstName,
      storeName: store?.storeName ?? "KeyTopia",
      channel,
      supportAvailable: store?.supportAvailable ?? true,
    }),
    {
      parse_mode: "HTML",
      reply_markup: mainMenuKeyboard(language),
    },
  );
  if (includeShop) await showShop(ctx, user);
}

async function showWallet(ctx: Context, user: typeof users.$inferSelect) {
  if (!(await ensureAccess(ctx, user))) return;
  walletTopUpDrafts.delete(user.id);
  const language = languageOf(user);
  const rows = await db
    .select({ balance: sum(walletTransactions.amountUsd) })
    .from(walletTransactions)
    .where(eq(walletTransactions.userId, user.id));
  const balance = Number(rows[0]?.balance ?? 0).toFixed(2);
  const keyboard = new InlineKeyboard()
    .text(t(language, "topUpWallet"), "wallet:topup")
    .row()
    .text(t(language, "mainMenu"), "nav:home");
  await ctx.reply(
    `<b>${t(language, "wallet")}</b>\n\n💵 <b>${t(language, "walletBalance")}:</b> ${balance} USDT`,
    { parse_mode: "HTML", reply_markup: keyboard },
  );
}

async function showOrders(ctx: Context, user: typeof users.$inferSelect) {
  if (!(await ensureAccess(ctx, user))) return;
  const language = languageOf(user);
  const customerOrders = await db
    .select()
    .from(orders)
    .where(eq(orders.userId, user.id))
    .orderBy(desc(orders.createdAt))
    .limit(20);
  const body = customerOrders.length
    ? customerOrders
        .map(
          (order) =>
            `🧾 <code>${escapeHtml(order.orderNumber)}</code>\n` +
            `📦 ${escapeHtml(order.productNameSnapshot)} · ${t(language, "quantity")}: ${order.quantity}\n` +
            `💰 ${Number(order.priceUsd).toFixed(2)} USDT · ${escapeHtml(order.status)}`,
        )
        .join("\n\n")
    : t(language, "noOrders");
  await ctx.reply(`<b>${t(language, "ordersTitle")}</b>\n\n${body}`, {
    parse_mode: "HTML",
    reply_markup: customerKeyboard(language),
  });
}

async function showProfile(ctx: Context, user: typeof users.$inferSelect) {
  if (!(await ensureAccess(ctx, user))) return;
  const language = languageOf(user);
  const displayName = [user.firstName, user.lastName].filter(Boolean).join(" ");
  const username = user.username ? `@${user.username}` : "—";
  await ctx.reply(
    [
      `<b>${t(language, "profile")}</b>`,
      "",
      `👤 <b>${t(language, "profileName")}:</b> ${escapeHtml(displayName)}`,
      `🔗 <b>${t(language, "profileUsername")}:</b> ${escapeHtml(username)}`,
      `🎁 <b>${t(language, "profileReferral")}:</b> <code>${escapeHtml(user.referralCode)}</code>`,
    ].join("\n"),
    {
      parse_mode: "HTML",
      reply_markup: customerKeyboard(language),
    },
  );
}

async function showWalletTopup(ctx: Context, user: typeof users.$inferSelect) {
  if (!(await ensureAccess(ctx, user))) return;
  const language = languageOf(user);
  const methods = await db
    .select()
    .from(paymentMethods)
    .where(and(eq(paymentMethods.enabled, true), ne(paymentMethods.method, "instapay")));
  const keyboard = new InlineKeyboard();
  for (const method of methods) {
    keyboard.text(paymentMethodLabel(method.method), `wallet:method:${method.method}`).row();
  }
  keyboard.text(t(language, "backToWallet"), "nav:wallet").row();
  const methodText = methods.length
    ? methods.map((method) => `• <b>${escapeHtml(paymentMethodLabel(method.method))}</b> ${escapeHtml(paymentMethodDescription(method.method, language))}`).join("\n")
    : t(language, "paymentUnavailable");
  await ctx.reply(
    `<b>${t(language, "topUpWallet")}</b>\n\n${t(language, "topUpIntro")}\n\n${methodText}`,
    { parse_mode: "HTML", reply_markup: keyboard },
  );
}

async function showWalletPaymentMethod(
  ctx: Context,
  user: typeof users.$inferSelect,
  method: "binance" | "bybit" | "vodafone_cash",
  amount?: number,
) {
  if (!(await ensureAccess(ctx, user))) return;
  const language = languageOf(user);
  const config = await db
    .select()
    .from(paymentMethods)
    .where(and(eq(paymentMethods.method, method), eq(paymentMethods.enabled, true)))
    .limit(1);
  if (!config[0]) {
    await ctx.reply(t(language, "paymentUnavailable"));
    return;
  }
  const instructions = config[0].instructionsEn;
  const recipientUid = config[0].paymentIdentifier?.trim();
  const topUpAmount = amount !== undefined && Number.isInteger(amount)
    ? String(amount)
    : amount?.toFixed(2);
  const details = method === "binance" && amount !== undefined && recipientUid
    ? [
        `<b>${t(language, "binancePaymentTitle")}</b>`,
        "",
        `${t(language, "binanceTopUpAmountLabel")}: <b>${topUpAmount}$</b>`,
        "",
        `<b>${t(language, "binanceRecipientLabel")}:</b> <code>${escapeHtml(recipientUid)}</code>`,
        "",
        `<b>${t(language, "binanceImportantLabel")}</b>`,
        t(language, "binanceTransferStep").replace("{amount}", topUpAmount ?? amount.toFixed(2)),
        t(language, "binanceTransactionStep"),
        "",
        t(language, "binanceFindTransaction"),
        t(language, "binanceRejectShortId"),
      ].filter(Boolean).join("\n")
    : [
        `<b>${t(language, "topUpInstructions")}</b>`,
        "",
        `<b>${escapeHtml(paymentMethodLabel(method))}</b>`,
        escapeHtml(instructions),
        amount !== undefined ? `${t(language, "topUpAmount")}: ${amount.toFixed(2)} USDT` : "",
        recipientUid ? `Recipient: ${escapeHtml(recipientUid)}` : "",
        "",
        t(language, "support"),
      ].filter(Boolean).join("\n");
  await ctx.reply(details, {
    parse_mode: "HTML",
    reply_markup: new InlineKeyboard().text(t(language, "backToWallet"), "nav:wallet"),
  });
}

async function beginWalletTopUp(ctx: Context, user: typeof users.$inferSelect) {
  walletTopUpDrafts.set(user.id, { method: "binance" });
  const language = languageOf(user);
  await ctx.reply(t(language, "enterTopUpAmount"), {
    reply_markup: new InlineKeyboard().text(t(language, "backToWallet"), "nav:wallet"),
  });
}

async function acceptWalletTopUpAmount(ctx: Context, user: typeof users.$inferSelect, value: string) {
  const method = walletTopUpDrafts.get(user.id);
  if (!method) return false;
  const normalized = value.trim().replace(",", ".");
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) {
    await ctx.reply(t(languageOf(user), "invalidTopUpAmount"));
    return true;
  }
  const amount = Number(normalized);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 100000) {
    await ctx.reply(t(languageOf(user), "invalidTopUpAmount"));
    return true;
  }
  walletTopUpDrafts.set(user.id, { method: "binance", amount });
  await showWalletPaymentMethod(ctx, user, "binance", amount);
  return true;
}

async function acceptWalletTopUpTransactionId(
  ctx: Context,
  user: typeof users.$inferSelect,
  value: string,
) {
  const draft = walletTopUpDrafts.get(user.id);
  if (!draft?.amount) return false;
  const submittedTransactionId = value.trim();
  if (!/^\S{6,128}$/.test(submittedTransactionId)) {
    await ctx.reply(t(languageOf(user), "invalidBinanceTransactionId"));
    return true;
  }

  const config = await db
    .select({ id: paymentMethods.id })
    .from(paymentMethods)
    .where(and(eq(paymentMethods.method, "binance"), eq(paymentMethods.enabled, true)))
    .limit(1);
  if (!config[0]) {
    walletTopUpDrafts.delete(user.id);
    await ctx.reply(t(languageOf(user), "paymentUnavailable"));
    return true;
  }

  const existing = await db
    .select({
      id: walletTopUps.id,
      userId: walletTopUps.userId,
      amountUsd: walletTopUps.amountUsd,
      status: walletTopUps.status,
    })
    .from(walletTopUps)
    .where(eq(walletTopUps.submittedTransactionId, submittedTransactionId))
    .limit(1);
  if (existing[0]) {
    walletTopUpDrafts.delete(user.id);
    if (
      existing[0].userId === user.id &&
      existing[0].status === "verification_failed" &&
      Number(existing[0].amountUsd).toFixed(2) === draft.amount.toFixed(2)
    ) {
      const retried = await db
        .update(walletTopUps)
        .set({
          status: "pending",
          verificationFailureReason: null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(walletTopUps.id, existing[0].id),
            eq(walletTopUps.status, "verification_failed"),
          ),
        )
        .returning({ id: walletTopUps.id });
      if (retried[0]) {
        await showVerificationLoading(
          ctx,
          user,
          `wallet-top-up:${existing[0].id}:verification`,
          {
            paymentKind: "wallet",
            amountUsd: existing[0].amountUsd,
            transactionId: submittedTransactionId,
          },
        );
        scheduleBinancePaymentProcessing();
        return true;
      }
    }
    await ctx.reply(t(languageOf(user), "transactionAlreadySubmitted"), {
      reply_markup: customerKeyboard(languageOf(user)),
    });
    return true;
  }

  let topUp: { id: string } | undefined;
  try {
    topUp = await db.transaction(async (tx) => {
      await tx
        .update(walletTopUps)
        .set({ status: "cancelled", updatedAt: new Date() })
        .where(and(eq(walletTopUps.userId, user.id), eq(walletTopUps.status, "pending")));
      const created = await tx
        .insert(walletTopUps)
        .values({
          userId: user.id,
          amountUsd: draft.amount!.toFixed(2),
          submittedTransactionId,
        })
        .returning({ id: walletTopUps.id });
      return created[0];
    });
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? (error as { code?: unknown }).code
        : undefined;
    if (code !== "23505") throw error;

    walletTopUpDrafts.delete(user.id);
    await ctx.reply(t(languageOf(user), "transactionAlreadySubmitted"), {
      reply_markup: customerKeyboard(languageOf(user)),
    });
    return true;
  }
  walletTopUpDrafts.delete(user.id);
  if (!topUp) {
    await ctx.reply(t(languageOf(user), "error"));
    return true;
  }
  await showVerificationLoading(
    ctx,
    user,
    `wallet-top-up:${topUp.id}:verification`,
    {
      paymentKind: "wallet",
      amountUsd: draft.amount.toFixed(2),
      transactionId: submittedTransactionId,
    },
  );
  scheduleBinancePaymentProcessing();
  return true;
}

async function showSupport(ctx: Context, user: typeof users.$inferSelect) {
  if (!(await ensureAccess(ctx, user))) return;
  const language = languageOf(user);
  const settings = await db.select({ supportAvailable: storeSettings.supportAvailable }).from(storeSettings).limit(1);
  if (settings[0] && !settings[0].supportAvailable) {
    await ctx.reply(t(language, "supportUnavailable"), { reply_markup: new InlineKeyboard().text(t(language, "mainMenu"), "nav:home") });
    return;
  }
  await ctx.reply(`<b>${t(language, "support")}</b>\n\n${t(language, "supportIntro")}`, {
    parse_mode: "HTML",
    reply_markup: new InlineKeyboard()
      .text(t(language, "supportWrite"), "support:write")
      .row()
      .text(t(language, "supportTickets"), "support:list")
      .row()
      .text(t(language, "mainMenu"), "nav:home"),
  });
}

function supportStatusLabel(status: "created" | "pending" | "closed", _language: BotLanguage) {
  const labels = { created: "Created", pending: "Pending", closed: "Closed" } as const;
  return labels[status];
}

async function showSupportTickets(ctx: Context, user: typeof users.$inferSelect) {
  if (!(await ensureAccess(ctx, user))) return;
  const language = languageOf(user);
  const tickets = await db
    .select()
    .from(supportTickets)
    .where(eq(supportTickets.userId, user.id))
    .orderBy(desc(supportTickets.updatedAt));
  const keyboard = new InlineKeyboard();
  for (const ticket of tickets) {
    keyboard.text(
      `${ticket.ticketNumber} · ${supportStatusLabel(ticket.status, language)}`,
      `support:ticket:${ticket.id}`,
    ).row();
  }
  keyboard.text(t(language, "supportWrite"), "support:write").row();
  keyboard.text(t(language, "mainMenu"), "nav:home");
  await ctx.reply(
    `<b>${t(language, "supportTickets")}</b>\n\n${tickets.length ? "" : t(language, "noSupportTickets")}`,
    { parse_mode: "HTML", reply_markup: keyboard },
  );
}

async function showSupportTicket(ctx: Context, user: typeof users.$inferSelect, ticketId: string) {
  if (!(await ensureAccess(ctx, user))) return;
  const language = languageOf(user);
  const ticketRows = await db
    .select()
    .from(supportTickets)
    .where(and(eq(supportTickets.id, ticketId), eq(supportTickets.userId, user.id)))
    .limit(1);
  if (!ticketRows[0]) {
    await ctx.reply(t(language, "supportTicketNotFound"), {
      reply_markup: new InlineKeyboard().text(t(language, "supportTickets"), "support:list"),
    });
    return;
  }
  const messages = await db
    .select()
    .from(supportMessages)
    .where(eq(supportMessages.ticketId, ticketId))
    .orderBy(supportMessages.createdAt);
  const ticket = ticketRows[0];
  const sections = [
    `<b>${t(language, "supportConversation")}</b>\n\n<b>${escapeHtml(ticket.ticketNumber)}</b>\n${t(language, "status")}: ${supportStatusLabel(ticket.status, language)}`,
    ...messages.map((message) => {
      const author = message.authorType === "admin" ? t(language, "supportAgent") : t(language, "supportCustomer");
      return `<b>${escapeHtml(author)}</b>\n${escapeHtml(message.body)}`;
    }),
  ];
  const chunks: string[] = [];
  let current = "";
  for (const section of sections) {
    if (current && current.length + section.length + 2 > 3800) {
      chunks.push(current);
      current = "";
    }
    current = current ? `${current}\n\n${section}` : section;
  }
  if (current) chunks.push(current);
  const keyboard = new InlineKeyboard()
    .text(t(language, "supportReply"), `support:reply:${ticket.id}`)
    .row()
    .text(t(language, "supportTickets"), "support:list")
    .row()
    .text(t(language, "supportWrite"), "support:write")
    .row()
    .text(t(language, "mainMenu"), "nav:home");
  for (let index = 0; index < chunks.length; index += 1) {
    await ctx.reply(chunks[index], {
      parse_mode: "HTML",
      reply_markup: index === chunks.length - 1 ? keyboard : undefined,
    });
  }
}

async function showReferral(ctx: Context, user: typeof users.$inferSelect) {
  if (!(await ensureAccess(ctx, user))) return;
  const language = languageOf(user);
  const [referralCount] = await Promise.all([
    db.select({ total: count() }).from(referrals).where(eq(referrals.referrerId, user.id)),
  ]);
  const reward = Number(VERIFIED_REFERRAL_REWARD_USD).toFixed(2);
  const inviteLink = createTelegramReferralLink(user.referralCode);
  const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(inviteLink)}&text=${encodeURIComponent(t(language, "referralIntro"))}`;
  const text = [
    `<b>${t(language, "referralTitle")}</b>`,
    "",
    t(language, "referralIntro"),
    "",
    `🔑 <b>${t(language, "referralCode")}:</b> <code>${escapeHtml(user.referralCode)}</code>`,
    `💵 <b>${t(language, "referralReward")}:</b> ${reward} USDT`,
    `👥 <b>${t(language, "referralInvites")}:</b> ${Number(referralCount[0]?.total ?? 0)}`,
    "",
    `<b>🔗 ${escapeHtml(inviteLink)}</b>`,
  ].join("\n");
  await ctx.reply(text, {
    parse_mode: "HTML",
    reply_markup: new InlineKeyboard()
      .url(t(language, "shareInvite"), shareUrl)
      .row()
      .text(t(language, "mainMenu"), "nav:home"),
  });
}

async function beginSupportMessage(ctx: Context, user: typeof users.$inferSelect) {
  supportReplyDrafts.delete(user.id);
  supportDraftUsers.add(user.id);
  await ctx.reply(t(languageOf(user), "supportPrompt"), {
    reply_markup: new InlineKeyboard()
      .text(t(languageOf(user), "supportCancel"), "support:cancel")
      .row()
      .text(t(languageOf(user), "mainMenu"), "nav:home"),
  });
}

async function beginSupportReply(ctx: Context, user: typeof users.$inferSelect, ticketId: string) {
  const ticket = await db
    .select({ id: supportTickets.id })
    .from(supportTickets)
    .where(and(eq(supportTickets.id, ticketId), eq(supportTickets.userId, user.id)))
    .limit(1);
  if (!ticket[0]) {
    await ctx.reply(t(languageOf(user), "supportTicketNotFound"));
    return;
  }
  supportDraftUsers.delete(user.id);
  supportReplyDrafts.set(user.id, ticketId);
  const language = languageOf(user);
  await ctx.reply(t(language, "supportReplyPrompt"), {
    reply_markup: new InlineKeyboard()
      .text(t(language, "supportCancel"), `support:reply:cancel:${ticketId}`)
      .row()
      .text(t(language, "mainMenu"), "nav:home"),
  });
}

async function acceptSupportMessage(ctx: Context, user: typeof users.$inferSelect, body: string) {
  if (!supportDraftUsers.has(user.id)) return false;
  supportDraftUsers.delete(user.id);
  const ticket = await db.insert(supportTickets).values({
    ticketNumber: createSupportTicketNumber(),
    userId: user.id,
    subject: "Telegram support request",
    status: "created",
  }).returning();
  await db.insert(supportMessages).values({
    ticketId: ticket[0].id,
    authorType: "customer",
    body,
  });
  await ctx.reply(`${t(languageOf(user), "supportTicketCreated")}\n\n<b>${t(languageOf(user), "ticketNumber")}:</b> <code>${escapeHtml(ticket[0].ticketNumber)}</code>`, {
    parse_mode: "HTML",
    reply_markup: customerKeyboard(languageOf(user)),
  });
  return true;
}

async function acceptSupportReply(ctx: Context, user: typeof users.$inferSelect, body: string) {
  const ticketId = supportReplyDrafts.get(user.id);
  if (!ticketId) return false;
  supportReplyDrafts.delete(user.id);
  const ticketRows = await db
    .select()
    .from(supportTickets)
    .where(and(eq(supportTickets.id, ticketId), eq(supportTickets.userId, user.id)))
    .limit(1);
  if (!ticketRows[0]) {
    await ctx.reply(t(languageOf(user), "supportTicketNotFound"));
    return true;
  }
  const ticket = ticketRows[0];
  await db.transaction(async (tx) => {
    await tx.insert(supportMessages).values({
      ticketId: ticket.id,
      authorType: "customer",
      body,
    });
    await tx
      .update(supportTickets)
      .set({ status: "created", updatedAt: new Date() })
      .where(eq(supportTickets.id, ticket.id));
  });
  await ctx.reply(
    `${t(languageOf(user), "supportReplySent")}\n\n<b>${t(languageOf(user), "ticketNumber")}:</b> <code>${escapeHtml(ticket.ticketNumber)}</code>`,
    { parse_mode: "HTML", reply_markup: customerKeyboard(languageOf(user)) },
  );
  await showSupportTicket(ctx, user, ticket.id);
  return true;
}

async function getProductAvailability(product: typeof products.$inferSelect) {
  if (product.ventebotProductId !== null) {
    const rows = await db
      .select()
      .from(ventebotCatalogProducts)
      .where(eq(ventebotCatalogProducts.id, product.ventebotProductId))
      .limit(1);
    const supplierProduct = rows[0];
    if (!supplierProduct) {
      return {
        inStock: false,
        quantity: "0",
        maxQuantity: 0,
      };
    }
    const availability = getVenteBotAvailability(
      supplierProduct,
      Boolean(process.env.VENTEBOT_RESELLER_KEY),
    );
    return {
      inStock: availability.available,
      quantity: availability.quantity === null
        ? "∞"
        : String(availability.quantity),
      maxQuantity: availability.quantity ?? 99,
    };
  }
  if (product.stockType === "unlimited") {
    return { inStock: true, quantity: "∞", maxQuantity: 99 };
  }
  const stock = await db
    .select({ availableQuantity: count(inventoryItems.id) })
    .from(inventoryItems)
    .where(and(eq(inventoryItems.productId, product.id), eq(inventoryItems.status, "available")));
  const quantity = Number(stock[0]?.availableQuantity ?? 0);
  return { inStock: quantity > 0, quantity: String(quantity), maxQuantity: quantity };
}

async function refreshSupplierCatalogForBuyer() {
  try {
    await refreshVenteBotCatalog();
    return true;
  } catch (error) {
    logger.warn({ err: error }, "Unable to refresh VenteBot catalog for buyer");
    return false;
  }
}

function usdPriceCents(value: string | number) {
  return Math.round(Number(value) * 100);
}

function parseUsdPriceToken(value: string | undefined) {
  if (!value || !/^[0-9a-z]+$/i.test(value)) return undefined;
  const cents = Number.parseInt(value, 36);
  return Number.isSafeInteger(cents) && cents >= 0 ? cents : undefined;
}

async function getBuyerProductState(
  product: typeof products.$inferSelect,
  quantity: number,
) {
  if (product.ventebotProductId === null) {
    return {
      product,
      availability: await getProductAvailability(product),
    };
  }
  const verified = await refreshVenteBotProductQuote(
    product.ventebotProductId,
    quantity,
  );
  return {
    product: verified.product,
    availability: {
      inStock: verified.inStock,
      quantity: verified.quote.stock === null
        ? "∞"
        : String(verified.quote.stock),
      maxQuantity: verified.maxQuantity,
    },
  };
}

async function getActiveFlashSale(productId: string, now = new Date()) {
  const rows = await db
    .select()
    .from(flashSales)
    .where(and(
      eq(flashSales.productId, productId),
      eq(flashSales.status, "active"),
      lte(flashSales.startsAt, now),
      gt(flashSales.endsAt, now),
    ))
    .orderBy(desc(flashSales.startsAt))
    .limit(1);
  return rows[0] ?? null;
}

function effectiveProductPrice(
  product: typeof products.$inferSelect,
  sale: typeof flashSales.$inferSelect | null,
) {
  return sale?.salePriceUsd ?? product.priceUsd;
}

async function replaceCallbackMessage(
  ctx: Context,
  text: string,
  options: {
    parse_mode?: "HTML";
    reply_markup?: InlineKeyboard | Keyboard;
  } = {},
  fallbackOptions?: {
    parse_mode?: "HTML";
    reply_markup?: InlineKeyboard | Keyboard;
  },
) {
  const message = ctx.callbackQuery?.message;
  if (message) {
    const attempts = fallbackOptions ? [options, fallbackOptions] : [options];
    for (const [index, attempt] of attempts.entries()) {
      const inlineReplyMarkup =
        attempt.reply_markup && "inline_keyboard" in attempt.reply_markup
          ? attempt.reply_markup
          : undefined;
      try {
        if ("photo" in message) {
          await ctx.editMessageCaption({
            caption: text,
            parse_mode: attempt.parse_mode,
            ...(inlineReplyMarkup ? { reply_markup: inlineReplyMarkup } : {}),
          });
        } else {
          await ctx.editMessageText(text, {
            parse_mode: attempt.parse_mode,
            ...(inlineReplyMarkup ? { reply_markup: inlineReplyMarkup } : {}),
          });
        }
        return true;
      } catch (error) {
        if (
          error &&
          typeof error === "object" &&
          "description" in error &&
          String(error.description).includes("message is not modified")
        ) {
          return true;
        }
        if (index === 0 && fallbackOptions) {
          logger.warn(
            { err: error },
            "Telegram rejected shop custom emoji icons; retrying without product icons",
          );
        } else {
          logger.warn({ err: error }, "Unable to edit Telegram callback message; sending replacement");
        }
      }
    }
  }
  await ctx.reply(text, fallbackOptions ?? options);
  return false;
}

async function showShop(
  ctx: Context,
  user: typeof users.$inferSelect,
  editMessage = false,
  accessAlreadyChecked = false,
) {
  if (!accessAlreadyChecked && !(await ensureAccess(ctx, user))) return;
  const language = languageOf(user);
  const allRows = await db
    .select()
    .from(products)
    .where(eq(products.active, true))
    .orderBy(desc(products.createdAt));
  const hasSupplierProducts = allRows.some(
    (product) => product.ventebotProductId !== null,
  );
  const supplierCatalogAvailable = hasSupplierProducts
    ? await refreshSupplierCatalogForBuyer()
    : true;
  let rows = allRows.filter(
    (product) => product.ventebotProductId === null,
  );
  if (supplierCatalogAvailable) {
    const activeSupplierRows = await db
      .select({ id: ventebotCatalogProducts.id })
      .from(ventebotCatalogProducts)
      .where(eq(ventebotCatalogProducts.catalogActive, true));
    const activeSupplierIds = new Set(activeSupplierRows.map((row) => row.id));
    rows = allRows.filter(
      (product) =>
        product.ventebotProductId === null ||
        activeSupplierIds.has(product.ventebotProductId),
    );
  }
  if (rows.length === 0) {
    const message = allRows.length > 0
      ? t(language, "supplierUnavailable")
      : t(language, "noProducts");
    if (ctx.callbackQuery) {
      await replaceCallbackMessage(ctx, message, {
        reply_markup: customerKeyboard(language),
      });
    } else {
      await ctx.reply(message, { reply_markup: customerKeyboard(language) });
    }
    return;
  }
  const stockRows = await db
    .select({
      productId: inventoryItems.productId,
      availableQuantity: count(inventoryItems.id),
    })
    .from(inventoryItems)
    .where(eq(inventoryItems.status, "available"))
    .groupBy(inventoryItems.productId);
  const stockByProduct = new Map(
    stockRows.map((row) => [row.productId, Number(row.availableQuantity)]),
  );
  const supplierAvailabilityByProduct = new Map<
    string,
    Awaited<ReturnType<typeof getProductAvailability>>
  >();
  await Promise.all(
    rows
      .filter((product) => product.ventebotProductId !== null)
      .map(async (product) => {
        supplierAvailabilityByProduct.set(
          product.id,
          await getProductAvailability(product),
        );
      }),
  );
  const activeSaleRows = await db
    .select()
    .from(flashSales)
    .where(and(
      eq(flashSales.status, "active"),
      lte(flashSales.startsAt, new Date()),
      gt(flashSales.endsAt, new Date()),
    ));
  const activeSaleByProduct = new Map(activeSaleRows.map((sale) => [sale.productId, sale]));
  const sortedRows = [...rows].sort((left, right) => {
    const leftAvailability = supplierAvailabilityByProduct.get(left.id);
    const rightAvailability = supplierAvailabilityByProduct.get(right.id);
    const leftAvailable = leftAvailability
      ? leftAvailability.inStock
      : left.stockType === "unlimited" || (stockByProduct.get(left.id) ?? 0) > 0;
    const rightAvailable = rightAvailability
      ? rightAvailability.inStock
      : right.stockType === "unlimited" || (stockByProduct.get(right.id) ?? 0) > 0;
    return Number(leftAvailable) - Number(rightAvailable);
  });
  const channel = await channelConfigured();
  const buildKeyboard = (includeProductIcons: boolean) => {
    const keyboard = new InlineKeyboard();
    for (const product of sortedRows) {
      const sale = activeSaleByProduct.get(product.id) ?? null;
      const price = effectiveProductPrice(product, sale);
      const isUnlimited = product.stockType === "unlimited";
      const supplierAvailability = supplierAvailabilityByProduct.get(product.id);
      const quantity = supplierAvailability?.quantity ??
        (isUnlimited ? "∞" : String(stockByProduct.get(product.id) ?? 0));
      const inStock = supplierAvailability?.inStock ??
        (isUnlimited || quantity !== "0");
      const button = createProductShopButton(
        {
          id: product.id,
          nameEn: product.nameEn,
          nameAr: product.nameAr,
          price,
          quantity,
          inStock,
          outOfStockLabel: t(language, "outOfStock"),
          isFlashSale: Boolean(sale),
          telegramCustomEmojiId: product.telegramCustomEmojiId,
        },
        language,
        includeProductIcons,
      );
      keyboard.add(button)[inStock ? "success" : "danger"]().row();
    }
    keyboard.text(t(language, "refreshStock"), "shop:refresh").row();
    if (channel) {
      keyboard.url(
        t(language, "channel"),
        `https://t.me/${channel.replace(/^@/, "")}`,
      ).row();
    } else {
      keyboard.text(t(language, "channel"), "nav:channel").row();
    }
    keyboard
      .text(t(language, "orderHistory"), "nav:orders")
      .text(t(language, "wallet"), "nav:wallet")
      .row()
      .text(t(language, "mainMenu"), "nav:home");
    return keyboard;
  };
  const keyboard = buildKeyboard(true);
  const hasProductIcons = sortedRows.some(
    (product) =>
      product.telegramCustomEmojiId &&
      isValidTelegramCustomEmojiId(product.telegramCustomEmojiId),
  );
  const fallbackKeyboard = hasProductIcons ? buildKeyboard(false) : undefined;

  const text = "\u2060";

  if (editMessage && ctx.callbackQuery) {
    await replaceCallbackMessage(
      ctx,
      text,
      { reply_markup: keyboard },
      fallbackKeyboard ? { reply_markup: fallbackKeyboard } : undefined,
    );
  } else {
    try {
      await ctx.reply(text, { reply_markup: keyboard });
    } catch (error) {
      if (!fallbackKeyboard) throw error;
      logger.warn(
        { err: error },
        "Telegram rejected shop custom emoji icons; retrying without product icons",
      );
      await ctx.reply(text, { reply_markup: fallbackKeyboard });
    }
  }
}

async function showProduct(
  ctx: Context,
  user: typeof users.$inferSelect,
  productId: string,
  accessAlreadyChecked = false,
) {
  if (!accessAlreadyChecked && !(await ensureAccess(ctx, user))) return;
  const rows = await db.select().from(products).where(and(eq(products.id, productId), eq(products.active, true))).limit(1);
  let product = rows[0];
  if (!product) return;
  const language = languageOf(user);
  if (product.ventebotProductId !== null) {
    if (!(await refreshSupplierCatalogForBuyer())) {
      await replaceCallbackMessage(ctx, t(language, "supplierUnavailable"), {
        reply_markup: new InlineKeyboard()
          .text(t(language, "refreshStock"), `product:refresh:${product.id}`)
          .row()
          .text(t(language, "backToShop"), "nav:shop"),
      });
      return;
    }
    const refreshedRows = await db
      .select()
      .from(products)
      .where(and(eq(products.id, productId), eq(products.active, true)))
      .limit(1);
    product = refreshedRows[0];
    if (!product) {
      await replaceCallbackMessage(ctx, t(language, "outOfStock"), {
        reply_markup: new InlineKeyboard().text(t(language, "backToShop"), "nav:shop"),
      });
      return;
    }
    const supplierRows = await db
      .select({ catalogActive: ventebotCatalogProducts.catalogActive })
      .from(ventebotCatalogProducts)
      .where(eq(ventebotCatalogProducts.id, product.ventebotProductId!))
      .limit(1);
    if (!supplierRows[0]?.catalogActive) {
      await replaceCallbackMessage(ctx, t(language, "supplierUnavailable"), {
        reply_markup: new InlineKeyboard()
          .text(t(language, "refreshStock"), `product:refresh:${product.id}`)
          .row()
          .text(t(language, "backToShop"), "nav:shop"),
      });
      return;
    }
  }
  const name = product.nameEn;
  const instructions = product.instructionsEn;
  const availability = await getProductAvailability(product);
  const sale = await getActiveFlashSale(product.id);
  const price = effectiveProductPrice(product, sale);
  const keyboard = new InlineKeyboard();
  if (availability.inStock) {
    keyboard
      .text(
        `${t(language, "buyNow")} · ${price} USDT`,
        `buy:${product.id}:${usdPriceCents(price).toString(36)}`,
      )
      .success()
      .row();
  }
  keyboard
    .text(t(language, "refreshStock"), `product:refresh:${product.id}`)
    .row()
    .text(t(language, "backToShop"), "nav:shop");
  const details = createProductDetailsMessage({
    language,
    name,
    price: String(price),
    inStock: availability.inStock,
    quantity: availability.quantity,
    flashSale: Boolean(sale),
    description: instructions,
    warranty: product.warranty,
    duration: product.duration,
  });
  if (product.imageUrl) {
    let photoSent = false;
    try {
      const photo = await productTelegramPhoto(product.imageUrl, product.id);
      await ctx.replyWithPhoto(photo);
      photoSent = true;
    } catch (error) {
      logger.warn({ err: error, productId: product.id }, "Unable to send product image");
    }
    if (photoSent) {
      const callbackMessage = ctx.callbackQuery?.message;
      if (callbackMessage?.chat.type === "private") {
        try {
          await ctx.api.deleteMessage(
            callbackMessage.chat.id,
            callbackMessage.message_id,
          );
        } catch (error) {
          logger.debug({ err: error, productId: product.id }, "Unable to remove the previous product message");
        }
      }
      await ctx.reply(details, { parse_mode: "HTML", reply_markup: keyboard });
      return;
    }
  }
  await replaceCallbackMessage(ctx, details, { parse_mode: "HTML", reply_markup: keyboard });
}

async function productTelegramPhoto(imageUrl: string, productId: string) {
  if (!imageUrl.startsWith("/objects/uploads/")) return imageUrl;

  const file = await objectStorageService.getObjectEntityFile(imageUrl);
  const [metadata] = await file.getMetadata();
  const [buffer] = await file.download();
  const contentType = String(metadata.contentType ?? "");
  const extension =
    contentType === "image/png" ? "png" : contentType === "image/webp" ? "webp" : "jpg";
  return new InputFile(buffer, `product-${productId}.${extension}`);
}

async function showQuantitySelector(
  ctx: Context,
  user: typeof users.$inferSelect,
  productId: string,
  requestedQuantity = 1,
  expectedPriceCents?: number,
) {
  if (!(await ensureAccess(ctx, user))) return;
  const rows = await db.select().from(products).where(and(eq(products.id, productId), eq(products.active, true))).limit(1);
  let product = rows[0];
  if (!product) return;
  let availability: Awaited<ReturnType<typeof getProductAvailability>>;
  try {
    const state = await getBuyerProductState(product, requestedQuantity);
    product = state.product;
    availability = state.availability;
  } catch (error) {
    logger.warn({ err: error, productId }, "Unable to verify product before quantity selection");
    await replaceCallbackMessage(ctx, t(languageOf(user), "supplierUnavailable"), {
      reply_markup: new InlineKeyboard().text(t(languageOf(user), "backToShop"), "nav:shop"),
    });
    return;
  }
  const sale = await getActiveFlashSale(product.id);
  const price = effectiveProductPrice(product, sale);
  const priceCents = usdPriceCents(price);
  const maxQuantity = availability.maxQuantity;
  if (!availability.inStock || maxQuantity < 1) {
    await ctx.reply(t(languageOf(user), "outOfStock"));
    return;
  }
  const quantity = Math.min(Math.max(Math.trunc(requestedQuantity), 1), maxQuantity);
  const total = (Number(price) * quantity).toFixed(2);
  const language = languageOf(user);
  const name = product.nameEn;
  const keyboard = new InlineKeyboard();
  for (const preset of [1, 2, 3]) {
    if (preset > maxQuantity) break;
    keyboard
      .text(
        String(preset),
        `quantity:${product.id}:set:${preset}:${priceCents.toString(36)}`,
      )
      .success();
  }
  keyboard
    .row()
    .text(
      t(language, "customQuantity"),
      `quantity:${product.id}:custom::${priceCents.toString(36)}`,
    )
    .primary()
    .row()
    .text(t(language, "back"), `quantity:${product.id}:back`)
    .row();
  const text = [
    `<b>${t(language, "selectQuantity")}</b>`,
    ...(expectedPriceCents !== undefined && expectedPriceCents !== priceCents
      ? [
          "",
          escapeHtml(
            t(language, "priceChangedNotice")
              .replace("{old}", (expectedPriceCents / 100).toFixed(2))
              .replace("{new}", (priceCents / 100).toFixed(2)),
          ),
        ]
      : []),
    "",
    `<b>${escapeHtml(name)}</b>`,
    "",
    `<b>${t(language, "unitPrice")}: ${price} USDT${sale ? " ⚡" : ""}</b>`,
    `<b>${t(language, "quantity")}: ${quantity}</b>`,
    `<b>${t(language, "total")}: ${total} USDT</b>`,
    `<b>${t(language, "availableStock")}: ${escapeHtml(availability.quantity)}</b>`,
    "",
    `<i>${t(language, "quantityCheckNotice")}</i>`,
  ].join("\n");
  await replaceCallbackMessage(ctx, text, { parse_mode: "HTML", reply_markup: keyboard });
}

async function acceptCustomQuantity(
  ctx: Context,
  user: typeof users.$inferSelect,
  value: string,
) {
  const customQuantity = customQuantityProducts.get(user.id);
  if (!customQuantity) return false;
  const productId = customQuantity.productId;
  const language = languageOf(user);
  const parsed = Number(value.trim());
  if (!/^\d+$/.test(value.trim()) || !Number.isSafeInteger(parsed) || parsed < 1) {
    await ctx.reply(t(language, "invalidCustomQuantity"));
    return true;
  }
  const rows = await db
    .select()
    .from(products)
    .where(and(eq(products.id, productId), eq(products.active, true)))
    .limit(1);
  const product = rows[0];
  if (!product) {
    customQuantityProducts.delete(user.id);
    await ctx.reply(t(language, "outOfStock"));
    return true;
  }
  const availability = await getProductAvailability(product);
  const maxQuantity = availability.maxQuantity;
  if (parsed > maxQuantity) {
    await ctx.reply(
      t(language, "invalidCustomQuantity").replace("{max}", String(maxQuantity)),
    );
    return true;
  }
  customQuantityProducts.delete(user.id);
  await showQuantitySelector(
    ctx,
    user,
    productId,
    parsed,
    customQuantity.expectedPriceCents,
  );
  return true;
}

async function showCheckoutSummary(
  ctx: Context,
  user: typeof users.$inferSelect,
  checkout: typeof checkoutSessions.$inferSelect,
  notice?: string,
) {
  const language = languageOf(user);
  const [methods, pricing] = await Promise.all([
    db
      .select()
      .from(paymentMethods)
      .where(and(eq(paymentMethods.enabled, true), ne(paymentMethods.method, "instapay"))),
    getCheckoutPromoPricing(checkout.id, checkout.priceUsd),
  ]);
  const keyboard = new InlineKeyboard()
    .text(paymentMethodLabel("wallet", language), `method:${checkout.id}:wallet`)
    .row();
  for (const method of methods) {
    keyboard
      .text(paymentMethodLabel(method.method, language), `method:${checkout.id}:${method.method}`)
      .row();
  }
  keyboard
    .text(
      t(language, pricing.code ? "changePromoCode" : "applyPromoCode"),
      `promo:apply:${checkout.id}`,
    )
    .row();
  if (pricing.code) {
    keyboard.text(t(language, "removePromoCode"), `promo:remove:${checkout.id}`).row();
  }
  keyboard
    .text(t(language, "cancelOrder"), `checkout:cancel:${checkout.id}`)
    .text(t(language, "support"), "nav:support");

  const unitPrice = (Number(checkout.priceUsd) / checkout.quantity).toFixed(2);
  const timeoutMinutes = Math.max(
    1,
    Math.ceil((checkout.expiresAt.getTime() - Date.now()) / 60_000),
  );
  const paymentOptions = [
    {
      method: "wallet",
      description: paymentMethodDescription("wallet", language),
    },
    ...methods.map((method) => ({
      method: method.method,
      description: paymentMethodDescription(method.method, language),
    })),
  ].map(
    ({ method, description }) =>
      `<b>${escapeHtml(paymentMethodLabel(method, language))}</b>\n${escapeHtml(description)}`,
  );
  const summary = [
    notice ? escapeHtml(notice) : "",
    `<b>${t(language, "orderCreated")}</b>`,
    [
      `🧩 <b>${t(language, "product")}:</b> ${escapeHtml(checkout.productNameSnapshot)}`,
      `➕ <b>${t(language, "quantity")}:</b> ${checkout.quantity}`,
    ].join("\n"),
    [
      `💲 <b>${t(language, "unitPrice")}:</b> ${unitPrice} USDT`,
      `📊 <b>${t(language, "subtotal")}:</b> ${pricing.subtotalUsd} USDT`,
      ...(pricing.code
        ? [
            `🏷️ <b>${t(language, "promoCodeLabel")}:</b> ${escapeHtml(pricing.code)}`,
            `➖ <b>${t(language, "promoCodeDiscount")}:</b> -${pricing.discountUsd} USDT`,
          ]
        : []),
      `💰 <b>${t(language, "total")}:</b> ${pricing.totalUsd} USDT`,
    ].join("\n"),
    [
      `🏪 <b>${t(language, "seller")}:</b> KeyTopia`,
      `📁 <b>${t(language, "shopOrder")}:</b> ${escapeHtml(checkout.reference)}`,
    ].join("\n"),
    [
      `<b>${t(language, "paymentMethodsHeader")}</b>`,
      paymentOptions.join("\n\n"),
    ].join("\n\n"),
    `⏱ <b>${t(language, "paymentWindow")}:</b> ${timeoutMinutes} minutes`,
  ]
    .filter(Boolean)
    .join("\n\n");
  await replaceCallbackMessage(ctx, summary, {
    parse_mode: "HTML",
    reply_markup: keyboard,
  });
}

async function refreshCheckoutSummary(
  ctx: Context,
  user: typeof users.$inferSelect,
  checkoutId: string,
  notice?: string,
) {
  const rows = await db
    .select()
    .from(checkoutSessions)
    .where(
      and(
        eq(checkoutSessions.id, checkoutId),
        eq(checkoutSessions.userId, user.id),
        eq(checkoutSessions.status, "pending"),
        isNull(checkoutSessions.paymentMethod),
        gt(checkoutSessions.expiresAt, new Date()),
      ),
    )
    .limit(1);
  if (!rows[0]) {
    await ctx.reply(t(languageOf(user), "promoCodeCheckoutUnavailable"));
    return false;
  }
  await showCheckoutSummary(ctx, user, rows[0], notice);
  return true;
}

async function promptForPromoCode(
  ctx: Context,
  user: typeof users.$inferSelect,
  checkoutId: string,
) {
  const refreshed = await refreshCheckoutSummary(ctx, user, checkoutId);
  if (!refreshed) return;
  promoCodeInputs.set(user.id, checkoutId);
  await ctx.reply(t(languageOf(user), "promoCodePrompt"), {
    reply_markup: new InlineKeyboard()
      .text(t(languageOf(user), "promoCodePromptCancel"), `promo:cancel:${checkoutId}`),
  });
}

async function acceptPromoCodeInput(
  ctx: Context,
  user: typeof users.$inferSelect,
  value: string,
) {
  const checkoutId = promoCodeInputs.get(user.id);
  if (!checkoutId) return false;
  const normalizedInput = value.trim();
  const language = languageOf(user);
  if (
    normalizedInput.startsWith("/") ||
    normalizedInput === t(language, "menu") ||
    normalizedInput === t(language, "home") ||
    normalizedInput === t(language, "mainMenu")
  ) {
    promoCodeInputs.delete(user.id);
    return false;
  }

  const result = await reservePromoCodeForCheckout({
    checkoutSessionId: checkoutId,
    userId: user.id,
    code: normalizedInput,
  });
  if (!result.ok) {
    if (result.reason === "checkout_unavailable") {
      promoCodeInputs.delete(user.id);
      await ctx.reply(t(language, "promoCodeCheckoutUnavailable"));
      return true;
    }
    const message =
      result.reason === "ineligible"
        ? t(language, "promoCodeIneligible")
        : result.reason === "limit_reached"
          ? t(language, "promoCodeLimitReached")
          : t(language, "promoCodeInvalid");
    await ctx.reply(message);
    return true;
  }

  promoCodeInputs.delete(user.id);
  const notice = t(language, "promoCodeApplied")
    .replace("{code}", result.code)
    .replace("{discount}", result.discountUsd);
  await refreshCheckoutSummary(ctx, user, checkoutId, notice);
  return true;
}

async function beginCheckout(
  ctx: Context,
  user: typeof users.$inferSelect,
  productId: string,
  requestedQuantity = 1,
  expectedPriceCents?: number,
) {
  if (!(await ensureAccess(ctx, user))) return;
  const rows = await db.select().from(products).where(and(eq(products.id, productId), eq(products.active, true))).limit(1);
  let product = rows[0];
  if (!product) return;
  let availability: Awaited<ReturnType<typeof getProductAvailability>>;
  try {
    const state = await getBuyerProductState(product, requestedQuantity);
    product = state.product;
    availability = state.availability;
  } catch (error) {
    logger.warn({ err: error, productId }, "Unable to verify product before checkout");
    await replaceCallbackMessage(ctx, t(languageOf(user), "supplierUnavailable"), {
      reply_markup: new InlineKeyboard().text(t(languageOf(user), "backToShop"), "nav:shop"),
    });
    return;
  }
  const sale = await getActiveFlashSale(product.id);
  const price = effectiveProductPrice(product, sale);
  const priceCents = usdPriceCents(price);
  const maxQuantity = availability.maxQuantity;
  const quantity = Math.min(Math.max(Math.trunc(requestedQuantity), 1), maxQuantity);
  if (!availability.inStock || maxQuantity < 1 || quantity !== requestedQuantity) {
    await replaceCallbackMessage(ctx, t(languageOf(user), "outOfStock"), {
      reply_markup: new InlineKeyboard().text(t(languageOf(user), "backToShop"), "nav:shop"),
    });
    return;
  }
  if (expectedPriceCents !== undefined && expectedPriceCents !== priceCents) {
    await showQuantitySelector(
      ctx,
      user,
      productId,
      requestedQuantity,
      expectedPriceCents,
    );
    return;
  }
  const total = (Number(price) * quantity).toFixed(2);
  const reference = `KT${Date.now().toString(36).toUpperCase()}${user.id.replaceAll("-", "").slice(0, 6).toUpperCase()}`;
  const settings = await db
    .select({ timeout: storeSettings.checkoutTimeoutMinutes })
    .from(storeSettings)
    .limit(1);
  const timeoutMinutes = Math.min(60, Math.max(1, settings[0]?.timeout ?? 5));
  const expiresAt = new Date(Date.now() + timeoutMinutes * 60 * 1000);
  const checkout = await db.transaction(async (tx) => {
    const checkoutId = randomUUID();
    if (product.stockType === "limited") {
      const candidates = await tx
        .select({ id: inventoryItems.id })
        .from(inventoryItems)
        .where(and(eq(inventoryItems.productId, product.id), eq(inventoryItems.status, "available")))
        .orderBy(inventoryItems.createdAt)
        .limit(quantity);
      if (candidates.length !== quantity) return [];
      const reserved = await tx
        .update(inventoryItems)
        .set({ status: "reserved", updatedAt: new Date() })
        .where(and(
          inArray(inventoryItems.id, candidates.map((item) => item.id)),
          eq(inventoryItems.status, "available"),
        ))
        .returning({ id: inventoryItems.id });
      if (reserved.length !== quantity) return [];
      await tx.insert(inventoryReservations).values(reserved.map((item) => ({
        inventoryItemId: item.id,
        checkoutSessionId: checkoutId,
        expiresAt,
      })));
    }
    return tx.insert(checkoutSessions).values({
      id: checkoutId,
      reference,
      userId: user.id,
      productId: product.id,
      ventebotProductId: product.ventebotProductId,
      productNameSnapshot: product.nameEn,
      durationSnapshot: product.duration,
      warrantySnapshot: product.warranty,
      quantity,
       priceUsd: total,
      expiresAt,
    }).returning();
  });
  if (!checkout[0]) {
    await ctx.reply(t(languageOf(user), "outOfStock"));
    return;
  }
  await showCheckoutSummary(ctx, user, checkout[0]);
}

async function cancelCheckoutSession(checkoutId: string, userId: string) {
  return db.transaction(async (tx) => {
    const rows = await tx
    .update(checkoutSessions)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(
      and(
        eq(checkoutSessions.id, checkoutId),
        eq(checkoutSessions.userId, userId),
        eq(checkoutSessions.status, "pending"),
      ),
    )
    .returning({ id: checkoutSessions.id });
    if (!rows[0]) return rows;
    await releasePromoCodeReservation(tx, checkoutId);
    const released = await tx.update(inventoryReservations)
      .set({ releasedAt: new Date() })
      .where(and(eq(inventoryReservations.checkoutSessionId, checkoutId), isNull(inventoryReservations.releasedAt)))
      .returning({ inventoryItemId: inventoryReservations.inventoryItemId });
    if (released.length) {
      await tx.update(inventoryItems).set({ status: "available", updatedAt: new Date() })
        .where(and(inArray(inventoryItems.id, released.map((item) => item.inventoryItemId)), eq(inventoryItems.status, "reserved")));
    }
    return rows;
  });
}

async function ensureCheckoutPriceIsCurrent(
  ctx: Context,
  user: typeof users.$inferSelect,
  checkout: typeof checkoutSessions.$inferSelect,
) {
  let verification;
  try {
    verification = await verifyVenteBotCheckoutPrice(checkout.id);
  } catch (error) {
    logger.warn({ err: error, checkoutId: checkout.id }, "Unable to reverify checkout price");
    verification = {
      verified: false,
      supplierLinked: checkout.ventebotProductId !== null,
      priceChanged: false,
      oldUnitPriceUsd: (Number(checkout.priceUsd) / checkout.quantity).toFixed(2),
      currentUnitPriceUsd: null,
      expectedTotalUsd: null,
      reason: "Supplier verification failed",
    };
  }
  if (!verification.supplierLinked) return true;
  if (!verification.verified) {
    await cancelCheckoutSession(checkout.id, user.id);
    await replaceCallbackMessage(ctx, t(languageOf(user), "supplierUnavailable"), {
      reply_markup: new InlineKeyboard().text(t(languageOf(user), "backToShop"), "nav:shop"),
    });
    return false;
  }
  if (verification.priceChanged) {
    await cancelCheckoutSession(checkout.id, user.id);
    await showQuantitySelector(
      ctx,
      user,
      checkout.productId,
      checkout.quantity,
      usdPriceCents(verification.oldUnitPriceUsd),
    );
    return false;
  }
  return true;
}

async function cancelCheckout(ctx: Context, user: typeof users.$inferSelect, checkoutId: string) {
  if (promoCodeInputs.get(user.id) === checkoutId) promoCodeInputs.delete(user.id);
  const cancelled = await cancelCheckoutSession(checkoutId, user.id);
  await replaceCallbackMessage(
    ctx,
    cancelled[0]
      ? t(languageOf(user), "paymentCancelled")
      : t(languageOf(user), "error"),
    { reply_markup: customerKeyboard(languageOf(user)) },
  );
}

async function payCheckoutWithWallet(
  ctx: Context,
  user: typeof users.$inferSelect,
  checkoutId: string,
) {
  const preflightRows = await db
    .select()
    .from(checkoutSessions)
    .where(and(
      eq(checkoutSessions.id, checkoutId),
      eq(checkoutSessions.userId, user.id),
      eq(checkoutSessions.status, "pending"),
      gt(checkoutSessions.expiresAt, new Date()),
    ))
    .limit(1);
  if (
    preflightRows[0] &&
    !(await ensureCheckoutPriceIsCurrent(ctx, user, preflightRows[0]))
  ) {
    return true;
  }
  const result = await db.transaction(async (tx) => {
    // Serialize wallet purchases for this customer so two Telegram taps cannot
    // spend the same available balance.
    await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, user.id))
      .for("update");

    const rows = await tx
      .select({
        checkout: checkoutSessions,
        deliveryType: products.deliveryType,
        stockType: products.stockType,
      })
      .from(checkoutSessions)
      .innerJoin(products, eq(checkoutSessions.productId, products.id))
      .where(
        and(
          eq(checkoutSessions.id, checkoutId),
          eq(checkoutSessions.userId, user.id),
          eq(checkoutSessions.status, "pending"),
          gt(checkoutSessions.expiresAt, new Date()),
        ),
      )
      .limit(1);
    const checkout = rows[0];
    if (!checkout) return { status: "unavailable" as const };
    const pricing = await getCheckoutPromoPricing(
      checkout.checkout.id,
      checkout.checkout.priceUsd,
      tx,
    );

    const balanceRows = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, user.id))
      .for("update")
      .limit(1);
    if (!balanceRows[0]) return { status: "unavailable" as const };

    const walletBalanceRows = await tx
      .select({ balance: sum(walletTransactions.amountUsd) })
      .from(walletTransactions)
      .where(eq(walletTransactions.userId, user.id));
    const balance = Number(walletBalanceRows[0]?.balance ?? 0);
    const amount = Number(pricing.totalUsd);
    if (!Number.isFinite(amount) || balance < amount) {
      return {
        status: "insufficient" as const,
        balance: balance.toFixed(2),
        amount: amount.toFixed(2),
      };
    }

    const now = new Date();
    const claimed = await tx
      .update(checkoutSessions)
      .set({
        paymentMethod: "wallet",
        status: "confirmed",
        updatedAt: now,
      })
      .where(
        and(
          eq(checkoutSessions.id, checkoutId),
          eq(checkoutSessions.userId, user.id),
          eq(checkoutSessions.status, "pending"),
          gt(checkoutSessions.expiresAt, now),
        ),
      )
      .returning({ id: checkoutSessions.id });
    if (!claimed[0]) return { status: "unavailable" as const };

    const orderRows = await tx
      .insert(orders)
      .values({
        orderNumber: checkout.checkout.reference,
        userId: user.id,
        productId: checkout.checkout.productId,
        ventebotProductId: checkout.checkout.ventebotProductId,
        checkoutSessionId: checkout.checkout.id,
        productNameSnapshot: checkout.checkout.productNameSnapshot,
        durationSnapshot: checkout.checkout.durationSnapshot,
        warrantySnapshot: checkout.checkout.warrantySnapshot,
        quantity: checkout.checkout.quantity,
        priceUsd: pricing.totalUsd,
        egpAmount: null,
        exchangeRate: null,
        paymentMethod: "wallet",
        status: "paid",
        deliveryType: checkout.deliveryType,
        stockTypeSnapshot: checkout.stockType,
      })
      .returning();
    const order = orderRows[0];
    if (!order) throw new Error("Unable to create wallet-paid order");
    await redeemPromoCodeReservation(tx, {
      checkoutSessionId: checkout.checkout.id,
      userId: user.id,
      orderId: order.id,
    });
    if (checkout.checkout.ventebotProductId !== null) {
      await tx
        .insert(ventebotOrderFulfillments)
        .values(createVenteBotFulfillmentValues(
          order.id,
          checkout.checkout.ventebotProductId,
        ))
        .onConflictDoNothing();
    }

    await tx.insert(payments).values({
      checkoutSessionId: checkout.checkout.id,
      orderId: order.id,
      userId: user.id,
      paymentMethod: "wallet",
      usdAmount: pricing.totalUsd,
      transactionReference: `wallet:${order.orderNumber}`,
      status: "confirmed",
      submittedAt: now,
    });
    await tx.insert(walletTransactions).values({
      userId: user.id,
      orderId: order.id,
      type: "purchase_adjustment",
      amountUsd: (-amount).toFixed(2),
      reason: `Wallet payment for order ${order.orderNumber}`,
      reference: order.orderNumber,
    });

    return { status: "confirmed" as const, orderId: order.id };
  });

  const language = languageOf(user);
  if (result.status === "insufficient") {
    await replaceCallbackMessage(
      ctx,
      t(language, "walletInsufficientBalance")
        .replace("{balance}", result.balance)
        .replace("{amount}", result.amount),
      { reply_markup: customerKeyboard(language) },
    );
    return true;
  }
  if (result.status === "unavailable") {
    await replaceCallbackMessage(ctx, t(language, "walletPaymentAlreadyProcessed"), {
      reply_markup: customerKeyboard(language),
    });
    return true;
  }

  const notified = await notifyOrderConfirmed(result.orderId);
  if (!notified) {
    await replaceCallbackMessage(ctx, t(language, "walletPaymentConfirmed"), {
      reply_markup: customerKeyboard(language),
    });
  }
  return true;
}

async function showPayment(
  ctx: Context,
  user: typeof users.$inferSelect,
  checkoutId: string,
  method: string,
) {
  const checkout = await db.select().from(checkoutSessions).where(and(eq(checkoutSessions.id, checkoutId), eq(checkoutSessions.userId, user.id), gt(checkoutSessions.expiresAt, new Date()))).limit(1);
  if (!checkout[0]) return;
  const language = languageOf(user);
  if (!isCheckoutPaymentMethod(method)) {
    await replaceCallbackMessage(ctx, t(language, "paymentUnavailable"));
    return;
  }
  if (method === "wallet") {
    await payCheckoutWithWallet(ctx, user, checkoutId);
    return;
  }
  if (!(await ensureCheckoutPriceIsCurrent(ctx, user, checkout[0]))) return;
  await db.update(checkoutSessions).set({ paymentMethod: method }).where(eq(checkoutSessions.id, checkoutId));
  const config = await db.select().from(paymentMethods).where(and(eq(paymentMethods.method, method), eq(paymentMethods.enabled, true))).limit(1);
  if (!config[0]) {
    await replaceCallbackMessage(ctx, t(language, "paymentUnavailable"));
    return;
  }
  const instructions = config[0].instructionsEn;
  const recipientUid = config[0].paymentIdentifier?.trim();
  const pricing = await getCheckoutPromoPricing(
    checkout[0].id,
    checkout[0].priceUsd,
  );
  const exactAmount = pricing.totalUsd;
  const details = method === "binance" && recipientUid
    ? [
        `<b>${t(language, "binancePaymentTitle")}</b>`,
        "",
        `${t(language, "binanceProductLabel")}: ⭕️ ${escapeHtml(checkout[0].productNameSnapshot)}`,
        `${t(language, "binanceQuantityLabel")}: ${checkout[0].quantity}`,
        `${t(language, "subtotal")}: ${pricing.subtotalUsd} USDT`,
        ...(pricing.code
          ? [
              `${t(language, "promoCodeLabel")}: ${escapeHtml(pricing.code)}`,
              `${t(language, "promoCodeDiscount")}: -${pricing.discountUsd} USDT`,
            ]
          : []),
        `${t(language, "binanceAmountLabel")}: <b>${exactAmount} USDT</b>`,
        "",
        `<b>${t(language, "binanceRecipientLabel")}:</b>`,
        `<code>${escapeHtml(recipientUid)}</code>`,
        "",
        `<b>${t(language, "binanceImportantLabel")}</b>`,
        t(language, "binanceTransferStep").replace("{amount}", exactAmount),
        t(language, "binanceTransactionStep"),
        "",
        t(language, "binanceFindTransaction"),
        t(language, "binanceRejectShortId"),
      ].join("\n")
    : [
        t(language, "paymentInstructions"),
        escapeHtml(instructions),
        `Reference: ${escapeHtml(checkout[0].reference)}`,
        `${t(language, "quantity")}: ${checkout[0].quantity}`,
        `${t(language, "subtotal")}: ${pricing.subtotalUsd} USDT`,
        ...(pricing.code
          ? [
              `${t(language, "promoCodeLabel")}: ${escapeHtml(pricing.code)}`,
              `${t(language, "promoCodeDiscount")}: -${pricing.discountUsd} USDT`,
            ]
          : []),
        `${t(language, "total")}: <b>${pricing.totalUsd} USDT</b>`,
        recipientUid ? `Recipient: ${escapeHtml(recipientUid)}` : "",
      ].filter(Boolean).join("\n");
  const logoPath = paymentLogoPath(method);
  if (logoPath) {
    if (ctx.callbackQuery?.message) {
      try {
        await ctx.api.deleteMessage(ctx.chat!.id, ctx.callbackQuery.message.message_id);
      } catch (error) {
        logger.warn({ err: error }, "Unable to remove checkout message before payment logo");
      }
    }
    await ctx.replyWithPhoto(new InputFile(logoPath), {
      caption: paymentMethodLabel(method, language),
    });
    await ctx.reply(details, {
      parse_mode: "HTML",
      reply_markup: new InlineKeyboard().text(t(language, "iHavePaid"), `paid:${checkoutId}`).row().text(t(language, "cancel"), `checkout:cancel:${checkoutId}`),
    });
    return;
  }
  await replaceCallbackMessage(ctx, details, {
    parse_mode: "HTML",
    reply_markup: new InlineKeyboard().text(t(language, "iHavePaid"), `paid:${checkoutId}`).row().text(t(language, "cancel"), `checkout:cancel:${checkoutId}`),
  });
}

async function acceptPaymentReference(ctx: Context, user: typeof users.$inferSelect, reference: string) {
  const checkout = await db.select().from(checkoutSessions).where(and(eq(checkoutSessions.userId, user.id), eq(checkoutSessions.status, "pending"), gt(checkoutSessions.expiresAt, new Date()))).orderBy(desc(checkoutSessions.createdAt)).limit(1);
  if (!checkout[0] || !checkout[0].paymentMethod) return false;
  const pricing = await getCheckoutPromoPricing(
    checkout[0].id,
    checkout[0].priceUsd,
  );
  const submittedReference = reference.trim();
  if (checkout[0].paymentMethod === "binance" && !/^\S{6,128}$/.test(submittedReference)) {
    await ctx.reply(t(languageOf(user), "invalidBinanceTransactionId"));
    return true;
  }
  const existing = await db.select({ id: payments.id }).from(payments).where(eq(payments.transactionReference, submittedReference)).limit(1);
  if (existing.length > 0) {
    await ctx.reply(t(languageOf(user), "error"));
    return true;
  }
  if (checkout[0].ventebotProductId !== null) {
    const verification = await verifyVenteBotCheckoutPrice(checkout[0].id);
    if (!verification.verified || verification.priceChanged) {
      const reason = verification.priceChanged
        ? "The verified supplier resale price changed after payment instructions were created."
        : `Supplier verification failed after payment was sent: ${verification.reason ?? "unknown supplier error"}`;
      const flagged = await db.transaction(async (tx) => {
        const claimed = await tx
          .update(checkoutSessions)
          .set({ status: "submitted", submittedAt: new Date(), updatedAt: new Date() })
          .where(and(
            eq(checkoutSessions.id, checkout[0].id),
            eq(checkoutSessions.status, "pending"),
            gt(checkoutSessions.expiresAt, new Date()),
          ))
          .returning({ id: checkoutSessions.id });
        if (!claimed[0]) return false;
        await tx.insert(payments).values({
          checkoutSessionId: checkout[0].id,
          userId: user.id,
          paymentMethod: checkout[0].paymentMethod!,
          usdAmount: pricing.totalUsd,
          transactionReference: submittedReference,
          status: "verification_failed",
          verificationFailureReason: reason,
          submittedAt: new Date(),
        });
        return true;
      });
      if (!flagged) {
        await ctx.reply(t(languageOf(user), "error"));
        return true;
      }
      await ctx.reply(t(languageOf(user), "supplierPaymentReview"), {
        reply_markup: customerKeyboard(languageOf(user)),
      });
      return true;
    }
  }
  const submitted = await db.transaction(async (tx) => {
    const claimed = await tx.update(checkoutSessions)
      .set({ status: "submitted", submittedAt: new Date() })
      .where(and(eq(checkoutSessions.id, checkout[0].id), eq(checkoutSessions.status, "pending"), gt(checkoutSessions.expiresAt, new Date())))
      .returning({ id: checkoutSessions.id });
    if (!claimed[0]) return false;
    const created = await tx
      .insert(payments)
      .values({
        checkoutSessionId: checkout[0].id,
        userId: user.id,
        paymentMethod: checkout[0].paymentMethod!,
        usdAmount: pricing.totalUsd,
        transactionReference: submittedReference,
        status: "submitted",
        submittedAt: new Date(),
      })
      .returning({ id: payments.id });
    return created[0];
  });
  if (!submitted) {
    await ctx.reply(t(languageOf(user), "error"));
    return true;
  }
  if (checkout[0].paymentMethod === "binance") {
    await showVerificationLoading(
      ctx,
      user,
      `product-payment:${submitted.id}:verification`,
      {
        paymentKind: "order",
          amountUsd: pricing.totalUsd,
        transactionId: submittedReference,
      },
    );
    scheduleBinancePaymentProcessing();
  } else {
    await ctx.reply(t(languageOf(user), "paymentSubmitted"), {
      reply_markup: customerKeyboard(languageOf(user)),
    });
  }
  return true;
}

export function buildTelegramBot() {
  if (!telegramBot) return null;
  const bot = telegramBot;
  bot.catch((error) => {
    logger.error({ err: error }, "Telegram update handler failed");
  });
  bot.use(async (ctx, next) => {
    logger.info({ updateId: ctx.update.update_id }, "Telegram update received");
    await next();
  });
  bot.command("start", async (ctx) => {
    const startPayload = parseTelegramStartPayload(ctx.match);
    const foundUser = await findOrCreateCustomer(ctx);
    const user = foundUser
      ? await applyReferralCode(foundUser, startPayload.referralCode)
      : null;
    if (!user) return;
    const firstStart =
      user.language === "en" &&
      user.createdAt.getTime() === user.updatedAt.getTime();
    if (firstStart) {
      if (await ensureAccess(ctx, user)) {
        if (startPayload.productId) await showProduct(ctx, user, startPayload.productId, true);
        else if (startPayload.openShop) await showShop(ctx, user, false, true);
        else {
          await refreshSupplierCatalogForBuyer();
          await showHome(ctx, user);
        }
      }
      return;
    }
    if (startPayload.productId) {
      await showProduct(ctx, user, startPayload.productId);
      return;
    }
    if (startPayload.openShop) {
      await showShop(ctx, user);
      return;
    }
    if (await ensureAccess(ctx, user)) {
      await refreshSupplierCatalogForBuyer();
      await showHome(ctx, user);
    }
  });
  bot.command("chatid", async (ctx) => {
    await ctx.reply(`Your Telegram chat ID is: ${ctx.chat.id}`);
  });
  bot.command("shop", async (ctx) => {
    const user = await findOrCreateCustomer(ctx);
    if (user) await showShop(ctx, user);
  });
  bot.command("menu", async (ctx) => {
    const user = await findOrCreateCustomer(ctx);
    if (user && (await ensureAccess(ctx, user))) await showHome(ctx, user);
  });
  bot.command("wallet", async (ctx) => {
    const user = await findOrCreateCustomer(ctx);
    if (user) await showWallet(ctx, user);
  });
  bot.command("orders", async (ctx) => {
    const user = await findOrCreateCustomer(ctx);
    if (user) await showOrders(ctx, user);
  });
  bot.command("profile", async (ctx) => {
    const user = await findOrCreateCustomer(ctx);
    if (user) await showProfile(ctx, user);
  });
  bot.command("support", async (ctx) => {
    const user = await findOrCreateCustomer(ctx);
    if (user) await showSupport(ctx, user);
  });
  bot.on("callback_query:data", async (ctx) => {
    const user = await findOrCreateCustomer(ctx);
    if (!user) return;
    const data = ctx.callbackQuery.data;
    await ctx.answerCallbackQuery();
    if (data.startsWith("language:")) {
      await ctx.reply("The bot is available in English only.");
      if (await ensureAccess(ctx, user)) await showHome(ctx, user);
      return;
    }
    if (data === "channel:recheck") {
      if (await ensureAccess(ctx, user)) await showHome(ctx, user);
      return;
    }
    if (data === "nav:home") {
      if (await ensureAccess(ctx, user)) await showHome(ctx, user, true);
      return;
    }
    if (data.startsWith("promo:apply:")) {
      await promptForPromoCode(ctx, user, data.slice("promo:apply:".length));
      return;
    }
    if (data.startsWith("promo:remove:")) {
      const checkoutId = data.slice("promo:remove:".length);
      if (promoCodeInputs.get(user.id) === checkoutId) promoCodeInputs.delete(user.id);
      const removed = await removePromoCodeFromCheckout(checkoutId, user.id);
      if (!removed) {
        await refreshCheckoutSummary(ctx, user, checkoutId);
        return;
      }
      await refreshCheckoutSummary(ctx, user, checkoutId, t(languageOf(user), "promoCodeRemoved"));
      return;
    }
    if (data.startsWith("promo:cancel:")) {
      const checkoutId = data.slice("promo:cancel:".length);
      if (promoCodeInputs.get(user.id) === checkoutId) promoCodeInputs.delete(user.id);
      await refreshCheckoutSummary(ctx, user, checkoutId);
      return;
    }
    if (data.startsWith("checkout:cancel:")) {
      await cancelCheckout(ctx, user, data.slice("checkout:cancel:".length));
      return;
    }
    if (data === "nav:wallet") {
      await showWallet(ctx, user);
      return;
    }
    if (data === "nav:orders") {
      await showOrders(ctx, user);
      return;
    }
    if (data === "nav:support") {
      await showSupport(ctx, user);
      return;
    }
    if (data === "support:list") {
      await showSupportTickets(ctx, user);
      return;
    }
    if (data.startsWith("support:reply:cancel:")) {
      const ticketId = data.slice("support:reply:cancel:".length);
      supportReplyDrafts.delete(user.id);
      await showSupportTicket(ctx, user, ticketId);
      return;
    }
    if (data.startsWith("support:reply:")) {
      await beginSupportReply(ctx, user, data.slice("support:reply:".length));
      return;
    }
    if (data.startsWith("support:ticket:")) {
      await showSupportTicket(ctx, user, data.slice("support:ticket:".length));
      return;
    }
    if (data === "nav:refer") {
      await showReferral(ctx, user);
      return;
    }
    if (data === "support:write") {
      await beginSupportMessage(ctx, user);
      return;
    }
    if (data === "support:cancel") {
      supportDraftUsers.delete(user.id);
      await showSupport(ctx, user);
      return;
    }
    if (data === "wallet:topup") {
      await showWalletTopup(ctx, user);
      return;
    }
    if (data.startsWith("wallet:method:")) {
      const method = data.slice("wallet:method:".length);
      if (method === "binance") await beginWalletTopUp(ctx, user);
      else if (method === "bybit" || method === "vodafone_cash") {
        await showWalletPaymentMethod(ctx, user, method);
      } else {
        await ctx.reply(t(languageOf(user), "paymentUnavailable"));
      }
      return;
    }
    if (data === "nav:shop") {
      await showShop(ctx, user, true);
      return;
    }
    if (data === "shop:refresh") {
      await showShop(ctx, user, true);
      return;
    }
    if (data === "nav:channel") {
      await ctx.reply(t(languageOf(user), "comingSoon"));
      return;
    }
    if (data === "quantity:noop") return;
    if (data.startsWith("quantity:")) {
      const [, productId, action, rawQuantity, rawPriceCents] = data.split(":");
      const currentQuantity = Number(rawQuantity || 1);
      const expectedPriceCents = parseUsdPriceToken(
        action === "custom" ? rawPriceCents ?? rawQuantity : rawPriceCents,
      );
      if (action === "back") {
        customQuantityProducts.delete(user.id);
        await showProduct(ctx, user, productId);
        return;
      }
      if (action === "custom") {
        customQuantityProducts.set(user.id, {
          productId,
          expectedPriceCents,
        });
        await replaceCallbackMessage(ctx, t(languageOf(user), "enterCustomQuantity"), {
          reply_markup: new InlineKeyboard().text(
            t(languageOf(user), "back"),
            `quantity:${productId}:back`,
          ),
        });
        return;
      }
      if (action === "confirm") {
        await beginCheckout(
          ctx,
          user,
          productId,
          currentQuantity,
          expectedPriceCents,
        );
        return;
      }
      if (action === "set") {
        await beginCheckout(
          ctx,
          user,
          productId,
          currentQuantity,
          expectedPriceCents,
        );
        return;
      }
      if (action === "max") {
        await showQuantitySelector(
          ctx,
          user,
          productId,
          99,
          expectedPriceCents,
        );
        return;
      }
      if (action === "minus" || action === "plus") {
        await showQuantitySelector(
          ctx,
          user,
          productId,
          currentQuantity + (action === "plus" ? 1 : -1),
          expectedPriceCents,
        );
        return;
      }
    }
    if (data.startsWith("product:")) {
      if (data.startsWith("product:refresh:")) {
        await showProduct(ctx, user, data.slice("product:refresh:".length));
        return;
      }
      await showProduct(ctx, user, data.slice("product:".length));
      return;
    }
    if (data.startsWith("buy:")) {
      const [, productId, rawPriceCents] = data.split(":");
      const expectedPriceCents = parseUsdPriceToken(rawPriceCents);
      await showQuantitySelector(
        ctx,
        user,
        productId,
        1,
        expectedPriceCents,
      );
      return;
    }
    if (data.startsWith("method:")) {
      const [, checkoutId, method] = data.split(":");
      await showPayment(ctx, user, checkoutId, method);
      return;
    }
    if (data.startsWith("paid:")) {
      const checkout = await db
        .select({ paymentMethod: checkoutSessions.paymentMethod })
        .from(checkoutSessions)
        .where(
          and(
            eq(checkoutSessions.id, data.slice("paid:".length)),
            eq(checkoutSessions.userId, user.id),
            eq(checkoutSessions.status, "pending"),
          ),
        )
        .limit(1);
      await replaceCallbackMessage(
        ctx,
        checkout[0]?.paymentMethod === "binance"
          ? t(languageOf(user), "enterBinanceTransactionId")
          : t(languageOf(user), "enterReference"),
      );
    }
  });
  bot.on("message:text", async (ctx) => {
    const user = await findOrCreateCustomer(ctx);
    if (!user) return;
    if (await acceptPromoCodeInput(ctx, user, ctx.message.text)) return;
    if (await acceptCustomQuantity(ctx, user, ctx.message.text)) return;
    if (await acceptSupportReply(ctx, user, ctx.message.text)) return;
    if (await acceptSupportMessage(ctx, user, ctx.message.text)) return;
    if (await acceptWalletTopUpTransactionId(ctx, user, ctx.message.text)) return;
    if (await acceptPaymentReference(ctx, user, ctx.message.text)) return;
    if (await acceptWalletTopUpAmount(ctx, user, ctx.message.text)) return;
    const language = languageOf(user);
    if (ctx.message.text === t(language, "shop")) await showShop(ctx, user);
    else if (ctx.message.text === t(language, "profile")) await showProfile(ctx, user);
    else if (
      ctx.message.text === t(language, "deposit") ||
      ctx.message.text === t(language, "wallet")
    ) await showWallet(ctx, user);
    else if (ctx.message.text === t(language, "orders")) await showOrders(ctx, user);
    else if (ctx.message.text === t(language, "support")) await showSupport(ctx, user);
    else if (ctx.message.text === t(language, "refer")) await showReferral(ctx, user);
    else if (ctx.message.text === "⚙️ Settings") await showHome(ctx, user);
    else if (ctx.message.text === t(language, "menu") || ctx.message.text === t(language, "home") || ctx.message.text === t(language, "mainMenu")) {
      await showHome(ctx, user);
    }
  });
  return bot;
}

const webhookUnavailable = (
  _req: unknown,
  res: { status: (code: number) => { send: (body: string) => void } },
) => res.status(503).send("Telegram webhook is disabled while polling is active");

export const telegramWebhookHandler =
  telegramBot && process.env.NODE_ENV === "production"
    ? webhookCallback(telegramBot, "express")
    : webhookUnavailable;
