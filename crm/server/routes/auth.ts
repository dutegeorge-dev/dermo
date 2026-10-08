/** Вход, выход, текущий пользователь, смена своего пароля. */

import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";

import { config } from "../config.ts";
import { db } from "../db/client.ts";
import { users } from "../db/schema.ts";
import { audit } from "../lib/audit.ts";
import { body, currentUser, HttpError } from "../lib/http.ts";
import { getDummyHash, hashPassword, validatePassword, verifyPassword } from "../lib/password.ts";
import { SlidingWindowLimiter } from "../lib/rate-limit.ts";
import { createSession, destroySession, destroyUserSessions } from "../lib/session.ts";

const ipLimiter = new SlidingWindowLimiter(config.loginLimit.perIp, config.loginLimit.windowMs);
const loginLimiter = new SlidingWindowLimiter(config.loginLimit.perLogin, config.loginLimit.windowMs);
setInterval(() => {
  ipLimiter.sweep();
  loginLimiter.sweep();
}, 10 * 60 * 1000).unref();

function tooMany(ms: number): HttpError {
  const minutes = Math.max(1, Math.ceil(ms / 60_000));
  return new HttpError(429, `Слишком много попыток входа. Попробуйте через ${minutes} мин.`);
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post("/login", async (request, reply) => {
    const input = body<{ login: string; password: string }>(request);
    const login = typeof input.login === "string" ? input.login.trim().toLowerCase() : "";
    const password = typeof input.password === "string" ? input.password : "";
    if (!login || !password) throw new HttpError(400, "Введите логин и пароль");

    const ipKey = `ip:${request.ip}`;
    const loginKey = `login:${login}`;
    const wait = Math.max(ipLimiter.retryAfter(ipKey), loginLimiter.retryAfter(loginKey));
    if (wait > 0) {
      reply.header("retry-after", Math.ceil(wait / 1000));
      throw tooMany(wait);
    }
    ipLimiter.hit(ipKey);

    const [user] = await db.select().from(users).where(eq(users.login, login)).limit(1);
    const ok = user
      ? await verifyPassword(user.passwordHash, password)
      : (await verifyPassword(await getDummyHash(), password), false);

    if (!user || !ok || !user.isActive) {
      loginLimiter.hit(loginKey);
      throw new HttpError(401, "Неверный логин или пароль");
    }

    loginLimiter.reset(loginKey);
    const { csrfToken } = await createSession(request, reply, user.id);
    await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
    await audit(db, {
      userId: user.id,
      action: "login",
      entityType: "user",
      entityId: user.id,
      summary: "Вход в систему",
      ip: request.ip,
    });

    return {
      user: { id: user.id, login: user.login, name: user.name, email: user.email, role: user.role },
      csrfToken,
    };
  });

  app.post("/logout", async (request, reply) => {
    const user = request.user;
    await destroySession(request, reply);
    if (user) {
      await audit(db, {
        userId: user.id,
        action: "logout",
        entityType: "user",
        entityId: user.id,
        summary: "Выход из системы",
        ip: request.ip,
      });
    }
    return { ok: true };
  });

  app.get("/me", async (request) => ({
    user: currentUser(request),
    csrfToken: request.sessionInfo?.csrfToken,
  }));

  /** Сотрудник меняет свой пароль; остальные его сессии завершаются. */
  app.post("/password", async (request) => {
    const user = currentUser(request);
    const input = body<{ currentPassword: string; newPassword: string }>(request);
    const [row] = await db.select().from(users).where(eq(users.id, user.id)).limit(1);
    if (!row || !(await verifyPassword(row.passwordHash, String(input.currentPassword ?? "")))) {
      throw new HttpError(400, "Текущий пароль указан неверно");
    }
    const problem = validatePassword(input.newPassword);
    if (problem) throw new HttpError(400, problem);

    await db
      .update(users)
      .set({ passwordHash: await hashPassword(input.newPassword as string), updatedAt: new Date() })
      .where(eq(users.id, user.id));
    await destroyUserSessions(user.id, request.sessionInfo?.id);
    await audit(db, {
      userId: user.id,
      action: "update",
      entityType: "user",
      entityId: user.id,
      summary: "Сменил свой пароль",
      ip: request.ip,
    });
    return { ok: true };
  });

  /** Сотрудник меняет своё имя и e-mail. */
  app.patch("/profile", async (request) => {
    const user = currentUser(request);
    const input = body<{ name: string; email: string }>(request);
    const name = typeof input.name === "string" ? input.name.trim().slice(0, 120) : user.name;
    const email = typeof input.email === "string" ? input.email.trim().slice(0, 200) || null : user.email;
    if (!name) throw new HttpError(400, "Укажите имя");
    await db.update(users).set({ name, email, updatedAt: new Date() }).where(eq(users.id, user.id));
    await audit(db, {
      userId: user.id,
      action: "update",
      entityType: "user",
      entityId: user.id,
      summary: "Изменил свой профиль",
      ip: request.ip,
    });
    return { user: { ...user, name, email } };
  });
}
