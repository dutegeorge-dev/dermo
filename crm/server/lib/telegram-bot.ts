/**
 * Бот заявок в Telegram: сотрудник пересылает или вставляет текст заявки — бот заводит лид в воронке (клиент,
 * контакт, тип заявки). Работает в процессе bars-crm long polling'ом (getUpdates): ни вебхука, ни правки nginx.
 * Пишут боту только сотрудники, привязавшие Telegram в профиле (users.telegram_id), и только в личке.
 */

import crypto from "node:crypto";

import { eq } from "drizzle-orm";

import { REQUEST_TYPES } from "../../shared/deal-fields.ts";
import { config } from "../config.ts";
import { db } from "../db/client.ts";
import { settings, users } from "../db/schema.ts";
import { unlinkStoredFiles } from "../routes/files.ts";
import { type AiUsage, aiEnabled } from "./ai.ts";
import { audit } from "./audit.ts";
import { HttpError } from "./http.ts";
import { createLeadFromDraft, findDuplicateLead, type LeadDraft, type LeadResult, MATCHED_BY, parseLeadRequest, undoLead } from "./telegram-leads.ts";

type Json = any;
export type TelegramApi = (method: string, params?: Record<string, unknown>, signal?: AbortSignal) => Promise<Json>;
type Log = { info: (msg: string) => void; warn: (obj: unknown, msg?: string) => void; error: (obj: unknown, msg?: string) => void };

export type BotDeps = {
  api: TelegramApi;
  /** Разбор заявки (в тестах — подставной, без ИИ). */
  parse?: (text: string) => Promise<{ draft: LeadDraft; usage: AiUsage | null }>;
  /** Сколько ждать продолжения: длинный текст Telegram режет на несколько сообщений по 4096 символов. 0 — сразу. */
  mergeMs?: number;
  log?: Log;
};

export function telegramEnabled(): boolean {
  return Boolean(config.telegram.token);
}

