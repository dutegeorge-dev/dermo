/**
 * Простая авторизация админки CMS: логины и пароли из .env (CMS_USERS),
 * сессия — подписанная HMAC cookie. Без внешних зависимостей.
 *
 * Формат cookie: `<base64url(payload)>.<base64url(hmac)>`,
 * payload = {"u": "<логин>", "e": <срок годности, unix-мс>}.
 * Подделать нельзя: hmac считается на секрете CMS_SESSION_SECRET, который
 * знает только сервер. Пароли в браузер не попадают — только эта cookie.
 */

import crypto from "node:crypto";

import { config } from "./config.ts";

const SECRET = config.cms.sessionSecret;

/** base64url без паддинга. */
function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

/** HMAC-SHA256 от строки, в base64url. */
function sign(data: string): string {
  return crypto.createHmac("sha256", SECRET).update(data).digest("base64url");
}

/** Сравнение строк за постоянное время (без утечки по времени). */
function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

/**
 * Проверяет логин/пароль по CMS_USERS. Сравнение пароля — за постоянное время;
 * несуществующий логин всё равно прогоняем через сравнение с заглушкой, чтобы
 * по времени ответа нельзя было отличить «нет логина» от «неверный пароль».
 */
export function verifyCredentials(login: string, password: string): boolean {
  const expected = config.cms.users.get(login);
  if (expected === undefined) {
    // Холостое сравнение, чтобы время ответа не выдавало отсутствие логина.
    safeEqual(password, password);
    return false;
  }
  return safeEqual(password, expected);
}

/** Выдаёт значение cookie-сессии для логина. */
export function issueSession(login: string): string {
  const payload = b64url(JSON.stringify({ u: login, e: Date.now() + config.cms.sessionTtlMs }));
  return `${payload}.${sign(payload)}`;
}

/** Проверяет cookie-сессию. Возвращает логин или null. */
export function readSession(cookieValue: string | undefined): string | null {
  if (!cookieValue) return null;
  const dot = cookieValue.lastIndexOf(".");
  if (dot <= 0) return null;

  const payload = cookieValue.slice(0, dot);
  const mac = cookieValue.slice(dot + 1);
  if (!safeEqual(mac, sign(payload))) return null;

  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      u?: unknown;
      e?: unknown;
    };
    if (typeof data.u !== "string" || typeof data.e !== "number") return null;
    if (data.e <= Date.now()) return null;
    // Логин мог быть удалён из .env после выдачи сессии — тогда доступа нет.
    if (!config.cms.users.has(data.u)) return null;
    return data.u;
  } catch {
    return null;
  }
}

/** Достаёт нужную cookie из заголовка Cookie. */
export function getCookie(cookieHeader: string | undefined, name: string): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return undefined;
}

/** Логин из cookie-заголовка запроса, либо null. */
export function sessionUser(cookieHeader: string | undefined): string | null {
  return readSession(getCookie(cookieHeader, config.cms.cookieName));
}

/** Set-Cookie для выданной сессии. */
export function sessionCookieHeader(value: string): string {
  const maxAgeSec = Math.floor(config.cms.sessionTtlMs / 1000);
  const attrs = [
    `${config.cms.cookieName}=${encodeURIComponent(value)}`,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    `Max-Age=${maxAgeSec}`,
  ];
  if (config.cms.cookieSecure) attrs.push("Secure");
  return attrs.join("; ");
}

/** Set-Cookie, стирающий сессию. */
export function clearCookieHeader(): string {
  const attrs = [
    `${config.cms.cookieName}=`,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    "Max-Age=0",
  ];
  if (config.cms.cookieSecure) attrs.push("Secure");
  return attrs.join("; ");
}
