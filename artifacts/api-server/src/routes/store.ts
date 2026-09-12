import { Router, type IRouter, type Request, type Response } from "express";
import { createHash } from "node:crypto";
import {
  AdminLoginBody,
  CreateFlashSaleBody,
  CreateProductBody,
  CreatePromoCodeBody,
  DeliverOrderBody,
  GetAnalyticsSummaryQueryParams,
  ImportInventoryBody,
  ListCustomersQueryParams,
  ListInventoryQueryParams,
  ListOrdersQueryParams,
  ListPaymentsQueryParams,
  ListProductsQueryParams,
  ListSupportTicketsQueryParams,
  RejectPaymentBody,
  ReplyToSupportTicketBody,
  UpdateOrderStatusBody,
  UpdateStoreSettingsBody,
} from "@workspace/api-zod";
import {
  and,
  count,
  desc,
  eq,
  ilike,
  inArray,
  isNull,
  lt,
  sql,
  sum,
} from "drizzle-orm";
import {
  admins,
  auditLogs,
  checkoutSessions,
  db,
  flashSales,
  inventoryItems,
  orders,
  paymentMethods,
  payments,
  products,
  promoCodes,
  storeSettings,
  supportMessages,
  supportTickets,
  users,
} from "@workspace/db";
import {
  authenticateAdmin,
  clearSessionCookie,
  createAdminSession,
  deleteAdminSession,
  ensureBootstrapAdmin,
  getAdminFromRequest,
  setSessionCookie,
} from "../lib/admin-auth";

const router: IRouter = Router();

function numberValue(value: string | number | null | undefined) {
  return Number(value ?? 0);
}

function iso(value: Date | null | undefined) {
  return value?.toISOString() ?? null;
}

function pageParams(input: {
  page?: number;
  pageSize?: number;
}) {
  const page = Math.max(1, input.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, input.pageSize ?? 20));
  return { page, pageSize, offset: (page - 1) * pageSize };
}

async function requireAdmin(req: Request, res: Response) {
  const admin = await getAdminFromRequest(req);
  if (!admin) {
    res.status(401).json({ error: "Authentication required" });
    return null;
  }
  return admin;
}

function productView(product: typeof products.$inferSelect, availableStock = 0) {
  return {
    id: product.id,
    nameEn: product.nameEn,
    nameAr: product.nameAr,
    duration: product.duration,
    warranty: product.warranty,
    priceUsd: numberValue(product.priceUsd),
    deliveryType: product.deliveryType,
    stockType: product.stockType,
    active: product.active,
    displayStock: product.displayStock,
    availableStock,
    lowStockThreshold: product.lowStockThreshold,
    imageUrl: product.imageUrl,
    instructionsEn: product.instructionsEn,
    instructionsAr: product.instructionsAr,
    createdAt: product.createdAt.toISOString(),
  };
}

async function productStock(productIds: string[]) {
  if (productIds.length === 0) return new Map<string, number>();
  const rows = await db
    .select({
      productId: inventoryItems.productId,
      available: count(inventoryItems.id),
    })
    .from(inventoryItems)
    .where(
      and(
        inArray(inventoryItems.productId, productIds),
        eq(inventoryItems.status, "available"),
      ),
    )
    .groupBy(inventoryItems.productId);
  return new Map(rows.map((row) => [row.productId, Number(row.available)]));
}

router.get("/auth/session", async (_req, res) => {
  await ensureBootstrapAdmin();
  const admin = await getAdminFromRequest(_req);
  res.json({
    authenticated: Boolean(admin),
    admin: admin
      ? { id: admin.id, email: admin.email, name: admin.name, role: admin.role }
      : null,
  });
});

router.post("/auth/login", async (req, res) => {
  const parsed = AdminLoginBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid login" });
  await ensureBootstrapAdmin();
  const admin = await authenticateAdmin(parsed.data.email, parsed.data.password);
  if (!admin) return res.status(401).json({ error: "Invalid credentials" });
  const token = await createAdminSession(admin.id);
  setSessionCookie(res, token);
  res.json({
    authenticated: true,
    admin: {
      id: admin.id,
      email: admin.email,
      name: admin.name,
      role: admin.role,
    },
  });
});

router.post("/auth/logout", async (req, res) => {
  await deleteAdminSession(req);
  clearSessionCookie(res);
  res.status(204).send();
});

