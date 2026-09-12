import {
  boolean,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const id = () => uuid("id").defaultRandom().primaryKey();
const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).defaultNow().notNull();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date());

export const languageEnum = pgEnum("language", ["en", "ar"]);
export const adminRoleEnum = pgEnum("admin_role", [
  "super_admin",
  "support_agent",
]);
export const deliveryTypeEnum = pgEnum("delivery_type", ["automatic", "manual"]);
export const stockTypeEnum = pgEnum("stock_type", ["unlimited", "limited"]);
export const inventoryStatusEnum = pgEnum("inventory_status", [
  "available",
  "reserved",
  "delivered",
  "disabled",
]);
export const orderStatusEnum = pgEnum("order_status", [
  "paid",
  "processing",
  "delivered",
  "cancelled",
]);
export const paymentMethodEnum = pgEnum("payment_method", [
  "binance",
  "bybit",
  "vodafone_cash",
  "instapay",
]);
export const paymentStatusEnum = pgEnum("payment_status", [
  "pending",
  "submitted",
  "confirmed",
  "rejected",
  "cancelled",
]);
export const supportStatusEnum = pgEnum("support_status", [
  "created",
  "pending",
  "closed",
]);
export const flashSaleStatusEnum = pgEnum("flash_sale_status", [
  "scheduled",
  "active",
  "paused",
  "expired",
  "cancelled",
]);
export const roundingEnum = pgEnum("payment_rounding", [
  "exact",
  "nearest_egp",
  "nearest_5_egp",
]);
export const walletTransactionTypeEnum = pgEnum("wallet_transaction_type", [
  "top_up",
  "cashback",
  "referral_reward",
  "admin_adjustment",
  "refund",
  "purchase_adjustment",
  "other",
]);

export const users = pgTable(
  "users",
  {
    id: id(),
    telegramUserId: text("telegram_user_id").notNull(),
    username: text("username"),
    firstName: text("first_name").notNull(),
    lastName: text("last_name"),
    language: languageEnum("language").default("en").notNull(),
    channelMember: boolean("channel_member").default(false).notNull(),
    marketingOptIn: boolean("marketing_opt_in").default(true).notNull(),
    referralCode: text("referral_code").notNull(),
    referredById: uuid("referred_by_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    lastActivityAt: timestamp("last_activity_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    telegramUserIdIdx: uniqueIndex("users_telegram_user_id_idx").on(
      table.telegramUserId,
    ),
    referralCodeIdx: uniqueIndex("users_referral_code_idx").on(
      table.referralCode,
    ),
  }),
);

