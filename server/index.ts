/**
 * HTTP-обработчик заявок с форм сайта → Bitrix24 CRM.
 *
 * Слушает порт 3000 (LEAD_PORT) и принимает:
 *   POST /api/lead  — заявка с формы (JSON или form-urlencoded);
 *   GET  /api/rates — курсы валют ЦБ РФ для калькулятора доставки;
 *   GET  /healthz   — проверка живости.
 *
 * Запуск: `npm run server` (или `npm run dev` — поднимается вместе с 11ty).
 */

import fs from "node:fs";
import http from "node:http";
import path from "node:path";

import { config, maskSecrets } from "./config.ts";
import {
  clearCookieHeader,
  issueSession,
  sessionCookieHeader,
  sessionUser,
  verifyCredentials,
} from "./auth.ts";
import { proxyCms } from "./cms.ts";
import { createLead } from "./bitrix.ts";
import { computeCalculation, type CalcRates } from "./calc.ts";
import { buildLeadFields, parseLead, type RawPayload } from "./lead.ts";
import { getRates } from "./rates.ts";
import { notifyTelegram } from "./telegram.ts";

/** Ответ клиенту в JSON. */
function sendJson(
  res: http.ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "cache-control": "no-store",
    ...headers,
  });
  res.end(payload);
}

/** Разрешён ли Origin (CORS). */
function resolveCorsOrigin(origin: string | undefined): string | undefined {
  if (!origin) return undefined;
  if (config.cors.allowAll) return origin;
  const normalized = origin.replace(/\/$/, "");
  return config.cors.allowedOrigins.includes(normalized) ? origin : undefined;
}

/** Проставляет CORS-заголовки, если источник разрешён. */
function corsHeaders(origin: string | undefined): Record<string, string> {
  const allowed = resolveCorsOrigin(origin);
  if (!allowed) return { vary: "Origin" };
  return {
    "access-control-allow-origin": allowed,
    // GET нужен калькулятору: он забирает курсы ЦБ с /api/rates.
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-max-age": "86400",
    vary: "Origin",
  };
}

/** IP клиента с учётом обратного прокси. */
function clientIp(req: http.IncomingMessage): string {
  const forwarded = req.headers["x-forwarded-for"];
  const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  if (raw) return raw.split(",")[0].trim();
  return req.socket.remoteAddress ?? "unknown";
}

// ── Ограничение частоты: фиксированное окно на IP ──────────────────────────
// Счётчик тратится только на заявках, которые реально уходят в CRM: ошибки
// валидации не должны блокировать человека, исправляющего опечатку.
const hits = new Map<string, { count: number; resetAt: number }>();

/** Исчерпан ли лимит (без списания попытки). */
function rateLimited(ip: string): boolean {
  const entry = hits.get(ip);
  if (!entry || entry.resetAt <= Date.now()) return false;
  return entry.count >= config.rateLimit.max;
}

/** Списывает одну попытку с IP. */
function consumeRate(ip: string): void {
  const now = Date.now();
  const entry = hits.get(ip);

  if (!entry || entry.resetAt <= now) {
    hits.set(ip, { count: 1, resetAt: now + config.rateLimit.windowMs });
    return;
  }

  entry.count += 1;
}

// Периодическая чистка, чтобы карта не росла бесконечно.
const cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of hits) {
    if (entry.resetAt <= now) hits.delete(ip);
  }
}, 60_000);
cleanupTimer.unref();

/** Читает тело запроса с ограничением по размеру. */
function readBody(
  req: http.IncomingMessage,
  maxBytes: number = config.maxBodyBytes,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;

    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error("PAYLOAD_TOO_LARGE"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
    req.on("error", reject);
  });
}

/** Разбирает тело: JSON или application/x-www-form-urlencoded. */
function parseBody(body: string, contentType: string): RawPayload {
  if (contentType.includes("application/x-www-form-urlencoded")) {
    const params = new URLSearchParams(body);
    const result: RawPayload = {};
    for (const [key, value] of params) result[key] = value;
    return result;
  }

  if (!body.trim()) return {};

  const parsed: unknown = JSON.parse(body);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new SyntaxError("Ожидается JSON-объект");
  }
  return parsed as RawPayload;
}

/** Сохраняет заявку, которую не удалось отдать в CRM, чтобы она не потерялась. */
function saveFailedLead(entry: unknown): void {
  try {
    fs.mkdirSync(path.dirname(config.failedLeadsFile), { recursive: true });
    fs.appendFileSync(config.failedLeadsFile, `${JSON.stringify(entry)}\n`, "utf8");
  } catch (error) {
    console.error("[lead] не удалось записать резервный лог заявки:", error);
  }
}

/**
 * Курсы для пересчёта заявки с калькулятора: наши (из кэша ЦБ), а если ЦБ
 * недоступен — те, что видел посетитель на странице. Расчёт всё равно
 * предварительный, но заявка не должна теряться из-за молчания ЦБ.
 */
