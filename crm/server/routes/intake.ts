/**
 * Импорт заявок без входа в систему: POST /intake/leads с заголовком «Authorization: Bearer <CRM_INTAKE_TOKEN>».
 * Принимает уже разобранные заявки (поля как у бота заявок — LeadDraft + исходный текст) и заводит лиды тем же
 * кодом, что и бот: клиент и контакт ищутся / создаются, тип — меткой, дубли за 7 дней пропускаются.
 * Нужен, когда ИИ-шлюз лежит: заявки разбирает внешний помощник и вносит их сюда. Без токена в .env — 404.
 * dryRun: true — всё то же в транзакции с откатом: видно, кого нашли бы, ничего не создаётся.
 */

import { and, asc, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";

import { config } from "../config.ts";
import { db } from "../db/client.ts";
import { users } from "../db/schema.ts";
import { body, HttpError } from "../lib/http.ts";
import { safeEqual } from "../lib/session.ts";
import { createLeadFromDraft, findDuplicateLead, leadDraft, type LeadResult } from "../lib/telegram-leads.ts";

type Item = Record<string, unknown> & { text?: unknown; stage?: unknown };

class Rollback extends Error {}

export async function intakeRoutes(app: FastifyInstance): Promise<void> {
  app.post("/intake/leads", async (request) => {
    const token = config.intakeToken;
    if (!token) throw new HttpError(404, "Не найдено");
    const auth = String(request.headers.authorization ?? "");
    const given = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
    if (!given || !safeEqual(given, token)) throw new HttpError(401, "Неверный токен импорта");

    const input = body<{ assignee?: unknown; dryRun?: unknown; leads?: unknown }>(request);
    const items = Array.isArray(input.leads) ? (input.leads as Item[]) : [];
    if (!items.length || items.length > 50) throw new HttpError(400, "leads: от 1 до 50 заявок");
    const dryRun = input.dryRun === true;

    // Исполнитель — сотрудник по логину, иначе первый админ.
    const login = typeof input.assignee === "string" ? input.assignee.trim().toLowerCase() : "";
    const [user] = login
      ? await db.select({ id: users.id, name: users.name }).from(users).where(and(eq(users.login, login), eq(users.isActive, true)))
      : await db.select({ id: users.id, name: users.name }).from(users).where(and(eq(users.role, "admin"), eq(users.isActive, true))).orderBy(asc(users.id)).limit(1);
    if (!user) throw new HttpError(400, login ? `Сотрудник «${login}» не найден или отключён` : "Нет активного админа");

    const results: ({ index: number } & ({ status: "created" | "would_create"; lead: LeadResult } | { status: "duplicate"; key: string; title: string } | { status: "error"; error: string }))[] = [];
    for (const [index, item] of items.entries()) {
      const text = typeof item.text === "string" ? item.text.replace(/\r\n/g, "\n").trim() : "";
      if (text.replace(/\s/g, "").length < 15) {
        results.push({ index, status: "error", error: "text: пустой или слишком короткий текст заявки" });
        continue;
      }
      const dup = await findDuplicateLead(db, text);
      if (dup) {
        results.push({ index, status: "duplicate", ...dup });
        continue;
      }
      const draft = leadDraft(item);
      const origin = { source: "intake" as const, by: user.name, statusKey: typeof item.stage === "string" ? item.stage : undefined };
      try {
        let lead: LeadResult | null = null;
        await db
          .transaction(async (tx) => {
            lead = await createLeadFromDraft(tx, user.id, draft, text, origin);
            if (dryRun) throw new Rollback();
          })
          .catch((error) => {
            if (!(error instanceof Rollback)) throw error;
          });
        results.push({ index, status: dryRun ? "would_create" : "created", lead: lead! });
      } catch (error) {
        request.log.error(error, "Импорт заявок: не удалось завести лид");
        results.push({ index, status: "error", error: error instanceof HttpError ? error.message : "внутренняя ошибка" });
      }
    }
    request.log.info(JSON.stringify({ intake: dryRun ? "dry-run" : "leads", count: items.length, created: results.filter((r) => r.status === "created").length }));
    return { dryRun, assignee: user.name, results };
  });
}