router.get("/dashboard/overview", async (req, res) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return res;
  const [revenue, orderCount, pendingPayments, awaitingDelivery, tickets, lowStock, flashSaleCount, newCustomers] =
    await Promise.all([
      db
        .select({ total: sum(orders.priceUsd) })
        .from(orders)
        .where(sql`${orders.createdAt} >= CURRENT_DATE AND ${orders.status} <> 'cancelled'`),
      db
        .select({ total: count() })
        .from(orders)
        .where(sql`${orders.createdAt} >= CURRENT_DATE`),
      db
        .select({ total: count() })
        .from(payments)
        .where(inArray(payments.status, ["pending", "submitted"])),
      db
        .select({ total: count() })
        .from(orders)
        .where(inArray(orders.status, ["paid", "processing"])),
      db
        .select({ total: count() })
        .from(supportTickets)
        .where(inArray(supportTickets.status, ["open", "waiting_agent"])),
      db
        .select({ total: count() })
        .from(products)
        .leftJoin(
          inventoryItems,
          and(
            eq(inventoryItems.productId, products.id),
            eq(inventoryItems.status, "available"),
          ),
        )
        .where(eq(products.active, true)),
      db
        .select({ total: count() })
        .from(flashSales)
        .where(eq(flashSales.status, "active")),
      db
        .select({ total: count() })
        .from(users)
        .where(sql`${users.createdAt} >= CURRENT_DATE`),
    ]);
  const recentOrders = await listOrderRows(5);
  const recentPayments = await listPaymentRows(5);
  const recentTickets = await listTicketRows(5);
  res.json({
    revenueTodayUsd: numberValue(revenue[0]?.total),
    ordersToday: Number(orderCount[0]?.total ?? 0),
    pendingPayments: Number(pendingPayments[0]?.total ?? 0),
    awaitingDelivery: Number(awaitingDelivery[0]?.total ?? 0),
    openSupportTickets: Number(tickets[0]?.total ?? 0),
    lowStockProducts: Number(lowStock[0]?.total ?? 0),
    activeFlashSales: Number(flashSaleCount[0]?.total ?? 0),
    newCustomers: Number(newCustomers[0]?.total ?? 0),
    recentOrders,
    recentPayments,
    recentTickets,
  });
});

router.get("/products", async (req, res) => {
  const parsed = ListProductsQueryParams.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: "Invalid filters" });
  const admin = await requireAdmin(req, res);
  if (!admin) return res;
  const params = pageParams(parsed.data);
  const conditions = [];
  if (parsed.data.status === "active") conditions.push(eq(products.active, true));
  if (parsed.data.status === "inactive") conditions.push(eq(products.active, false));
  if (parsed.data.deliveryType) conditions.push(eq(products.deliveryType, parsed.data.deliveryType));
  const rows = await db
    .select()
    .from(products)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(products.createdAt))
    .limit(params.pageSize)
    .offset(params.offset);
  const totals = await db
    .select({ total: count() })
    .from(products)
    .where(conditions.length ? and(...conditions) : undefined);
  const stock = await productStock(rows.map((row) => row.id));
  res.json({
    items: rows.map((row) => productView(row, stock.get(row.id) ?? 0)),
    page: params.page,
    pageSize: params.pageSize,
    total: Number(totals[0]?.total ?? 0),
  });
});

router.post("/products", async (req, res) => {
  const admin = await requireAdmin(req, res);
  if (!admin || admin.role !== "super_admin") return res;
  const parsed = CreateProductBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid product" });
  const row = await db
    .insert(products)
    .values({ ...parsed.data, priceUsd: String(parsed.data.priceUsd) })
    .returning();
  await db.insert(auditLogs).values({
    adminId: admin.id,
    action: "product_created",
    entityType: "product",
    entityId: row[0].id,
    afterValues: parsed.data,
  });
  res.status(201).json(productView(row[0]));
});

router.get("/products/:productId", async (req, res) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return res;
  const row = await db.select().from(products).where(eq(products.id, req.params.productId)).limit(1);
  if (!row[0]) return res.status(404).json({ error: "Product not found" });
  const stock = await productStock([row[0].id]);
  res.json(productView(row[0], stock.get(row[0].id) ?? 0));
});