export const admins = pgTable(
  "admins",
  {
    id: id(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    name: text("name").notNull(),
    role: adminRoleEnum("role").default("support_agent").notNull(),
    telegramUserId: text("telegram_user_id"),
    active: boolean("active").default(true).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  },
  (table) => ({
    emailIdx: uniqueIndex("admins_email_idx").on(table.email),
    telegramIdx: uniqueIndex("admins_telegram_user_id_idx").on(
      table.telegramUserId,
    ),
  }),
);

export const adminSessions = pgTable("admin_sessions", {
  id: id(),
  adminId: uuid("admin_id").notNull(),
  tokenHash: text("token_hash").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: createdAt(),
});

export const products = pgTable("products", {
  id: id(),
  nameEn: text("name_en").notNull(),
  nameAr: text("name_ar").notNull(),
  duration: text("duration").notNull(),
  warranty: text("warranty").notNull(),
  priceUsd: numeric("price_usd", { precision: 12, scale: 2 }).notNull(),
  instructionsEn: text("instructions_en").default("").notNull(),
  instructionsAr: text("instructions_ar").default("").notNull(),
  imageUrl: text("image_url"),
  stockType: stockTypeEnum("stock_type").default("unlimited").notNull(),
  deliveryType: deliveryTypeEnum("delivery_type").default("manual").notNull(),
  active: boolean("active").default(true).notNull(),
  displayStock: boolean("display_stock").default(false).notNull(),
  lowStockThreshold: integer("low_stock_threshold").default(3).notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const inventoryItems = pgTable("inventory_items", {
  id: id(),
  productId: uuid("product_id").notNull(),
  secretValue: text("secret_value").notNull(),
  valueHash: text("value_hash").notNull(),
  status: inventoryStatusEnum("status").default("available").notNull(),
  orderId: uuid("order_id"),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const inventoryReservations = pgTable("inventory_reservations", {
  id: id(),
  inventoryItemId: uuid("inventory_item_id").notNull(),
  checkoutSessionId: uuid("checkout_session_id").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  releasedAt: timestamp("released_at", { withTimezone: true }),
  createdAt: createdAt(),
});

export const checkoutSessions = pgTable("checkout_sessions", {
  id: id(),
  reference: text("reference").notNull(),
  userId: uuid("user_id").notNull(),
  productId: uuid("product_id").notNull(),
  productNameSnapshot: text("product_name_snapshot").notNull(),
  durationSnapshot: text("duration_snapshot").notNull(),
  warrantySnapshot: text("warranty_snapshot").notNull(),
  quantity: integer("quantity").default(1).notNull(),
  priceUsd: numeric("price_usd", { precision: 12, scale: 2 }).notNull(),
  paymentMethod: paymentMethodEnum("payment_method"),
  status: paymentStatusEnum("status").default("pending").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const orders = pgTable(
  "orders",
  {
    id: id(),
    orderNumber: text("order_number").notNull(),
    userId: uuid("user_id").notNull(),
    productId: uuid("product_id").notNull(),
    checkoutSessionId: uuid("checkout_session_id"),
    productNameSnapshot: text("product_name_snapshot").notNull(),
    durationSnapshot: text("duration_snapshot").notNull(),
    warrantySnapshot: text("warranty_snapshot").notNull(),
    quantity: integer("quantity").default(1).notNull(),
    priceUsd: numeric("price_usd", { precision: 12, scale: 2 }).notNull(),
    egpAmount: numeric("egp_amount", { precision: 12, scale: 2 }),
    exchangeRate: numeric("exchange_rate", { precision: 12, scale: 4 }),
    paymentMethod: paymentMethodEnum("payment_method").notNull(),
    status: orderStatusEnum("status").default("paid").notNull(),
    deliveryType: deliveryTypeEnum("delivery_type").notNull(),
    stockTypeSnapshot: stockTypeEnum("stock_type_snapshot"),
    deliveryInfo: text("delivery_info"),
    paymentNotifiedAt: timestamp("payment_notified_at", { withTimezone: true }),
    deliveryNotifiedAt: timestamp("delivery_notified_at", { withTimezone: true }),
    createdAt: createdAt(),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    updatedAt: updatedAt(),
  },
  (table) => ({
    orderNumberIdx: uniqueIndex("orders_order_number_idx").on(table.orderNumber),
  }),
);

export const payments = pgTable("payments", {
  id: id(),
  checkoutSessionId: uuid("checkout_session_id").notNull(),
  orderId: uuid("order_id"),
  userId: uuid("user_id").notNull(),
  paymentMethod: paymentMethodEnum("payment_method").notNull(),
  usdAmount: numeric("usd_amount", { precision: 12, scale: 2 }).notNull(),
  egpAmount: numeric("egp_amount", { precision: 12, scale: 2 }),
  exchangeRate: numeric("exchange_rate", { precision: 12, scale: 4 }),
  transactionReference: text("transaction_reference"),
  status: paymentStatusEnum("status").default("pending").notNull(),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  reviewedBy: uuid("reviewed_by"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  rejectionReason: text("rejection_reason"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const binanceTransactionClaims = pgTable(
  "binance_transaction_claims",
  {
    id: id(),
    transactionId: text("transaction_id").notNull(),
    purpose: text("purpose").notNull(),
    referenceId: uuid("reference_id").notNull(),
    createdAt: createdAt(),
  },
  (table) => ({
    transactionIdIdx: uniqueIndex("binance_transaction_claims_transaction_id_idx").on(
      table.transactionId,
    ),
  }),
);

export const paymentSubmissions = pgTable("payment_submissions", {
  id: id(),
  paymentId: uuid("payment_id").notNull(),
  transactionReference: text("transaction_reference").notNull(),
  submittedAt: timestamp("submitted_at", { withTimezone: true }).defaultNow().notNull(),
  createdAt: createdAt(),
});

export const paymentMethods = pgTable("payment_methods", {
  id: id(),
  method: paymentMethodEnum("method").notNull(),
  enabled: boolean("enabled").default(false).notNull(),
  recipientName: text("recipient_name"),
  paymentIdentifier: text("payment_identifier"),
  asset: text("asset"),
  instructionsEn: text("instructions_en").default("").notNull(),
  instructionsAr: text("instructions_ar").default("").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const flashSales = pgTable("flash_sales", {
  id: id(),
  productId: uuid("product_id").notNull(),
  originalPriceUsd: numeric("original_price_usd", { precision: 12, scale: 2 }).notNull(),
  salePriceUsd: numeric("sale_price_usd", { precision: 12, scale: 2 }).notNull(),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  quantity: integer("quantity"),
  soldQuantity: integer("sold_quantity").default(0).notNull(),
  status: flashSaleStatusEnum("status").default("scheduled").notNull(),
  notifyCustomers: boolean("notify_customers").default(false).notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const promoCodes = pgTable("promo_codes", {
  id: id(),
  code: text("code").notNull(),
  discountType: text("discount_type").notNull(),
  value: numeric("value", { precision: 12, scale: 2 }).notNull(),
  startsAt: timestamp("starts_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  maxUses: integer("max_uses"),
  maxUsesPerCustomer: integer("max_uses_per_customer"),
  usedCount: integer("used_count").default(0).notNull(),
  minPurchaseUsd: numeric("min_purchase_usd", { precision: 12, scale: 2 }).default("0").notNull(),
  productId: uuid("product_id"),
  active: boolean("active").default(true).notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const promoRedemptions = pgTable("promo_redemptions", {
  id: id(),
  promoCodeId: uuid("promo_code_id").notNull(),
  userId: uuid("user_id").notNull(),
  orderId: uuid("order_id").notNull(),
  discountUsd: numeric("discount_usd", { precision: 12, scale: 2 }).notNull(),
  createdAt: createdAt(),
});

export const walletTransactions = pgTable("wallet_transactions", {
  id: id(),
  userId: uuid("user_id").notNull(),
  orderId: uuid("order_id"),
  adminId: uuid("admin_id"),
  type: walletTransactionTypeEnum("type").notNull(),
  amountUsd: numeric("amount_usd", { precision: 12, scale: 2 }).notNull(),
  reason: text("reason").notNull(),
  reference: text("reference"),
  createdAt: createdAt(),
});

export const walletTopUpStatusEnum = pgEnum("wallet_top_up_status", [
  "pending",
  "confirmed",
  "cancelled",
]);

export const walletTopUps = pgTable(
  "wallet_top_ups",
  {
    id: id(),
    userId: uuid("user_id").notNull(),
    amountUsd: numeric("amount_usd", { precision: 12, scale: 2 }).notNull(),
    submittedTransactionId: text("submitted_transaction_id").notNull(),
    status: walletTopUpStatusEnum("status").default("pending").notNull(),
    confirmedBinanceTransactionId: text("confirmed_binance_transaction_id"),
    requestedAt: timestamp("requested_at", { withTimezone: true }).defaultNow().notNull(),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => ({
    submittedTransactionIdx: uniqueIndex("wallet_top_ups_submitted_transaction_idx").on(
      table.submittedTransactionId,
    ),
    confirmedBinanceTransactionIdx: uniqueIndex("wallet_top_ups_confirmed_transaction_idx").on(
      table.confirmedBinanceTransactionId,
    ),
  }),
);

export const referrals = pgTable("referrals", {
  id: id(),
  referrerId: uuid("referrer_id").notNull(),
  referredUserId: uuid("referred_user_id").notNull(),
  rewardIssued: boolean("reward_issued").default(false).notNull(),
  qualifyingOrderId: uuid("qualifying_order_id"),
  createdAt: createdAt(),
});

export const supportTickets = pgTable("support_tickets", {
  id: id(),
  ticketNumber: text("ticket_number").notNull(),
  userId: uuid("user_id").notNull(),
  assignedAdminId: uuid("assigned_admin_id"),
  subject: text("subject").notNull(),
  status: supportStatusEnum("status").default("created").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => ({
  ticketNumberIdx: uniqueIndex("support_tickets_ticket_number_idx").on(table.ticketNumber),
}));

export const supportMessages = pgTable("support_messages", {
  id: id(),
  ticketId: uuid("ticket_id").notNull(),
  authorType: text("author_type").notNull(),
  authorAdminId: uuid("author_admin_id"),
  body: text("body").notNull(),
  attachments: jsonb("attachments"),
  createdAt: createdAt(),
});

export const notifications = pgTable("notifications", {
  id: id(),
  userId: uuid("user_id").notNull(),
  kind: text("kind").notNull(),
  titleEn: text("title_en").notNull(),
  titleAr: text("title_ar").notNull(),
  bodyEn: text("body_en").notNull(),
  bodyAr: text("body_ar").notNull(),
  createdAt: createdAt(),
});

export const notificationDeliveries = pgTable("notification_deliveries", {
  id: id(),
  notificationId: uuid("notification_id").notNull(),
  status: text("status").notNull(),
  telegramMessageId: text("telegram_message_id"),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  createdAt: createdAt(),
});

export const termsAcceptances = pgTable("terms_acceptances", {
  id: id(),
  userId: uuid("user_id").notNull(),
  termsVersion: text("terms_version").notNull(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }).defaultNow().notNull(),
});

export const storeSettings = pgTable("store_settings", {
  id: id(),
  storeName: text("store_name").default("KeyTopia").notNull(),
  requiredTelegramChannel: text("required_telegram_channel"),
  cashbackPercent: numeric("cashback_percent", { precision: 5, scale: 2 }).default("0").notNull(),
  referralRewardUsd: numeric("referral_reward_usd", { precision: 12, scale: 2 }).default("0").notNull(),
  usdToEgpRate: numeric("usd_to_egp_rate", { precision: 12, scale: 4 }).default("50").notNull(),
  paymentRounding: roundingEnum("payment_rounding").default("nearest_egp").notNull(),
  checkoutTimeoutMinutes: integer("checkout_timeout_minutes").default(5).notNull(),
  lowStockThreshold: integer("low_stock_threshold").default(3).notNull(),
  supportAvailable: boolean("support_available").default(true).notNull(),
  maintenanceMode: boolean("maintenance_mode").default(false).notNull(),
  termsVersion: text("terms_version").default("1").notNull(),
  termsEn: text("terms_en").default("").notNull(),
  termsAr: text("terms_ar").default("").notNull(),
  privacyEn: text("privacy_en").default("").notNull(),
  privacyAr: text("privacy_ar").default("").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const auditLogs = pgTable("audit_logs", {
  id: id(),
  adminId: uuid("admin_id"),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: uuid("entity_id"),
  beforeValues: jsonb("before_values"),
  afterValues: jsonb("after_values"),
  ipAddress: text("ip_address"),
  createdAt: createdAt(),
});