async function resolveRates(fallback: CalcRates | null): Promise<CalcRates> {
  try {
    const rates = await getRates();
    return { usd: rates.usd, cny: rates.cny, date: rates.date };
  } catch {
    return fallback ?? { usd: 0, cny: 0, date: "" };
  }
}

/** Обработчик POST /api/lead. */
async function handleLead(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  headers: Record<string, string>,
): Promise<void> {
  const ip = clientIp(req);

  if (!config.bitrix.configured) {
    sendJson(
      res,
      503,
      { ok: false, error: "Приём заявок не настроен: не задан BITRIX_WEBHOOK_URL." },
      headers,
    );
    return;
  }

  if (rateLimited(ip)) {
    sendJson(res, 429, { ok: false, error: "Слишком много заявок. Попробуйте через минуту." }, headers);
    return;
  }

  let payload: RawPayload;
  try {
    const body = await readBody(req);
    payload = parseBody(body, String(req.headers["content-type"] ?? ""));
  } catch (error) {
    const tooLarge = error instanceof Error && error.message === "PAYLOAD_TOO_LARGE";
    sendJson(
      res,
      tooLarge ? 413 : 400,
      { ok: false, error: tooLarge ? "Слишком большой запрос." : "Некорректный формат запроса." },
      headers,
    );
    return;
  }

  // Honeypot: поле скрыто от людей — заполнено только ботом. Отвечаем «успехом»,
  // чтобы не подсказывать спамеру, и лид не создаём.
  const honeypot = typeof payload.company === "string" ? payload.company.trim() : "";
  if (honeypot) {
    consumeRate(ip);
    console.warn(`[lead] honeypot сработал, IP ${ip}`);
    sendJson(res, 200, { ok: true, leadId: null }, headers);
    return;
  }

  const { ok, errors, lead } = parseLead(payload);
  if (!ok) {
    sendJson(res, 422, { ok: false, error: "Проверьте заполнение формы.", fields: errors }, headers);
    return;
  }

  consumeRate(ip);

  // Заявка с калькулятора: суммы пересчитываем здесь заново, на курсах ЦБ с
  // нашей стороны. В CRM должен попасть наш расчёт, а не числа из браузера.
  const calc = lead.calc ? computeCalculation(lead.calc, await resolveRates(lead.calcRates)) : null;

  const fields = buildLeadFields(
    lead,
    { ip, userAgent: String(req.headers["user-agent"] ?? "").slice(0, 300) },
    { sourceId: config.bitrix.sourceId, assignedById: config.bitrix.assignedById },
    calc,
  );

  try {
    const leadId = await createLead(fields);
    console.log(
      `[lead] создан лид #${leadId} (форма ${lead.form}, ${lead.phone || lead.email || lead.telegram})`,
    );
    sendJson(res, 200, { ok: true, leadId }, headers);
    // Уведомление шлём после ответа клиенту: форма не должна ждать Telegram.
    void notifyTelegram(lead, { leadId }, calc);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[lead] Bitrix24 отклонил заявку: ${maskSecrets(message)}`);
    saveFailedLead({ at: new Date().toISOString(), ip, error: message, fields });
    sendJson(
      res,
      502,
      { ok: false, error: "Не удалось передать заявку в CRM. Мы сохранили её и свяжемся с вами." },
      headers,
    );
    // Именно здесь уведомление важнее всего: CRM недоступна, и только
    // Telegram донесёт контакт клиента до менеджера.
    void notifyTelegram(lead, { leadId: null, error: maskSecrets(message) }, calc);
  }
}

/** Обработчик GET /api/rates — курсы ЦБ для калькулятора. */
async function handleRates(
  res: http.ServerResponse,
  headers: Record<string, string>,
): Promise<void> {
  try {
    const rates = await getRates();
    sendJson(res, 200, rates, {
      ...headers,
      // Курс ЦБ меняется раз в сутки: получасовой кэш в браузере/на прокси
      // снимает нагрузку и не даёт показать вчерашний курс надолго.
      "cache-control": "public, max-age=1800",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[rates] ${message}`);
    sendJson(
      res,
      503,
      { ok: false, error: "Курсы ЦБ временно недоступны. Попробуйте обновить страницу позже." },
      headers,
    );
  }
}

/** Редирект (для форм логина/логаута админки). */
function redirect(res: http.ServerResponse, location: string, cookie?: string): void {
  const headers: Record<string, string> = { location };
  if (cookie) headers["set-cookie"] = cookie;
  res.writeHead(302, headers);
  res.end();
}

/** POST /api/cms/login — проверка логина/пароля из .env, выдача сессии. */
async function handleCmsLogin(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  let payload: RawPayload;
  try {
    const body = await readBody(req, 8 * 1024);
    payload = parseBody(body, String(req.headers["content-type"] ?? ""));
  } catch {
    redirect(res, "/admin/login.html?error=1");
    return;
  }

  const login = typeof payload.login === "string" ? payload.login.trim() : "";
  const password = typeof payload.password === "string" ? payload.password : "";

  if (!login || !password || !verifyCredentials(login, password)) {
    console.warn(`[cms] неудачный вход: «${login || "—"}»`);
    redirect(res, "/admin/login.html?error=1");
    return;
  }

  console.log(`[cms] вход: ${login}`);
  redirect(res, "/admin/", sessionCookieHeader(issueSession(login)));
}