router.patch("/products/:productId", async (req, res) => {
  const admin = await requireAdmin(req, res);
  if (!admin || admin.role !== "super_admin") return res;
  const parsed = (await import("@workspace/api-zod")).UpdateProductBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid product" });
  const updateData: Partial<typeof products.$inferInsert> = {
    updatedAt: new Date(),
  };
  if (parsed.data.nameEn !== undefined) updateData.nameEn = parsed.data.nameEn;
  if (parsed.data.nameAr !== undefined) updateData.nameAr = parsed.data.nameAr;
  if (parsed.data.duration !== undefined) updateData.duration = parsed.data.duration;
  if (parsed.data.warranty !== undefined) updateData.warranty = parsed.data.warranty;
  if (parsed.data.priceUsd !== undefined) updateData.priceUsd = String(parsed.data.priceUsd);
  if (parsed.data.deliveryType !== undefined) updateData.deliveryType = parsed.data.deliveryType;
  if (parsed.data.stockType !== undefined) updateData.stockType = parsed.data.stockType;
  if (parsed.data.active !== undefined) updateData.active = parsed.data.active;
  if (parsed.data.displayStock !== undefined) updateData.displayStock = parsed.data.displayStock;
  if (parsed.data.lowStockThreshold !== undefined) updateData.lowStockThreshold = parsed.data.lowStockThreshold;
  if (parsed.data.imageUrl !== undefined) updateData.imageUrl = parsed.data.imageUrl;
  if (parsed.data.instructionsEn !== undefined) updateData.instructionsEn = parsed.data.instructionsEn;
  if (parsed.data.instructionsAr !== undefined) updateData.instructionsAr = parsed.data.instructionsAr;
  const row = await db
    .update(products)
    .set(updateData)
    .where(eq(products.id, req.params.productId))
    .returning();
  if (!row[0]) return res.status(404).json({ error: "Product not found" });
  const stock = await productStock([row[0].id]);
  await db.insert(auditLogs).values({
    adminId: admin.id,
    action: "product_updated",
    entityType: "product",
    entityId: row[0].id,
    afterValues: parsed.data,
  });
  res.json(productView(row[0], stock.get(row[0].id) ?? 0));
});

router.get("/inventory/summary", async (req, res) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return res;
  const rows = await db
    .select({ status: inventoryItems.status, total: count() })
    .from(inventoryItems)
    .groupBy(inventoryItems.status);
  const byStatus = new Map(rows.map((row) => [row.status, Number(row.total)]));
  const lowStockProducts = await db
    .select({ id: products.id })
    .from(products)
    .leftJoin(
      inventoryItems,
      and(eq(inventoryItems.productId, products.id), eq(inventoryItems.status, "available")),
    )
    .where(eq(products.active, true))
    .groupBy(products.id, products.lowStockThreshold)
    .having(sql`count(${inventoryItems.id}) <= ${products.lowStockThreshold}`);
  res.json({
    total: [...byStatus.values()].reduce((sumValue, value) => sumValue + value, 0),
    available: byStatus.get("available") ?? 0,
    reserved: byStatus.get("reserved") ?? 0,
    delivered: byStatus.get("delivered") ?? 0,
    disabled: byStatus.get("disabled") ?? 0,
    lowStockProducts: lowStockProducts.length,
  });
});

router.get("/inventory", async (req, res) => {
  const parsed = ListInventoryQueryParams.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: "Invalid filters" });
  const admin = await requireAdmin(req, res);
  if (!admin) return res;
  const params = pageParams(parsed.data);
  const conditions = [];
  if (parsed.data.productId) conditions.push(eq(inventoryItems.productId, parsed.data.productId));
  if (parsed.data.status !== "all") conditions.push(eq(inventoryItems.status, parsed.data.status));
  const rows = await db
    .select({
      item: inventoryItems,
      productName: products.nameEn,
      orderNumber: orders.orderNumber,
    })
    .from(inventoryItems)
    .innerJoin(products, eq(inventoryItems.productId, products.id))
    .leftJoin(orders, eq(inventoryItems.orderId, orders.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(inventoryItems.createdAt))
    .limit(params.pageSize)
    .offset(params.offset);
  const totals = await db
    .select({ total: count() })
    .from(inventoryItems)
    .where(conditions.length ? and(...conditions) : undefined);
  res.json({
    items: rows.map((row) => ({
      id: row.item.id,
      productId: row.item.productId,
      productName: row.productName,
      maskedValue: `${row.item.secretValue.slice(0, 3)}••••${row.item.secretValue.slice(-3)}`,
      status: row.item.status,
      orderNumber: row.orderNumber ?? null,
      createdAt: row.item.createdAt.toISOString(),
    })),
    page: params.page,
    pageSize: params.pageSize,
    total: Number(totals[0]?.total ?? 0),
  });
});

