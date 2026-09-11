import { Bot, InlineKeyboard, InputFile, Keyboard, webhookCallback, type Context } from "grammy";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { and, count, desc, eq, gt } from "drizzle-orm";
import {
  checkoutSessions,
  db,
  inventoryItems,
  paymentMethods,
  payments,
  products,
  storeSettings,
  users,
} from "@workspace/db";
import { logger } from "../lib/logger";
import { t, type BotLanguage } from "./locales";

export const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN;
export const telegramBot = telegramBotToken ? new Bot(telegramBotToken) : null;

function languageOf(user: typeof users.$inferSelect): BotLanguage {
  return user.language;
}

function customerKeyboard(language: BotLanguage) {
  return new Keyboard()
    .text(t(language, "shop"))
    .text(t(language, "flashSale"))
    .row()
    .text(t(language, "orders"))
    .text(t(language, "wallet"))
    .row()
    .text(t(language, "refer"))
    .text(t(language, "support"))
    .row()
    .text(t(language, "settings"))
    .row()
    .text(t(language, "mainMenu"))
    .resized();
}

function languageKeyboard() {
  return new InlineKeyboard()
    .text("🇬🇧 English", "language:en")
    .text("🇸🇦 العربية", "language:ar");
}

function paymentMethodLabel(method: string) {
  const labels: Record<string, string> = {
    binance: "🟡 BINANCE",
    bybit: "🔷 BYBIT",
    vodafone_cash: "📱 VODAFONE CASH",
    instapay: "🏦 INSTAPAY",
  };
  return labels[method] ?? `💳 ${method.replace("_", " ").toUpperCase()}`;
}

function paymentLogoPath(method: string) {
  const filenames: Record<string, string> = {
    instapay: "instapay-logo.png",
    vodafone_cash: "vodafone-cash-logo.png",
  };
  const filename = filenames[method];
  if (!filename) return null;
  const path = resolve(process.cwd(), "artifacts/api-server/assets", filename);
  return existsSync(path) ? path : null;
}

async function findOrCreateCustomer(ctx: Context) {
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
  return created[0];
}

async function channelConfigured() {
  const settings = await db.select().from(storeSettings).limit(1);
  return settings[0]?.requiredTelegramChannel ?? null;
}