/** GET /api/cms/verify — 200 при валидной сессии, иначе 401 (для nginx auth_request). */
function handleCmsVerify(req: http.IncomingMessage, res: http.ServerResponse): void {
  if (sessionUser(req.headers.cookie)) {
    res.writeHead(204, { "cache-control": "no-store" });
  } else {
    res.writeHead(401, { "cache-control": "no-store" });
  }
  res.end();
}

/** POST /api/cms/v1 — проброс протокола Decap на локальный decap-server. */
async function handleCmsProxy(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  if (!sessionUser(req.headers.cookie)) {
    sendJson(res, 401, { error: "Требуется вход в админку." });
    return;
  }

  let body: string;
  try {
    body = await readBody(req, config.cms.maxBodyBytes);
  } catch {
    sendJson(res, 413, { error: "Слишком большой запрос." });
    return;
  }

  const result = await proxyCms(body);
  res.writeHead(result.status, {
    "content-type": result.contentType,
    "cache-control": "no-store",
  });
  res.end(result.body);
}

const server = http.createServer((req, res) => {
  const origin = req.headers.origin;
  const headers = corsHeaders(origin);
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

  if (req.method === "OPTIONS") {
    res.writeHead(204, headers);
    res.end();
    return;
  }

  // ── Админка CMS (логин из .env + проброс протокола Decap) ────────────────
  if (url.pathname.startsWith("/api/cms/")) {
    if (!config.cms.enabled) {
      sendJson(res, 503, { error: "Админка не настроена: задайте CMS_USERS и CMS_SESSION_SECRET." });
      return;
    }
    if (url.pathname === "/api/cms/login" && req.method === "POST") {
      void handleCmsLogin(req, res);
      return;
    }
    if (url.pathname === "/api/cms/logout") {
      redirect(res, "/admin/login.html", clearCookieHeader());
      return;
    }
    if (url.pathname === "/api/cms/verify" && req.method === "GET") {
      handleCmsVerify(req, res);
      return;
    }
    if (url.pathname === "/api/cms/v1" && req.method === "POST") {
      void handleCmsProxy(req, res);
      return;
    }
    sendJson(res, 404, { error: "Не найдено." });
    return;
  }

  if (req.method === "GET" && (url.pathname === "/healthz" || url.pathname === "/")) {
    sendJson(
      res,
      200,
      { ok: true, service: "bars-lead-api", endpoint: config.path, rates: config.ratesPath },
      headers,
    );
    return;
  }

  if (url.pathname === config.ratesPath) {
    if (req.method !== "GET") {
      sendJson(res, 405, { ok: false, error: "Используйте GET." }, { ...headers, allow: "GET, OPTIONS" });
      return;
    }
    void handleRates(res, headers);
    return;
  }

  if (url.pathname !== config.path) {
    sendJson(res, 404, { ok: false, error: "Не найдено." }, headers);
    return;
  }

  if (req.method !== "POST") {
    sendJson(res, 405, { ok: false, error: "Используйте POST." }, { ...headers, allow: "POST, OPTIONS" });
    return;
  }

  void handleLead(req, res, headers);
});

server.listen(config.port, config.host, () => {
  console.log(`[lead] обработчик заявок слушает http://${config.host}:${config.port}${config.path}`);
  console.log(`[rates] курсы ЦБ для калькулятора: http://${config.host}:${config.port}${config.ratesPath}`);
  if (config.bitrix.configured) {
    console.log(`[lead] CRM: ${maskSecrets(config.bitrix.base)} (источник ${config.bitrix.sourceId})`);
  } else {
    console.warn(
      "[lead] ВНИМАНИЕ: не задан BITRIX_WEBHOOK_URL — заявки не будут уходить в CRM.\n" +
        "        Скопируйте .env.example в .env и вставьте входящий вебхук Bitrix24.",
    );
  }
  console.log(
    config.telegram.enabled
      ? `[lead] Telegram-уведомления: чаты ${config.telegram.chatIds.join(", ")}`
      : "[lead] Telegram-уведомления отключены (нет TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID)",
  );
  console.log(`[lead] разрешённые Origin: ${config.cors.allowedOrigins.join(", ") || "—"}`);

  if (config.cms.enabled) {
    console.log(
      `[cms] админка включена: ${config.cms.users.size} польз., проксируем на ${config.cms.proxyTarget}`,
    );
  } else if (config.cms.hasUsers || config.cms.hasSecret) {
    console.warn(
      "[cms] админка ВЫКЛЮЧЕНА: нужны обе переменные — CMS_USERS и CMS_SESSION_SECRET.",
    );
  } else {
    console.log("[cms] админка отключена (CMS_USERS / CMS_SESSION_SECRET не заданы)");
  }
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    console.log(`\n[lead] ${signal}: останавливаем обработчик…`);
    server.close(() => {
      process.exit(0);
    });
  });
}