export function telegramApi(token: string): TelegramApi {
  return async (method, params = {}, signal) => {
    const res = await fetch(`${config.telegram.apiUrl}/bot${token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(params),
      signal: signal ?? AbortSignal.timeout(30_000),
    });
    const data = (await res.json().catch(() => null)) as { ok?: boolean; result?: Json; description?: string; error_code?: number } | null;
    if (!data?.ok) {
      const error = new Error(`Telegram ${method}: ${data?.description ?? res.status}`) as Error & { code?: number };
      error.code = data?.error_code ?? res.status;
      throw error;
    }
    return data.result;
  };
}

// ── Привязка Telegram к сотруднику ─────────────────────────────────────────

const LINK_TTL_MS = 15 * 60 * 1000;
const linkCodes = new Map<string, { userId: number; expires: number }>();
let botUsername: string | null = null;

export function telegramBotUsername(): string | null {
  return botUsername;
}

/** Одноразовый код (15 минут): /start <код> в боте связывает Telegram с сотрудником. */
export function createLinkCode(userId: number): { code: string; url: string | null; expiresInMin: number } {
  const now = Date.now();
  for (const [k, v] of linkCodes) if (v.expires < now || v.userId === userId) linkCodes.delete(k);
  const code = crypto.randomBytes(6).toString("base64url").replace(/[-_]/g, "x").toUpperCase().slice(0, 8);
  linkCodes.set(code, { userId, expires: now + LINK_TTL_MS });
  return { code, url: botUsername ? `https://t.me/${botUsername}?start=${code}` : null, expiresInMin: LINK_TTL_MS / 60_000 };
}

async function linkByCode(code: string, telegramId: number): Promise<{ name: string } | null> {
  const entry = linkCodes.get(code.toUpperCase());
  if (!entry || entry.expires < Date.now()) return null;
  linkCodes.delete(code.toUpperCase());
  return db.transaction(async (tx) => {
    // Один Telegram — один сотрудник: со старой учётки отвязываем.
    await tx.update(users).set({ telegramId: null }).where(eq(users.telegramId, telegramId));
    const [user] = await tx.update(users).set({ telegramId, updatedAt: new Date() }).where(eq(users.id, entry.userId)).returning({ id: users.id, name: users.name });
    if (!user) return null;
    await audit(tx, { userId: user.id, action: "update", entityType: "user", entityId: user.id, summary: "Привязал Telegram к боту заявок" });
    return { name: user.name };
  });
}

async function userByTelegram(telegramId: number) {
  const [user] = await db
    .select({ id: users.id, name: users.name, role: users.role, isActive: users.isActive })
    .from(users)
    .where(eq(users.telegramId, telegramId));
  return user?.isActive ? user : null;
}

// ── Сообщения ─────────────────────────────────────────────────────────────

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const dealUrl = (key: string) => `${config.allowedOrigins[0] ?? ""}${config.basePath}/deals/${key}`;

const HELP =
  "Пришлите текст заявки — письмо, сообщение клиента — или перешлите его сюда. Я заведу лид в воронке «Ирбиса»: найду клиента в базе или создам нового, добавлю контакт и определю тип заявки.";

export function resultText(r: LeadResult, assignee: string): string {
  const lines = [`✅ Лид <b>${esc(r.deal.key)}</b> «${esc(r.deal.title)}»${r.deal.stage ? ` — ${esc(r.deal.stage)}` : ""}`];
  if (r.client) lines.push(`Клиент: <b>${esc(r.client.name)}</b> ${r.client.isNew ? "(новый)" : `(уже в базе, нашёл ${MATCHED_BY[r.client.by!]})`}`);
  else lines.push("Клиент: не понял, кто это, — укажите в карточке");
  if (r.contact) {
    const parts = [r.contact.name, r.contact.phone, r.contact.email].filter(Boolean).map((s) => esc(s!));
    lines.push(`Контакт: ${parts.join(", ")}${r.contact.isNew ? " (новый)" : ""}`);
  }
  lines.push(`Тип: ${esc(REQUEST_TYPES[r.type])}`, `Исполнитель: ${esc(assignee)}`);
  const url = dealUrl(r.deal.key);
  if (/^https?:\/\//.test(url)) lines.push(`<a href="${esc(url)}">Открыть в Ирбисе</a>`);
  return lines.join("\n");
}

const undoData = (r: LeadResult) => `undo:${r.deal.id}:${r.client?.isNew ? r.client.id : 0}:${r.contact?.isNew ? r.contact.id : 0}`;

// ── Обработка обновлений ──────────────────────────────────────────────────

const pending = new Map<number, { texts: string[]; timer: NodeJS.Timeout }>();
const queues = new Map<number, Promise<void>>();

/** Сообщения одного чата — строго по очереди (две заявки подряд не перемешаются). */
function enqueue(chatId: number, job: () => Promise<void>): Promise<void> {
  const next = (queues.get(chatId) ?? Promise.resolve()).then(job, job);
  queues.set(chatId, next);
  void next.finally(() => {
    if (queues.get(chatId) === next) queues.delete(chatId);
  });
  return next;
}

async function send(deps: BotDeps, chatId: number, text: string, extra: Record<string, unknown> = {}) {
  return deps.api("sendMessage", { chat_id: chatId, text, parse_mode: "HTML", link_preview_options: { is_disabled: true }, ...extra });
}

async function processRequest(deps: BotDeps, chatId: number, user: { id: number; name: string }, text: string): Promise<void> {
  if (text.replace(/\s/g, "").length < 15) {
    await send(deps, chatId, "Слишком коротко для заявки. " + HELP);
    return;
  }
  const dup = await findDuplicateLead(db, text);
  if (dup) {
    await send(deps, chatId, `Эта заявка уже в воронке: <b>${esc(dup.key)}</b> «${esc(dup.title)}».`);
    return;
  }
  const parse = deps.parse ?? (async (t: string) => parseLeadRequest(t));
  if (!deps.parse && !aiEnabled()) {
    await send(deps, chatId, "❌ ИИ не подключён (нет ключа в crm/.env) — заявку не разобрать. Заведите лид в Ирбисе вручную.");
    return;
  }
  const wait = await send(deps, chatId, "⏳ Разбираю заявку…").catch(() => null);
  const reply = async (html: string, extra: Record<string, unknown> = {}) => {
    if (wait?.message_id) {
      try {
        await deps.api("editMessageText", { chat_id: chatId, message_id: wait.message_id, text: html, parse_mode: "HTML", link_preview_options: { is_disabled: true }, ...extra });
        return;
      } catch {
        /* не вышло отредактировать — пошлём новым сообщением */
      }
    }
    await send(deps, chatId, html, extra);
  };
  try {
    const { draft, usage } = await parse(text);
    const result = await db.transaction((tx) => createLeadFromDraft(tx, user.id, draft, text, user.name));
    deps.log?.info(JSON.stringify({ ai: "telegram-lead", deal: result.deal.key, usage }));
    await reply(resultText(result, user.name), { reply_markup: { inline_keyboard: [[{ text: "↩️ Отменить", callback_data: undoData(result) }]] } });
  } catch (error) {
    deps.log?.error(error, "Бот заявок: не удалось завести лид");
    await reply(`❌ ${esc(error instanceof HttpError ? error.message : "Не удалось завести лид — попробуйте ещё раз или заведите вручную.")}`);
  }
}

async function handleUndo(deps: BotDeps, query: Json): Promise<void> {
  const answer = (text: string) => deps.api("answerCallbackQuery", { callback_query_id: query.id, text }).catch(() => undefined);
  const user = await userByTelegram(query.from?.id);
  if (!user) return void (await answer("Нет доступа"));
  const m = /^undo:(\d+):(\d+):(\d+)$/.exec(String(query.data ?? ""));
  if (!m) return void (await answer("Неизвестная кнопка"));
  try {
    const done = await db.transaction((tx) =>
      undoLead(tx, user, { dealId: Number(m[1]), clientId: Number(m[2]) || null, contactId: Number(m[3]) || null }),
    );
    await unlinkStoredFiles(done.keys);
    await answer("Отменено");
    const text = `↩️ Отменено: лид ${esc(done.key)} удалён${done.removed.length ? `, удалены ${esc(done.removed.join(", "))}` : ""}.`;
    if (query.message?.message_id) {
      await deps.api("editMessageText", { chat_id: query.message.chat.id, message_id: query.message.message_id, text, parse_mode: "HTML" }).catch(() => undefined);
    }
  } catch (error) {
    await answer(error instanceof HttpError ? error.message : "Не удалось отменить");
  }
}

/** Одно обновление Telegram (сообщение или нажатие кнопки). */
export async function handleUpdate(deps: BotDeps, update: Json): Promise<void> {
  if (update.callback_query) return handleUndo(deps, update.callback_query);
  const msg = update.message;
  if (!msg?.chat || msg.chat.type !== "private" || !msg.from?.id) return;
  const chatId: number = msg.chat.id;
  const text: string = (msg.text ?? msg.caption ?? "").trim();

  const start = /^\/start(?:@\w+)?(?:\s+(\S+))?$/.exec(text);
  const user = await userByTelegram(msg.from.id);
  // Привязка: /start <код> (ссылка из профиля) или просто код сообщением.
  const code = start?.[1] ?? (!user && /^[A-Z0-9]{8}$/i.test(text) ? text : null);
  if (code) {
    const linked = await linkByCode(code, msg.from.id);
    await send(deps, chatId, linked ? `Готово, ${esc(linked.name)}: Telegram привязан к Ирбису.\n\n${HELP}` : "Код не подошёл или устарел. Получите новый в Ирбисе: Профиль → «Привязать Telegram».");
    return;
  }
  if (!user) {
    await send(deps, chatId, "Этот бот — для сотрудников ТЛК БАРС. Привяжите Telegram в Ирбисе: Профиль → «Привязать Telegram».");
    return;
  }
  if (start || /^\/help/.test(text)) {
    await send(deps, chatId, HELP);
    return;
  }
  if (!text) {
    await send(deps, chatId, "Пока понимаю только текст. Пришлите заявку текстом или перешлите сообщение.");
    return;
  }
  // Длинное письмо приходит несколькими сообщениями подряд — склеиваем.
  const mergeMs = deps.mergeMs ?? 0;
  if (mergeMs <= 0) return enqueue(chatId, () => processRequest(deps, chatId, user, text));
  const entry = pending.get(chatId);
  if (entry) clearTimeout(entry.timer);
  const texts = [...(entry?.texts ?? []), text];
  const timer = setTimeout(() => {
    pending.delete(chatId);
    void enqueue(chatId, () => processRequest(deps, chatId, user, texts.join("\n")));
  }, mergeMs);
  pending.set(chatId, { texts, timer });
}

// ── Опрос Telegram ─────────────────────────────────────────────────────────

const OFFSET_KEY = "telegram_offset";

async function loadOffset(): Promise<number> {
  const [row] = await db.select().from(settings).where(eq(settings.key, OFFSET_KEY));
  return Number((row?.value as { offset?: number } | undefined)?.offset ?? 0) || 0;
}

async function saveOffset(offset: number): Promise<void> {
  await db
    .insert(settings)
    .values({ key: OFFSET_KEY, value: { offset } })
    .onConflictDoUpdate({ target: settings.key, set: { value: { offset }, updatedAt: new Date() } });
}

/** Запускает опрос, если задан CRM_TELEGRAM_BOT_TOKEN. Возвращает функцию остановки. */
export function startTelegramBot(log: Log): () => void {
  if (!telegramEnabled()) return () => undefined;
  const api = telegramApi(config.telegram.token!);
  const deps: BotDeps = { api, mergeMs: 2500, log };
  const stop = new AbortController();
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms).unref());

  void (async () => {
    let delay = 5_000;
    while (!stop.signal.aborted) {
      try {
        const me = await api("getMe");
        botUsername = me.username ?? null;
        // Вебхук и опрос несовместимы — на всякий случай снимаем.
        await api("deleteWebhook", { drop_pending_updates: false });
        log.info(`Бот заявок @${botUsername} запущен`);
        break;
      } catch (error) {
        log.error(error, "Бот заявок: Telegram недоступен или неверный токен");
        if ((error as { code?: number }).code === 401) return;
        await sleep(delay);
        delay = Math.min(delay * 2, 5 * 60_000);
      }
    }
    let offset = await loadOffset().catch(() => 0);
    delay = 5_000;
    while (!stop.signal.aborted) {
      try {
        const updates: Json[] = await api(
          "getUpdates",
          { offset, timeout: 50, allowed_updates: ["message", "callback_query"] },
          AbortSignal.any([stop.signal, AbortSignal.timeout(70_000)]),
        );
        for (const update of updates) {
          offset = update.update_id + 1;
          await handleUpdate(deps, update).catch((error) => log.error(error, "Бот заявок: ошибка обработки"));
        }
        if (updates.length) await saveOffset(offset);
        delay = 5_000;
      } catch (error) {
        if (stop.signal.aborted) break;
        const code = (error as { code?: number }).code;
        log.warn(error, code === 409 ? "Бот заявок: этот токен опрашивает кто-то ещё" : "Бот заявок: сбой опроса Telegram");
        await sleep(code === 409 ? 30_000 : delay);
        delay = Math.min(delay * 2, 60_000);
      }
    }
  })();

  return () => stop.abort();
}
