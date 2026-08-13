/**
 * HTTP-обработчик заявок с форм сайта → Bitrix24 CRM.
 *
 * Слушает порт 3000 (LEAD_PORT) и принимает:
 *   POST /api/lead — заявка с формы (JSON или form-urlencoded);
 *   GET  /healthz  — проверка живости.
 *
 * Запуск: `npm run server` (или `npm run dev` — поднимается вместе с 11ty).
 */

import fs from "node:fs";
import http from "node:http";
import path from "node:path";

import { config, maskWebhook } from "./config.js";
import { createLead } from "./bitrix.js";
import { buildLeadFields, parseLead, type RawPayload } from "./lead.js";

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
    "access-control-allow-methods": "POST, OPTIONS",
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
function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;

    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > config.maxBodyBytes) {
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

  const fields = buildLeadFields(
    lead,
    { ip, userAgent: String(req.headers["user-agent"] ?? "").slice(0, 300) },
    { sourceId: config.bitrix.sourceId, assignedById: config.bitrix.assignedById },
  );

  try {
    const leadId = await createLead(fields);
    console.log(
      `[lead] создан лид #${leadId} (форма ${lead.form}, ${lead.phone || lead.email || lead.telegram})`,
    );
    sendJson(res, 200, { ok: true, leadId }, headers);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[lead] Bitrix24 отклонил заявку: ${maskWebhook(message)}`);
    saveFailedLead({ at: new Date().toISOString(), ip, error: message, fields });
    sendJson(
      res,
      502,
      { ok: false, error: "Не удалось передать заявку в CRM. Мы сохранили её и свяжемся с вами." },
      headers,
    );
  }
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

  if (req.method === "GET" && (url.pathname === "/healthz" || url.pathname === "/")) {
    sendJson(res, 200, { ok: true, service: "bars-lead-api", endpoint: config.path }, headers);
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
  if (config.bitrix.configured) {
    console.log(`[lead] CRM: ${maskWebhook(config.bitrix.base)} (источник ${config.bitrix.sourceId})`);
  } else {
    console.warn(
      "[lead] ВНИМАНИЕ: не задан BITRIX_WEBHOOK_URL — заявки не будут уходить в CRM.\n" +
        "        Скопируйте .env.example в .env и вставьте входящий вебхук Bitrix24.",
    );
  }
  console.log(`[lead] разрешённые Origin: ${config.cors.allowedOrigins.join(", ") || "—"}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    console.log(`\n[lead] ${signal}: останавливаем обработчик…`);
    server.close(() => {
      process.exit(0);
    });
  });
}