async function isChannelMember(ctx: Context, channel: string | null) {
  if (!channel || !ctx.from || !telegramBot) return true;
  try {
    const member = await telegramBot.api.getChatMember(channel, ctx.from.id);
    return ["creator", "administrator", "member"].includes(member.status);
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

async function showHome(ctx: Context, user: typeof users.$inferSelect) {
  const language = languageOf(user);
  await ctx.reply(t(language, "welcome"), {
    reply_markup: customerKeyboard(language),
  });
}

async function getProductAvailability(product: typeof products.$inferSelect) {
  if (product.stockType === "unlimited") {
    return { inStock: true, quantity: "∞" };
  }
  const stock = await db
    .select({ availableQuantity: count(inventoryItems.id) })
    .from(inventoryItems)
    .where(and(eq(inventoryItems.productId, product.id), eq(inventoryItems.status, "available")));
  const quantity = Number(stock[0]?.availableQuantity ?? 0);
  return { inStock: quantity > 0, quantity: String(quantity) };
}

async function showShop(ctx: Context, user: typeof users.$inferSelect, requestedPage = 0, editMessage = false) {
  if (!(await ensureAccess(ctx, user))) return;
  const language = languageOf(user);
  const rows = await db
    .select()
    .from(products)
    .where(eq(products.active, true))
    .orderBy(desc(products.createdAt));
  if (rows.length === 0) {
    await ctx.reply(t(language, "noProducts"), { reply_markup: customerKeyboard(language) });
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
  const pageSize = 10;
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const page = Math.min(Math.max(requestedPage, 0), pageCount - 1);
  const pageRows = rows.slice(page * pageSize, (page + 1) * pageSize);
  const keyboard = new InlineKeyboard();
  for (const product of pageRows) {
    const name = language === "ar" ? product.nameAr : product.nameEn;
    const isUnlimited = product.stockType === "unlimited";
    const quantity = isUnlimited ? "∞" : String(stockByProduct.get(product.id) ?? 0);
    const inStock = isUnlimited || quantity !== "0";
    keyboard
      .text(`${name} | ${product.priceUsd} USDT | ${inStock ? "🟢" : "🔴"} ${quantity}`, `product:${product.id}`)
      .row();
  }
  if (page > 0) keyboard.text(t(language, "previous"), `shop:page:${page - 1}`);
  keyboard.text(`${page + 1}/${pageCount}`, "shop:noop");
  if (page < pageCount - 1) keyboard.text(t(language, "next"), `shop:page:${page + 1}`);
  keyboard.row();
  keyboard.text(t(language, "refreshStock"), `shop:refresh:${page}`).row();
  const channel = await channelConfigured();
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
    .text(t(language, "checkoutNotice"), "nav:checkout")
    .row()
    .text(t(language, "mainMenu"), "nav:home");

  const text = "\u2060";

  if (editMessage && ctx.callbackQuery) {
    await ctx.editMessageText(text, { reply_markup: keyboard });
  } else {
    await ctx.reply(text, { reply_markup: keyboard });
  }
}

async function showProduct(ctx: Context, user: typeof users.$inferSelect, productId: string) {
  if (!(await ensureAccess(ctx, user))) return;
  const rows = await db.select().from(products).where(and(eq(products.id, productId), eq(products.active, true))).limit(1);
  const product = rows[0];
  if (!product) return;
  const language = languageOf(user);
  const name = language === "ar" ? product.nameAr : product.nameEn;
  const instructions = language === "ar" ? product.instructionsAr : product.instructionsEn;
  const availability = await getProductAvailability(product);
  const keyboard = new InlineKeyboard();
  if (availability.inStock) {
    keyboard.text(`${t(language, "buyNow")} · ${product.priceUsd} USDT`, `buy:${product.id}`).row();
  }
  keyboard
    .text(t(language, "refreshStock"), `product:refresh:${product.id}`)
    .row()
    .text(t(language, "backToShop"), "nav:shop");
  const details = [
    `🧩 ${name}`,
    "",
    `💲 ${t(language, "price")}: ${product.priceUsd} USDT`,
    `📊 ${t(language, "status")}: ${availability.inStock ? `🟢 ${t(language, "available")}` : `🔴 ${t(language, "outOfStock")}`}`,
    `📦 ${t(language, "quantity")}: ${availability.quantity}`,
    "",
    `📝 ${t(language, "description")}`,
    instructions || "• —",
    "",
    `🛡 ${t(language, "warranty")}`,
    product.warranty || "—",
    "",
    `📌 ${t(language, "importantNotes")}`,
    `• ${t(language, "duration")}: ${product.duration}`,
    "",
    `📖 ${t(language, "quickGuide")}`,
    t(language, "guideReview"),
    t(language, "guideBuy"),
    t(language, "guidePay"),
    t(language, "guideDelivery"),
    "",
    `📦 ${t(language, "deliveryNotice")}`,
  ].join("\n");
  if (product.imageUrl) {
    try {
      await ctx.replyWithPhoto(product.imageUrl, { caption: details, reply_markup: keyboard });
      return;
    } catch (error) {
      logger.warn({ err: error, productId: product.id }, "Unable to send product image");
    }
  }
  await ctx.reply(details, { reply_markup: keyboard });
}

async function beginCheckout(ctx: Context, user: typeof users.$inferSelect, productId: string) {
  if (!(await ensureAccess(ctx, user))) return;
  const rows = await db.select().from(products).where(and(eq(products.id, productId), eq(products.active, true))).limit(1);
  const product = rows[0];
  if (!product) return;
  const available = product.stockType === "unlimited"
    ? true
    : (await db.select({ id: inventoryItems.id }).from(inventoryItems).where(and(eq(inventoryItems.productId, product.id), eq(inventoryItems.status, "available"))).limit(1)).length > 0;
  if (!available) {
    await ctx.reply(t(languageOf(user), "outOfStock"));
    return;
  }
  const reference = `KT-${Date.now().toString(36).toUpperCase()}`;
  const checkout = await db.insert(checkoutSessions).values({
    reference,
    userId: user.id,
    productId: product.id,
    productNameSnapshot: product.nameEn,
    durationSnapshot: product.duration,
    warrantySnapshot: product.warranty,
    priceUsd: product.priceUsd,
    expiresAt: new Date(Date.now() + 5 * 60 * 1000),
  }).returning();
  const methods = await db.select().from(paymentMethods).where(eq(paymentMethods.enabled, true));
  const language = languageOf(user);
  const keyboard = new InlineKeyboard();
  for (const method of methods) {
    keyboard.text(paymentMethodLabel(method.method), `method:${checkout[0].id}:${method.method}`).row();
  }
  keyboard.text(t(language, "cancel"), "nav:home");
  await ctx.reply(`${t(language, "choosePayment")}\n\nReference: ${reference}\n${t(language, "price")}: $${product.priceUsd}`, { reply_markup: keyboard });
}

async function showPayment(ctx: Context, user: typeof users.$inferSelect, checkoutId: string, method: "binance" | "bybit" | "vodafone_cash" | "instapay") {
  const checkout = await db.select().from(checkoutSessions).where(and(eq(checkoutSessions.id, checkoutId), eq(checkoutSessions.userId, user.id), gt(checkoutSessions.expiresAt, new Date()))).limit(1);
  if (!checkout[0]) return;
  await db.update(checkoutSessions).set({ paymentMethod: method }).where(eq(checkoutSessions.id, checkoutId));
  const config = await db.select().from(paymentMethods).where(and(eq(paymentMethods.method, method), eq(paymentMethods.enabled, true))).limit(1);
  const language = languageOf(user);
  if (!config[0]) {
    await ctx.reply(t(language, "paymentUnavailable"));
    return;
  }
  const details = [
    t(language, "paymentInstructions"),
    config[0].instructionsEn,
    `Reference: ${checkout[0].reference}`,
    `${t(language, "price")}: $${checkout[0].priceUsd}`,
    config[0].paymentIdentifier ? `Recipient: ${config[0].paymentIdentifier}` : "",
  ].filter(Boolean).join("\n");
  const logoPath = paymentLogoPath(method);
  if (logoPath) {
    await ctx.replyWithPhoto(new InputFile(logoPath), {
      caption: paymentMethodLabel(method),
    });
  }
  await ctx.reply(details, { reply_markup: new InlineKeyboard().text(t(language, "iHavePaid"), `paid:${checkoutId}`).row().text(t(language, "cancel"), "nav:home") });
}

async function acceptPaymentReference(ctx: Context, user: typeof users.$inferSelect, reference: string) {
  const checkout = await db.select().from(checkoutSessions).where(and(eq(checkoutSessions.userId, user.id), eq(checkoutSessions.status, "pending"), gt(checkoutSessions.expiresAt, new Date()))).orderBy(desc(checkoutSessions.createdAt)).limit(1);
  if (!checkout[0] || !checkout[0].paymentMethod) return false;
  const existing = await db.select({ id: payments.id }).from(payments).where(eq(payments.transactionReference, reference)).limit(1);
  if (existing.length > 0) {
    await ctx.reply(t(languageOf(user), "error"));
    return true;
  }
  await db.transaction(async (tx) => {
    await tx.update(checkoutSessions).set({ status: "submitted", submittedAt: new Date() }).where(eq(checkoutSessions.id, checkout[0].id));
    await tx.insert(payments).values({
      checkoutSessionId: checkout[0].id,
      userId: user.id,
      paymentMethod: checkout[0].paymentMethod!,
      usdAmount: checkout[0].priceUsd,
      transactionReference: reference,
      status: "submitted",
      submittedAt: new Date(),
    });
  });
  await ctx.reply(t(languageOf(user), "paymentSubmitted"), { reply_markup: customerKeyboard(languageOf(user)) });
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
    const user = await findOrCreateCustomer(ctx);
    if (!user) return;
    if (user.language === "en" && user.createdAt.getTime() === user.updatedAt.getTime()) {
      await ctx.reply(t("en", "chooseLanguage"), { reply_markup: languageKeyboard() });
      return;
    }
    if (await ensureAccess(ctx, user)) await showHome(ctx, user);
  });
  bot.command("shop", async (ctx) => {
    const user = await findOrCreateCustomer(ctx);
    if (user) await showShop(ctx, user);
  });
  bot.on("callback_query:data", async (ctx) => {
    const user = await findOrCreateCustomer(ctx);
    if (!user) return;
    const data = ctx.callbackQuery.data;
    await ctx.answerCallbackQuery();
    if (data.startsWith("language:")) {
      const language = data.split(":")[1] as BotLanguage;
      await db.update(users).set({ language, updatedAt: new Date() }).where(eq(users.id, user.id));
      const updated = { ...user, language };
      await ctx.reply(t(language, "languageUpdated"));
      if (await ensureAccess(ctx, updated)) await showHome(ctx, updated);
      return;
    }
    if (data === "channel:recheck") {
      if (await ensureAccess(ctx, user)) await showHome(ctx, user);
      return;
    }
    if (data === "nav:home") {
      if (await ensureAccess(ctx, user)) await showHome(ctx, user);
      return;
    }
    if (data === "nav:shop") {
      await showShop(ctx, user);
      return;
    }
    if (data.startsWith("shop:page:")) {
      await showShop(ctx, user, Number(data.slice("shop:page:".length)), true);
      return;
    }
    if (data.startsWith("shop:refresh:")) {
      await showShop(ctx, user, Number(data.slice("shop:refresh:".length)), true);
      return;
    }
    if (data === "shop:noop") return;
    if (data === "nav:orders" || data === "nav:wallet" || data === "nav:checkout" || data === "nav:channel") {
      await ctx.reply(t(languageOf(user), "comingSoon"));
      return;
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
      await beginCheckout(ctx, user, data.slice("buy:".length));
      return;
    }
    if (data.startsWith("method:")) {
      const [, checkoutId, method] = data.split(":");
      await showPayment(ctx, user, checkoutId, method as "binance" | "bybit" | "vodafone_cash" | "instapay");
      return;
    }
    if (data.startsWith("paid:")) {
      await ctx.reply(t(languageOf(user), "enterReference"));
    }
  });
  bot.on("message:text", async (ctx) => {
    const user = await findOrCreateCustomer(ctx);
    if (!user) return;
    if (await acceptPaymentReference(ctx, user, ctx.message.text)) return;
    const language = languageOf(user);
    if (ctx.message.text === t(language, "shop")) await showShop(ctx, user);
    else if (ctx.message.text === t(language, "settings")) await ctx.reply(t(language, "chooseLanguage"), { reply_markup: languageKeyboard() });
    else if (ctx.message.text === t(language, "home") || ctx.message.text === t(language, "mainMenu")) {
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
