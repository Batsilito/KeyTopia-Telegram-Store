import {
  createHash,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import type { Request } from "express";
import { and, eq, gt } from "drizzle-orm";
import { db, adminSessions, admins } from "@workspace/db";

const SESSION_COOKIE = "kt_admin_session";
const SESSION_DAYS = 7;

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(password, salt, 64).toString("hex");
  return `scrypt$${salt}$${derived}`;
}

function verifyPassword(password: string, stored: string) {
  const [, salt, expected] = stored.split("$");
  if (!salt || !expected) return false;
  const actual = scryptSync(password, salt, 64);
  const expectedBuffer = Buffer.from(expected, "hex");
  return (
    actual.length === expectedBuffer.length &&
    timingSafeEqual(actual, expectedBuffer)
  );
}

export async function ensureBootstrapAdmin() {
  const email = process.env.INITIAL_SUPERADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.INITIAL_SUPERADMIN_PASSWORD;
  if (!email || !password) return;
  const existing = await db
    .select({ id: admins.id })
    .from(admins)
    .where(eq(admins.email, email))
    .limit(1);
  if (existing.length === 0) {
    await db.insert(admins).values({
      email,
      passwordHash: hashPassword(password),
      name: "Super Admin",
      role: "super_admin",
    });
  }
}

export async function authenticateAdmin(
  email: string,
  password: string,
) {
  const rows = await db
    .select()
    .from(admins)
    .where(and(eq(admins.email, email.toLowerCase()), eq(admins.active, true)))
    .limit(1);
  const admin = rows[0];
  if (!admin || !verifyPassword(password, admin.passwordHash)) return null;
  await db
    .update(admins)
    .set({ lastLoginAt: new Date() })
    .where(eq(admins.id, admin.id));
  return admin;
}

export async function createAdminSession(adminId: string) {
  const token = randomBytes(32).toString("base64url");
  await db.insert(adminSessions).values({
    adminId,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000),
  });
  return token;
}

export async function getAdminFromRequest(req: Request) {
  const token = req.cookies?.[SESSION_COOKIE] as string | undefined;
  if (!token) return null;
  const rows = await db
    .select({
      id: admins.id,
      email: admins.email,
      name: admins.name,
      role: admins.role,
    })
    .from(adminSessions)
    .innerJoin(admins, eq(adminSessions.adminId, admins.id))
    .where(
      and(
        eq(adminSessions.tokenHash, hashToken(token)),
        gt(adminSessions.expiresAt, new Date()),
        eq(admins.active, true),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function deleteAdminSession(req: Request) {
  const token = req.cookies?.[SESSION_COOKIE] as string | undefined;
  if (!token) return;
  await db
    .delete(adminSessions)
    .where(eq(adminSessions.tokenHash, hashToken(token)));
}

export function setSessionCookie(res: {
  cookie: (
    name: string,
    value: string,
    options: {
      httpOnly: boolean;
      sameSite: "lax";
      secure: boolean;
      maxAge: number;
      path: string;
    },
  ) => void;
}, token: string) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000,
    path: "/",
  });
}

export function clearSessionCookie(res: {
  clearCookie: (name: string, options: { httpOnly: boolean; path: string }) => void;
}) {
  res.clearCookie(SESSION_COOKIE, { httpOnly: true, path: "/" });
}