router.post("/inventory", async (req, res) => {
  const admin = await requireAdmin(req, res);
  if (!admin || admin.role !== "super_admin") return res;
  const parsed = ImportInventoryBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid inventory import" });
  const submittedValues = parsed.data.values.map((value) => value.trim()).filter(Boolean);
  const values = Array.from(new Set(submittedValues));
  if (values.length === 0) return res.status(400).json({ error: "At least one inventory value is required" });
  const hashes = values.map((value) => createValueHash(value));
  const existing = await db
    .select({ valueHash: inventoryItems.valueHash })
    .from(inventoryItems)
    .where(inArray(inventoryItems.valueHash, hashes));
  const existingHashes = new Set(existing.map((row) => row.valueHash));
  const fresh = values
    .map((value, index) => ({ value, hash: hashes[index] }))
    .filter((row) => !existingHashes.has(row.hash));
  if (fresh.length > 0) {
    await db.insert(inventoryItems).values(
      fresh.map((item) => ({
        productId: parsed.data.productId,
        secretValue: item.value,
        valueHash: item.hash,
      })),
    );
  }
  const available = await db
    .select({ total: count() })
    .from(inventoryItems)
    .where(and(eq(inventoryItems.productId, parsed.data.productId), eq(inventoryItems.status, "available")));
  res.status(201).json({
    imported: fresh.length,
    skippedDuplicates: submittedValues.length - fresh.length,
    available: Number(available[0]?.total ?? 0),
  });
});

router.post("/inventory/:inventoryId/disable", async (req, res) => {
  const admin = await requireAdmin(req, res);
  if (!admin || admin.role !== "super_admin") return res;
  const rows = await db
    .update(inventoryItems)
    .set({ status: "disabled", updatedAt: new Date() })
    .where(eq(inventoryItems.id, req.params.inventoryId))
    .returning();
  if (!rows[0]) return res.status(404).json({ error: "Inventory item not found" });
  res.json({
    id: rows[0].id,
    productId: rows[0].productId,
    productName: "",
    maskedValue: `${rows[0].secretValue.slice(0, 3)}••••${rows[0].secretValue.slice(-3)}`,
    status: rows[0].status,
    orderNumber: null,
    createdAt: rows[0].createdAt.toISOString(),
  });
});

async function listOrderRows(limit = 20, params?: { page: number; pageSize: number; status?: string; search?: string }) {
  const conditions = [];
  if (params?.status && params.status !== "all") conditions.push(eq(orders.status, params.status as "paid"));
  if (params?.search) conditions.push(ilike(orders.orderNumber, `%${params.search}%`));
  const rows = await db
    .select({ order: orders, customer: users, product: products })
    .from(orders)
    .innerJoin(users, eq(orders.userId, users.id))
    .innerJoin(products, eq(orders.productId, products.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(orders.createdAt))
    .limit(params ? params.pageSize : limit)
    .offset(params ? (params.page - 1) * params.pageSize : 0);
  return rows.map((row) => ({
    id: row.order.id,
    orderNumber: row.order.orderNumber,
    customerName: `${row.customer.firstName}${row.customer.lastName ? ` ${row.customer.lastName}` : ""}`,
    productName: row.product.nameEn,
    priceUsd: numberValue(row.order.priceUsd),
    paymentMethod: row.order.paymentMethod,
    status: row.order.status,
    deliveryType: row.order.deliveryType,
    createdAt: row.order.createdAt.toISOString(),
    deliveredAt: iso(row.order.deliveredAt),
    deliveryInfo: row.order.deliveryInfo,
  }));
}

router.get("/orders", async (req, res) => {
  const parsed = ListOrdersQueryParams.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: "Invalid filters" });
  const admin = await requireAdmin(req, res);
  if (!admin) return res;
  const params = pageParams(parsed.data);
  const items = await listOrderRows(20, { ...params, status: parsed.data.status, search: parsed.data.search });
  const totals = await db.select({ total: count() }).from(orders);
  res.json({ items, page: params.page, pageSize: params.pageSize, total: Number(totals[0]?.total ?? 0) });
});

router.get("/orders/:orderId", async (req, res) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return res;
  const items = await listOrderRows(1, { page: 1, pageSize: 1, search: req.params.orderId });
  const item = items.find((row) => row.id === req.params.orderId);
  if (!item) return res.status(404).json({ error: "Order not found" });
  res.json(item);
});

router.post("/orders/:orderId/status", async (req, res) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return res;
  const parsed = UpdateOrderStatusBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid order status" });
  const rows = await db.update(orders).set({ status: parsed.data.status, updatedAt: new Date() }).where(eq(orders.id, req.params.orderId)).returning();
  if (!rows[0]) return res.status(404).json({ error: "Order not found" });
  const items = await listOrderRows(1, { page: 1, pageSize: 1, search: rows[0].orderNumber });
  res.json(items[0]);
});

