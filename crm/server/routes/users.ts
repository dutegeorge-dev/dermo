/** Управление пользователями (только admin). */

import { asc, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";

import { db } from "../db/client.ts";
import { users } from "../db/schema.ts";
import { audit } from "../lib/audit.ts";
import { body, HttpError, intParam, requireAdmin, type Role } from "../lib/http.ts";
import { hashPassword, validatePassword } from "../lib/password.ts";
import { destroyUserSessions } from "../lib/session.ts";

const ROLES: Role[] = ["admin", "manager"];
const ROLE_NAMES: Record<Role, string> = { admin: "администратор", manager: "менеджер" };
const LOGIN_RE = /^[a-z0-9._@-]{3,64}$/;

const publicColumns = {
  id: users.id,
  login: users.login,
  name: users.name,
  email: users.email,
  role: users.role,
  isActive: users.isActive,
  createdAt: users.createdAt,
  lastLoginAt: users.lastLoginAt,
};

export async function userRoutes(app: FastifyInstance): Promise<void> {
  /** Краткий список сотрудников — нужен всем (авторы правок, позже исполнители сделок). */
  app.get("/directory", async () => ({
    users: await db
      .select({ id: users.id, name: users.name, isActive: users.isActive })
      .from(users)
      .orderBy(asc(users.name)),
  }));

  app.get("/", async (request) => {
    requireAdmin(request);
    return { users: await db.select(publicColumns).from(users).orderBy(asc(users.id)) };
  });

  app.post("/", async (request) => {
    const admin = requireAdmin(request);
    const input = body<{ login: string; name: string; email: string; role: Role; password: string }>(request);
    const login = String(input.login ?? "").trim().toLowerCase();
    const name = String(input.name ?? "").trim().slice(0, 120);
    const email = String(input.email ?? "").trim().slice(0, 200) || null;
    const role = input.role ?? "manager";

    if (!LOGIN_RE.test(login)) {
      throw new HttpError(400, "Логин: 3–64 символа — латиница, цифры, точка, дефис, @");
    }
    if (!name) throw new HttpError(400, "Укажите имя");
    if (!ROLES.includes(role)) throw new HttpError(400, "Неизвестная роль");
    const problem = validatePassword(input.password);
    if (problem) throw new HttpError(400, problem);

    const [exists] = await db.select({ id: users.id }).from(users).where(eq(users.login, login));
    if (exists) throw new HttpError(409, "Такой логин уже есть");

    const [created] = await db
      .insert(users)
      .values({ login, name, email, role, passwordHash: await hashPassword(input.password as string) })
      .returning(publicColumns);

    await audit(db, {
      userId: admin.id,
      action: "create",
      entityType: "user",
      entityId: created.id,
      summary: `Создал пользователя ${name} (${login}), роль — ${ROLE_NAMES[role]}`,
      ip: request.ip,
    });
    return { user: created };
  });

  app.patch("/:id", async (request) => {
    const admin = requireAdmin(request);
    const id = intParam((request.params as { id: string }).id);
    const input = body<{ name: string; email: string; role: Role; isActive: boolean; password: string }>(request);

    const [user] = await db.select().from(users).where(eq(users.id, id));
    if (!user) throw new HttpError(404, "Пользователь не найден");

    const changes: Partial<typeof users.$inferInsert> = {};
    const notes: string[] = [];

    if (typeof input.name === "string") {
      const name = input.name.trim().slice(0, 120);
      if (!name) throw new HttpError(400, "Укажите имя");
      if (name !== user.name) {
        changes.name = name;
        notes.push(`имя → ${name}`);
      }
    }
    if (typeof input.email === "string") {
      const email = input.email.trim().slice(0, 200) || null;
      if (email !== user.email) {
        changes.email = email;
        notes.push("e-mail");
      }
    }
    if (input.role !== undefined && input.role !== user.role) {
      if (!ROLES.includes(input.role)) throw new HttpError(400, "Неизвестная роль");
      if (id === admin.id) throw new HttpError(400, "Нельзя менять роль самому себе");
      changes.role = input.role;
      notes.push(`роль → ${ROLE_NAMES[input.role]}`);
    }
    if (typeof input.isActive === "boolean" && input.isActive !== user.isActive) {
      if (id === admin.id) throw new HttpError(400, "Нельзя отключить самого себя");
      changes.isActive = input.isActive;
      notes.push(input.isActive ? "включён" : "отключён");
    }
    if (input.password !== undefined && input.password !== "") {
      const problem = validatePassword(input.password);
      if (problem) throw new HttpError(400, problem);
      changes.passwordHash = await hashPassword(input.password);
      notes.push("новый пароль");
    }

    if (Object.keys(changes).length === 0) {
      const [same] = await db.select(publicColumns).from(users).where(eq(users.id, id));
      return { user: same };
    }

    const [updated] = await db
      .update(users)
      .set({ ...changes, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning(publicColumns);

    // Отключение или сброс пароля — выкидываем из всех сессий.
    if (changes.isActive === false || changes.passwordHash) await destroyUserSessions(id);

    await audit(db, {
      userId: admin.id,
      action: "update",
      entityType: "user",
      entityId: id,
      summary: `Изменил пользователя ${updated.name}: ${notes.join(", ")}`,
      ip: request.ip,
    });
    return { user: updated };
  });
}
