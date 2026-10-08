/** Общие помощники HTTP-слоя. */

import type { FastifyReply, FastifyRequest } from "fastify";

/** Ошибка с HTTP-статусом и сообщением для пользователя (на русском). */
export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export type Role = "admin" | "manager";

export type AuthUser = {
  id: number;
  login: string;
  name: string;
  email: string | null;
  role: Role;
};

declare module "fastify" {
  interface FastifyRequest {
    user: AuthUser | null;
    sessionInfo: { id: string; csrfToken: string } | null;
  }
}

/** Текущий пользователь; 401, если сессии нет. */
export function currentUser(request: FastifyRequest): AuthUser {
  if (!request.user) throw new HttpError(401, "Требуется вход");
  return request.user;
}

export function requireAdmin(request: FastifyRequest): AuthUser {
  const user = currentUser(request);
  if (user.role !== "admin") throw new HttpError(403, "Недостаточно прав");
  return user;
}

/** Числовой параметр пути. */
export function intParam(value: unknown, name = "id"): number {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n <= 0) throw new HttpError(400, `Некорректный параметр ${name}`);
  return n;
}

export function body<T extends object = Record<string, unknown>>(request: FastifyRequest): Partial<T> {
  const value = request.body;
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Partial<T>;
}

export function noStore(reply: FastifyReply): FastifyReply {
  return reply.header("cache-control", "no-store");
}