router.post("/orders/:orderId/deliver", async (req, res) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return res;
  const parsed = DeliverOrderBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Delivery information is required" });
  const rows = await db.update(orders).set({ deliveryInfo: parsed.data.deliveryInfo, status: "delivered", deliveredAt: new Date(), updatedAt: new Date() }).where(eq(orders.id, req.params.orderId)).returning();
  if (!rows[0]) return res.status(404).json({ error: "Order not found" });
  const items = await listOrderRows(1, { page: 1, pageSize: 1, search: rows[0].orderNumber });
  res.json(items[0]);
});

async function listPaymentRows(limit = 20, params?: { page: number; pageSize: number; status?: string }) {
  const conditions = [];
  if (params?.status && params.status !== "all") conditions.push(eq(payments.status, params.status as "pending"));
  const rows = await db
    .select({ payment: payments, user: users, checkout: checkoutSessions, product: products })
    .from(payments)
    .innerJoin(users, eq(payments.userId, users.id))
    .innerJoin(checkoutSessions, eq(payments.checkoutSessionId, checkoutSessions.id))
    .innerJoin(products, eq(checkoutSessions.productId, products.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(payments.createdAt))
    .limit(params ? params.pageSize : limit)
    .offset(params ? (params.page - 1) * params.pageSize : 0);
  return rows.map((row) => ({
    id: row.payment.id,
    orderNumber: null,
    customerName: `${row.user.firstName}${row.user.lastName ? ` ${row.user.lastName}` : ""}`,
    productName: row.product.nameEn,
    paymentMethod: row.payment.paymentMethod,
    usdAmount: numberValue(row.payment.usdAmount),
    egpAmount: row.payment.egpAmount ? numberValue(row.payment.egpAmount) : null,
    transactionReference: row.payment.transactionReference,
    status: row.payment.status,
    submittedAt: iso(row.payment.submittedAt),
    rejectionReason: row.payment.rejectionReason,
  }));
}

router.get("/payments", async (req, res) => {
  const parsed = ListPaymentsQueryParams.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: "Invalid filters" });
  const admin = await requireAdmin(req, res);
  if (!admin) return res;
  const params = pageParams(parsed.data);
  const items = await listPaymentRows(20, { ...params, status: parsed.data.status });
  const totals = await db.select({ total: count() }).from(payments);
  res.json({ items, page: params.page, pageSize: params.pageSize, total: Number(totals[0]?.total ?? 0) });
});

router.post("/payments/:paymentId/confirm", async (req, res) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return res;
  const rows = await db.update(payments).set({ status: "confirmed", reviewedBy: admin.id, reviewedAt: new Date(), updatedAt: new Date() }).where(and(eq(payments.id, req.params.paymentId), inArray(payments.status, ["pending", "submitted"]))).returning();
  if (!rows[0]) return res.status(409).json({ error: "Payment is already processed or missing" });
  const items = await listPaymentRows(1, { page: 1, pageSize: 1 });
  res.json(items.find((item) => item.id === rows[0].id) ?? { id: rows[0].id });
});

router.post("/payments/:paymentId/reject", async (req, res) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return res;
  const parsed = RejectPaymentBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Rejection reason is required" });
  const rows = await db.update(payments).set({ status: "rejected", rejectionReason: parsed.data.reason, reviewedBy: admin.id, reviewedAt: new Date(), updatedAt: new Date() }).where(and(eq(payments.id, req.params.paymentId), inArray(payments.status, ["pending", "submitted"]))).returning();
  if (!rows[0]) return res.status(409).json({ error: "Payment is already processed or missing" });
  const items = await listPaymentRows(1, { page: 1, pageSize: 1 });
  res.json(items.find((item) => item.id === rows[0].id) ?? { id: rows[0].id });
});

router.get("/customers", async (req, res) => {
  const parsed = ListCustomersQueryParams.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: "Invalid filters" });
  const admin = await requireAdmin(req, res);
  if (!admin) return res;
  const params = pageParams(parsed.data);
  const condition = parsed.data.search ? ilike(users.firstName, `%${parsed.data.search}%`) : undefined;
  const rows = await db.select().from(users).where(condition).orderBy(desc(users.lastActivityAt)).limit(params.pageSize).offset(params.offset);
  const total = await db.select({ total: count() }).from(users).where(condition);
  const orderCounts = rows.length ? await db.select({ userId: orders.userId, count: count(), value: sum(orders.priceUsd) }).from(orders).where(inArray(orders.userId, rows.map((row) => row.id))).groupBy(orders.userId) : [];
  const stats = new Map(orderCounts.map((row) => [row.userId, row]));
  res.json({
    items: rows.map((row) => ({
      id: row.id,
      telegramUserId: row.telegramUserId,
      username: row.username,
      displayName: `${row.firstName}${row.lastName ? ` ${row.lastName}` : ""}`,
      language: row.language,
      orderCount: Number(stats.get(row.id)?.count ?? 0),
      lifetimeValueUsd: numberValue(stats.get(row.id)?.value),
      walletBalanceUsd: 0,
      joinedAt: row.createdAt.toISOString(),
      lastActivityAt: row.lastActivityAt.toISOString(),
    })),
    page: params.page,
    pageSize: params.pageSize,
    total: Number(total[0]?.total ?? 0),
  });
});

