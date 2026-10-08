/**
 * Сессии: случайный токен в cookie (HttpOnly; Secure; SameSite=Lax; Path=/crm),
 * в БД — только SHA-256 от него. Срок — 30 дней, продлевается при активности.
 * У каждой сессии свой CSRF-токен: фронтенд получает его из /auth/me и
 * присылает в заголовке X-CSRF-Token на всех изменяющих запросах.
 */

import crypto from "node:crypto";

import { and, eq, gt, lt, ne } from "drizzle-orm";
import type { FastifyReply, FastifyRequest } from "fastify";

import { config } from "../config.ts";
import { db } from "../db/client.ts";
import { sessions, users } from "../db/schema.ts";
import type { AuthUser } from "./http.ts";

/** Как часто продлевать сессию (не на каждый запрос, чтобы не писать в БД). */
const RENEW_EVERY_MS = 60 * 60 * 1000;

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function randomToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

function setCookie(reply: FastifyReply, token: string, expires: Date): void {
  reply.setCookie(config.session.cookieName, token, {
    path: config.basePath,
    httpOnly: true,
    secure: config.session.secure,
    sameSite: "lax",
    expires,
  });
}

export async function createSession(
  request: FastifyRequest,
  reply: FastifyReply,
  userId: number,
): Promise<{ csrfToken: string }> {
  const token = randomToken();
  const csrfToken = randomToken();
  const expiresAt = new Date(Date.now() + config.session.ttlMs);
  await db.insert(sessions).values({
    id: sha256(token),
    userId,
    csrfToken,
    expiresAt,
    ip: request.ip,
    userAgent: String(request.headers["user-agent"] ?? "").slice(0, 300),
  });
  setCookie(reply, token, expiresAt);
  return { csrfToken };
}

export async function destroySession(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (request.sessionInfo) {
    await db.delete(sessions).where(eq(sessions.id, request.sessionInfo.id));
  }
  reply.clearCookie(config.session.cookieName, { path: config.basePath });
}

/** Завершить все сессии пользователя (смена пароля, отключение). */
export async function destroyUserSessions(userId: number, exceptId?: string): Promise<void> {
  await db
    .delete(sessions)
    .where(and(eq(sessions.userId, userId), exceptId ? ne(sessions.id, exceptId) : undefined));
}

/** Находит сессию по cookie и кладёт пользователя в request.user. */
export async function loadSession(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  request.user = null;
  request.sessionInfo = null;
  const token = request.cookies[config.session.cookieName];
  if (!token) return;

  const id = sha256(token);
  const now = new Date();
  const [row] = await db
    .select({
      sessionId: sessions.id,
      csrfToken: sessions.csrfToken,
      lastSeenAt: sessions.lastSeenAt,
      user: {
        id: users.id,
        login: users.login,
        name: users.name,
        email: users.email,
        role: users.role,
        isActive: users.isActive,
      },
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, id), gt(sessions.expiresAt, now)))
    .limit(1);

  if (!row || !row.user.isActive) {
    reply.clearCookie(config.session.cookieName, { path: config.basePath });
    return;
  }

  const { isActive: _isActive, ...user } = row.user;
  request.user = user satisfies AuthUser;
  request.sessionInfo = { id: row.sessionId, csrfToken: row.csrfToken };

  if (now.getTime() - row.lastSeenAt.getTime() > RENEW_EVERY_MS) {
    const expiresAt = new Date(now.getTime() + config.session.ttlMs);
    await db
      .update(sessions)
      .set({ lastSeenAt: now, expiresAt, ip: request.ip })
      .where(eq(sessions.id, id));
    setCookie(reply, token, expiresAt);
  }
}

/** Удаляет просроченные сессии. */
export async function purgeExpiredSessions(): Promise<void> {
  await db.delete(sessions).where(lt(sessions.expiresAt, new Date()));
}

/** Сравнение строк за постоянное время. */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}