async function listTicketRows(limit = 20, status?: string) {
  const condition = status && status !== "all" ? eq(supportTickets.status, status as "open") : undefined;
  const rows = await db.select({ ticket: supportTickets, user: users }).from(supportTickets).innerJoin(users, eq(supportTickets.userId, users.id)).where(condition).orderBy(desc(supportTickets.updatedAt)).limit(limit);
  const lastMessages = rows.length ? await db.select().from(supportMessages).where(inArray(supportMessages.ticketId, rows.map((row) => row.ticket.id))).orderBy(desc(supportMessages.createdAt)) : [];
  const lastByTicket = new Map(lastMessages.map((message) => [message.ticketId, message]));
  return rows.map((row) => ({
    id: row.ticket.id,
    customerName: `${row.user.firstName}${row.user.lastName ? ` ${row.user.lastName}` : ""}`,
    subject: row.ticket.subject,
    status: row.ticket.status,
    lastMessage: lastByTicket.get(row.ticket.id)?.body ?? "No messages yet",
    updatedAt: row.ticket.updatedAt.toISOString(),
  }));
}

router.get("/support/tickets", async (req, res) => {
  const parsed = ListSupportTicketsQueryParams.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: "Invalid filters" });
  const admin = await requireAdmin(req, res);
  if (!admin) return res;
  const params = pageParams(parsed.data);
  const items = await listTicketRows(params.pageSize, parsed.data.status);
  const total = await db.select({ total: count() }).from(supportTickets);
  res.json({ items, page: params.page, pageSize: params.pageSize, total: Number(total[0]?.total ?? 0) });
});

router.post("/support/tickets/:ticketId/messages", async (req, res) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return res;
  const parsed = ReplyToSupportTicketBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Message is required" });
  const message = await db.insert(supportMessages).values({ ticketId: req.params.ticketId, authorType: "admin", authorAdminId: admin.id, body: parsed.data.body }).returning();
  await db.update(supportTickets).set({ status: "waiting_customer", updatedAt: new Date(), assignedAdminId: admin.id }).where(eq(supportTickets.id, req.params.ticketId));
  res.status(201).json({
    id: message[0].id,
    ticketId: message[0].ticketId,
    body: message[0].body,
    authorType: "admin",
    createdAt: message[0].createdAt.toISOString(),
  });
});

router.get("/flash-sales", async (req, res) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return res;
  const rows = await db.select({ sale: flashSales, product: products }).from(flashSales).innerJoin(products, eq(flashSales.productId, products.id)).orderBy(desc(flashSales.startsAt));
  res.json(rows.map((row) => ({
    id: row.sale.id,
    productId: row.sale.productId,
    productName: row.product.nameEn,
    originalPriceUsd: numberValue(row.sale.originalPriceUsd),
    salePriceUsd: numberValue(row.sale.salePriceUsd),
    discountPercent: numberValue(row.sale.originalPriceUsd) ? Math.round((1 - numberValue(row.sale.salePriceUsd) / numberValue(row.sale.originalPriceUsd)) * 100) : 0,
    startsAt: row.sale.startsAt.toISOString(),
    endsAt: row.sale.endsAt.toISOString(),
    status: row.sale.status,
    quantity: row.sale.quantity,
  })));
});

router.post("/flash-sales", async (req, res) => {
  const admin = await requireAdmin(req, res);
  if (!admin || admin.role !== "super_admin") return res;
  const parsed = CreateFlashSaleBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid flash sale" });
  const product = await db.select().from(products).where(eq(products.id, parsed.data.productId)).limit(1);
  if (!product[0]) return res.status(404).json({ error: "Product not found" });
  const rows = await db
    .insert(flashSales)
    .values({
      ...parsed.data,
      salePriceUsd: String(parsed.data.salePriceUsd),
      originalPriceUsd: product[0].priceUsd,
    })
    .returning();
  res.status(201).json({
    id: rows[0].id,
    productId: rows[0].productId,
    productName: product[0].nameEn,
    originalPriceUsd: numberValue(rows[0].originalPriceUsd),
    salePriceUsd: numberValue(rows[0].salePriceUsd),
    discountPercent: Math.round((1 - numberValue(rows[0].salePriceUsd) / numberValue(rows[0].originalPriceUsd)) * 100),
    startsAt: rows[0].startsAt.toISOString(),
    endsAt: rows[0].endsAt.toISOString(),
    status: rows[0].status,
    quantity: rows[0].quantity,
  });
});

router.get("/promo-codes", async (req, res) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return res;
  const rows = await db.select().from(promoCodes).orderBy(desc(promoCodes.createdAt));
  res.json(rows.map((row) => ({
    id: row.id,
    code: row.code,
    discountType: row.discountType,
    value: numberValue(row.value),
    maxUses: row.maxUses,
    usedCount: row.usedCount,
    expiresAt: iso(row.expiresAt),
    active: row.active,
  })));
});

router.post("/promo-codes", async (req, res) => {
  const admin = await requireAdmin(req, res);
  if (!admin || admin.role !== "super_admin") return res;
  const parsed = CreatePromoCodeBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid promo code" });
  const rows = await db
    .insert(promoCodes)
    .values({
      ...parsed.data,
      code: parsed.data.code.toUpperCase(),
      value: String(parsed.data.value),
    })
    .returning();
  res.status(201).json({
    id: rows[0].id,
    code: rows[0].code,
    discountType: rows[0].discountType,
    value: numberValue(rows[0].value),
    maxUses: rows[0].maxUses,
    usedCount: rows[0].usedCount,
    expiresAt: iso(rows[0].expiresAt),
    active: rows[0].active,
  });
});

async function getOrCreateSettings() {
  const existing = await db.select().from(storeSettings).limit(1);
  if (existing[0]) return existing[0];
  const rows = await db.insert(storeSettings).values({}).returning();
  return rows[0];
}

router.get("/settings", async (req, res) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return res;
  const settings = await getOrCreateSettings();
  const methods = await db.select().from(paymentMethods);
  const enabled = new Set(methods.filter((method) => method.enabled).map((method) => method.method));
  res.json({
    storeName: settings.storeName,
    requiredTelegramChannel: settings.requiredTelegramChannel,
    cashbackPercent: numberValue(settings.cashbackPercent),
    referralRewardUsd: numberValue(settings.referralRewardUsd),
    usdToEgpRate: numberValue(settings.usdToEgpRate),
    paymentRounding: settings.paymentRounding,
    checkoutTimeoutMinutes: settings.checkoutTimeoutMinutes,
    lowStockThreshold: settings.lowStockThreshold,
    maintenanceMode: settings.maintenanceMode,
    supportAvailable: settings.supportAvailable,
    binanceEnabled: enabled.has("binance"),
    bybitEnabled: enabled.has("bybit"),
    vodafoneCashEnabled: enabled.has("vodafone_cash"),
    instapayEnabled: enabled.has("instapay"),
    termsVersion: settings.termsVersion,
  });
});

router.patch("/settings", async (req, res) => {
  const admin = await requireAdmin(req, res);
  if (!admin || admin.role !== "super_admin") return res;
  const parsed = UpdateStoreSettingsBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid settings" });
  const settings = await getOrCreateSettings();
  const settingsUpdate: Partial<typeof storeSettings.$inferInsert> = {
    updatedAt: new Date(),
  };
  if (parsed.data.storeName !== undefined) settingsUpdate.storeName = parsed.data.storeName;
  if (parsed.data.requiredTelegramChannel !== undefined) settingsUpdate.requiredTelegramChannel = parsed.data.requiredTelegramChannel;
  if (parsed.data.cashbackPercent !== undefined) settingsUpdate.cashbackPercent = String(parsed.data.cashbackPercent);
  if (parsed.data.referralRewardUsd !== undefined) settingsUpdate.referralRewardUsd = String(parsed.data.referralRewardUsd);
  if (parsed.data.usdToEgpRate !== undefined) settingsUpdate.usdToEgpRate = String(parsed.data.usdToEgpRate);
  if (parsed.data.paymentRounding !== undefined) settingsUpdate.paymentRounding = parsed.data.paymentRounding;
  if (parsed.data.checkoutTimeoutMinutes !== undefined) settingsUpdate.checkoutTimeoutMinutes = parsed.data.checkoutTimeoutMinutes;
  if (parsed.data.lowStockThreshold !== undefined) settingsUpdate.lowStockThreshold = parsed.data.lowStockThreshold;
  if (parsed.data.maintenanceMode !== undefined) settingsUpdate.maintenanceMode = parsed.data.maintenanceMode;
  if (parsed.data.supportAvailable !== undefined) settingsUpdate.supportAvailable = parsed.data.supportAvailable;
  if (parsed.data.termsVersion !== undefined) settingsUpdate.termsVersion = parsed.data.termsVersion;
  const rows = await db.update(storeSettings).set(settingsUpdate).where(eq(storeSettings.id, settings.id)).returning();
  const methodToggles = [
    ["binance", parsed.data.binanceEnabled],
    ["bybit", parsed.data.bybitEnabled],
    ["vodafone_cash", parsed.data.vodafoneCashEnabled],
    ["instapay", parsed.data.instapayEnabled],
  ] as const;
  for (const [method, enabled] of methodToggles) {
    if (enabled === undefined) continue;
    const existing = await db.select().from(paymentMethods).where(eq(paymentMethods.method, method)).limit(1);
    if (existing[0]) await db.update(paymentMethods).set({ enabled, updatedAt: new Date() }).where(eq(paymentMethods.id, existing[0].id));
    else await db.insert(paymentMethods).values({ method, enabled });
  }
  res.json({
    storeName: rows[0].storeName,
    requiredTelegramChannel: rows[0].requiredTelegramChannel,
    cashbackPercent: numberValue(rows[0].cashbackPercent),
    referralRewardUsd: numberValue(rows[0].referralRewardUsd),
    usdToEgpRate: numberValue(rows[0].usdToEgpRate),
    paymentRounding: rows[0].paymentRounding,
    checkoutTimeoutMinutes: rows[0].checkoutTimeoutMinutes,
    lowStockThreshold: rows[0].lowStockThreshold,
    maintenanceMode: rows[0].maintenanceMode,
    supportAvailable: rows[0].supportAvailable,
    binanceEnabled: Boolean(parsed.data.binanceEnabled),
    bybitEnabled: Boolean(parsed.data.bybitEnabled),
    vodafoneCashEnabled: Boolean(parsed.data.vodafoneCashEnabled),
    instapayEnabled: Boolean(parsed.data.instapayEnabled),
    termsVersion: rows[0].termsVersion,
  });
});

router.get("/analytics/summary", async (req, res) => {
  const parsed = GetAnalyticsSummaryQueryParams.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: "A valid date range is required" });
  const admin = await requireAdmin(req, res);
  if (!admin) return res;
  const from = new Date(`${parsed.data.from}T00:00:00.000Z`);
  const to = new Date(`${parsed.data.to}T23:59:59.999Z`);
  const condition = and(sql`${orders.createdAt} >= ${from}`, sql`${orders.createdAt} <= ${to}`);
  const [totals, cancelled, paymentsByMethod, topProducts] = await Promise.all([
    db.select({ revenue: sum(orders.priceUsd), count: count() }).from(orders).where(and(condition, sql`${orders.status} <> 'cancelled'`)),
    db.select({ count: count() }).from(orders).where(and(condition, eq(orders.status, "cancelled"))),
    db.select({ label: orders.paymentMethod, value: sum(orders.priceUsd) }).from(orders).where(and(condition, sql`${orders.status} <> 'cancelled'`)).groupBy(orders.paymentMethod),
    db.select({ label: orders.productNameSnapshot, value: sum(orders.priceUsd) }).from(orders).where(and(condition, sql`${orders.status} <> 'cancelled'`)).groupBy(orders.productNameSnapshot).orderBy(desc(sum(orders.priceUsd))).limit(5),
  ]);
  const totalRevenue = numberValue(totals[0]?.revenue);
  const countValue = Number(totals[0]?.count ?? 0);
  res.json({
    revenueUsd: totalRevenue,
    orderCount: countValue,
    averageOrderValueUsd: countValue ? totalRevenue / countValue : 0,
    newCustomers: 0,
    returningCustomers: 0,
    cashbackIssuedUsd: 0,
    referralRewardsIssuedUsd: 0,
    cancelledOrders: Number(cancelled[0]?.count ?? 0),
    paymentConfirmationMinutes: 0,
    revenueByPaymentMethod: paymentsByMethod.map((row) => ({ label: row.label, value: numberValue(row.value) })),
    topProducts: topProducts.map((row) => ({ label: row.label, value: numberValue(row.value) })),
  });
});

function createValueHash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export default router;