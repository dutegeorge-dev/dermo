/**
 * Раздел «Лидогенерация»: категории, задачи сбора (запуск / остановка / продолжение), база продавцов, «Сегодня»,
 * статусы, «Итоги», экспорт. Доступ — админ или сотрудник с правом leadgen.
 */

import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";

import { isoDay, JOB_STATUSES, LEADGEN_PERMISSION, SELLER_STATUSES, type SellerStatus } from "../../shared/leadgen.ts";
import { config } from "../config.ts";
import { db } from "../db/client.ts";
import { leadCategories, leadJobs, leadSellers, settings as settingsTable } from "../db/schema.ts";
import { audit } from "../lib/audit.ts";
import { body, HttpError, intParam, requirePermission } from "../lib/http.ts";
import { STALE_MS, WORKER_KEY } from "../lib/leadgen/worker.ts";
import {
  exportSellers,
  getLeadgenSettings,
  getSeller,
  listSellers,
  parseSellerFilter,
  setLeadgenSettings,
  setSellerStatus,
  stats,
  toCsv,
  todayList,
  toXlsx,
} from "../lib/leadgen/work.ts";

const guard = (request: FastifyRequest) => requirePermission(request, LEADGEN_PERMISSION);

const words = (v: unknown, max = 60): string[] => {
  const list = Array.isArray(v) ? v : typeof v === "string" ? v.split(/[\n;]/) : [];
  return [...new Set(list.map((x) => String(x).trim()).filter(Boolean))].slice(0, max).map((x) => x.slice(0, 200));
};

type CategoryInput = { name: string; queries: string[] | string; stopWords: string[] | string; marking: boolean; markingNote: string; quota: number; template: string; active: boolean; sort: number };

function categoryValues(input: Partial<CategoryInput>, partial: boolean): Partial<typeof leadCategories.$inferInsert> {
  const out: Partial<typeof leadCategories.$inferInsert> = {};
  if (input.name !== undefined || !partial) {
    const name = String(input.name ?? "").trim().slice(0, 200);
    if (!name) throw new HttpError(400, "Укажите название категории");
    out.name = name;
  }
  if (input.queries !== undefined) out.queries = words(input.queries);
  if (input.stopWords !== undefined) out.stopWords = words(input.stopWords, 100);
  if (input.marking !== undefined) out.marking = Boolean(input.marking);
  if (input.markingNote !== undefined) out.markingNote = String(input.markingNote ?? "").trim().slice(0, 300);
  if (input.quota !== undefined) {
    const q = Number(input.quota);
    if (!Number.isInteger(q) || q < 1 || q > 5000) throw new HttpError(400, "Квота — целое число от 1 до 5000");
    out.quota = q;
  }
  if (input.template !== undefined) out.template = String(input.template ?? "").trim().slice(0, 2000);
  if (input.active !== undefined) out.active = Boolean(input.active);
  if (input.sort !== undefined && Number.isInteger(Number(input.sort))) out.sort = Number(input.sort);
  return out;
}

const ACTIVE_JOB = ["queued", "running", "stopping"];

async function jobDto(id?: number) {
  const rows = await db
    .select()
    .from(leadJobs)
    .where(id ? eq(leadJobs.id, id) : undefined)
    .orderBy(desc(leadJobs.id))
    .limit(id ? 1 : 12);
  return rows.map((j) => ({
    id: j.id,
    month: j.month,
    status: j.status,
    stage: j.stage,
    progress: j.progress,
    quotas: j.params.quotas,
    categoryIds: j.params.categoryIds,
    errors: j.errors.slice(-50),
    retryAt: (j.checkpoint.retryAt as string | null) ?? null,
    startedAt: j.startedAt,
    finishedAt: j.finishedAt,
    heartbeatAt: j.heartbeatAt,
    createdAt: j.createdAt,
  }));
}

export async function leadgenRoutes(app: FastifyInstance): Promise<void> {
  // ── Готовность: ключи и воркер ──
  app.get("/leadgen/status", async (request) => {
    guard(request);
    const [worker] = await db.select().from(settingsTable).where(eq(settingsTable.key, WORKER_KEY));
    const at = (worker?.value as { at?: string } | undefined)?.at;
    return {
      dadata: Boolean(config.leadgen.dadataToken),
      checko: Boolean(config.leadgen.checkoKey),
      proxy: Boolean(config.leadgen.wbProxy),
      worker: { at: at ?? null, alive: Boolean(at && Date.now() - Date.parse(at) < STALE_MS), state: (worker?.value as { state?: string } | undefined)?.state ?? null },
      settings: await getLeadgenSettings(db),
      months: (await db.selectDistinct({ m: leadSellers.batchMonth }).from(leadSellers).orderBy(desc(leadSellers.batchMonth))).map((r) => r.m),
      today: isoDay(new Date()),
    };
  });

  app.put("/leadgen/settings", async (request) => {
    const user = guard(request);
    const next = await setLeadgenSettings(db, request.body, user.id);
    await audit(db, { userId: user.id, action: "update", entityType: "leadgen", entityId: null, summary: "Лидогенерация: изменил пороги и настройки", data: next, ip: request.ip });
    return { settings: next };
  });

  // ── Категории ──
  app.get("/leadgen/categories", async (request) => {
    guard(request);
    const rows = await db.select().from(leadCategories).orderBy(asc(leadCategories.sort), asc(leadCategories.id));
    const counts = await db
      .select({ id: leadSellers.categoryId, n: sql<number>`count(*)::int` })
      .from(leadSellers)
      .groupBy(leadSellers.categoryId);
    return { categories: rows.map((c) => ({ ...c, sellers: counts.find((x) => x.id === c.id)?.n ?? 0 })) };
  });

  app.post("/leadgen/categories", async (request) => {
    const user = guard(request);
    const input = body<CategoryInput>(request);
    const s = await getLeadgenSettings(db);
    const values = { quota: s.defaultQuota, ...categoryValues(input, false) } as typeof leadCategories.$inferInsert;
    const [{ max }] = await db.select({ max: sql<number>`coalesce(max(${leadCategories.sort}), 0)::int` }).from(leadCategories);
    const [row] = await db.insert(leadCategories).values({ sort: max + 1, ...values }).returning();
    await audit(db, { userId: user.id, action: "create", entityType: "lead_category", entityId: row.id, summary: `Лидогенерация: категория «${row.name}»`, ip: request.ip });
    return { category: row };
  });

  app.patch("/leadgen/categories/:id", async (request) => {
    const user = guard(request);
    const id = intParam((request.params as { id: string }).id);
    const values = categoryValues(body<CategoryInput>(request), true);
    const [row] = await db.update(leadCategories).set({ ...values, updatedAt: new Date() }).where(eq(leadCategories.id, id)).returning();
    if (!row) throw new HttpError(404, "Категория не найдена");
    await audit(db, { userId: user.id, action: "update", entityType: "lead_category", entityId: id, summary: `Лидогенерация: изменил категорию «${row.name}»`, ip: request.ip });
    return { category: row };
  });

  app.delete("/leadgen/categories/:id", async (request) => {
    const user = guard(request);
    const id = intParam((request.params as { id: string }).id);
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(leadSellers).where(eq(leadSellers.categoryId, id));
    if (n > 0) throw new HttpError(409, "В категории уже есть продавцы — выключите её вместо удаления");
    const active = await db.select({ id: leadJobs.id }).from(leadJobs).where(and(inArray(leadJobs.status, [...ACTIVE_JOB, "paused", "failed"]), sql`${leadJobs.params}->'categoryIds' @> ${JSON.stringify([id])}::jsonb`));
    if (active.length) throw new HttpError(409, "Категория участвует в незавершённом сборе");
    const [row] = await db.delete(leadCategories).where(eq(leadCategories.id, id)).returning();
    if (!row) throw new HttpError(404, "Категория не найдена");
    await audit(db, { userId: user.id, action: "delete", entityType: "lead_category", entityId: id, summary: `Лидогенерация: удалил категорию «${row.name}»`, ip: request.ip });
    return { ok: true };
  });

  // ── Сбор базы ──
  app.get("/leadgen/jobs", async (request) => {
    guard(request);
    return { jobs: await jobDto() };
  });

  /** «Собрать базу на месяц»: month (YYYY-MM), необязательно quota — одна квота на все категории (тестовый прогон). */
  app.post("/leadgen/jobs", async (request) => {
    const user = guard(request);
    const input = body<{ month: string; quota: number | null; categoryIds: number[] }>(request);
    const month = String(input.month ?? "");
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new HttpError(400, "Укажите месяц");
    if (!config.leadgen.dadataToken) throw new HttpError(400, "Не задан DADATA_TOKEN в crm/.env — без реквизитов DaData сбор невозможен");
    const unfinished = await db.select({ id: leadJobs.id, status: leadJobs.status }).from(leadJobs).where(inArray(leadJobs.status, [...ACTIVE_JOB, "paused", "failed"]));
    if (unfinished.length) throw new HttpError(409, `Есть незавершённый сбор № ${unfinished[0].id} (${JOB_STATUSES[unfinished[0].status as keyof typeof JOB_STATUSES] ?? unfinished[0].status}) — продолжите или отмените его`);
    let cats = await db.select().from(leadCategories).where(eq(leadCategories.active, true)).orderBy(asc(leadCategories.sort), asc(leadCategories.id));
    const only = Array.isArray(input.categoryIds) ? input.categoryIds.map(Number) : [];
    if (only.length) cats = cats.filter((c) => only.includes(c.id));
    cats = cats.filter((c) => c.queries.length);
    if (!cats.length) throw new HttpError(400, "Нет активных категорий с поисковыми запросами");
    const quota = input.quota === null || input.quota === undefined || (input.quota as unknown) === "" ? null : Number(input.quota);
    if (quota !== null && (!Number.isInteger(quota) || quota < 1 || quota > 5000)) throw new HttpError(400, "Квота — целое число от 1 до 5000");
    const settings = await getLeadgenSettings(db);
    const [job] = await db
      .insert(leadJobs)
      .values({
        month,
        params: { categoryIds: cats.map((c) => c.id), quotas: Object.fromEntries(cats.map((c) => [c.id, quota ?? c.quota])), settings },
        progress: { categories: {}, requests: { wb: 0, dadata: 0, checko: 0, site: 0 } },
        createdBy: user.id,
      })
      .returning();
    await audit(db, { userId: user.id, action: "create", entityType: "lead_job", entityId: job.id, summary: `Лидогенерация: запустил сбор базы на ${month}${quota ? ` (квота ${quota})` : ""}`, ip: request.ip });
    return { job: (await jobDto(job.id))[0] };
  });

  app.post("/leadgen/jobs/:id/stop", async (request) => {
    const user = guard(request);
    const id = intParam((request.params as { id: string }).id);
    const [job] = await db.select().from(leadJobs).where(eq(leadJobs.id, id));
    if (!job) throw new HttpError(404, "Задача не найдена");
    const next = job.status === "running" ? "stopping" : job.status === "queued" || job.status === "failed" ? "paused" : null;
    if (!next) throw new HttpError(409, "Задача не идёт");
    await db
      .update(leadJobs)
      .set({ status: next, checkpoint: { ...job.checkpoint, retryAt: null }, updatedAt: new Date() })
      .where(eq(leadJobs.id, id));
    await audit(db, { userId: user.id, action: "update", entityType: "lead_job", entityId: id, summary: `Лидогенерация: остановил сбор № ${id}`, ip: request.ip });
    return { job: (await jobDto(id))[0] };
  });

  app.post("/leadgen/jobs/:id/resume", async (request) => {
    const user = guard(request);
    const id = intParam((request.params as { id: string }).id);
    const [job] = await db.select().from(leadJobs).where(eq(leadJobs.id, id));
    if (!job) throw new HttpError(404, "Задача не найдена");
    if (!["paused", "failed"].includes(job.status)) throw new HttpError(409, "Продолжить можно только остановленную задачу");
    await db
      .update(leadJobs)
      .set({ status: "queued", checkpoint: { ...job.checkpoint, retryAt: null, autoRetries: 0 }, updatedAt: new Date() })
      .where(eq(leadJobs.id, id));
    await audit(db, { userId: user.id, action: "update", entityType: "lead_job", entityId: id, summary: `Лидогенерация: продолжил сбор № ${id}`, ip: request.ip });
    return { job: (await jobDto(id))[0] };
  });

  /** Отменить незавершённый сбор: уже отобранные продавцы остаются в базе и раскладываются по дням. */
  app.post("/leadgen/jobs/:id/cancel", async (request) => {
    const user = guard(request);
    const id = intParam((request.params as { id: string }).id);
    const [job] = await db.select().from(leadJobs).where(eq(leadJobs.id, id));
    if (!job) throw new HttpError(404, "Задача не найдена");
    if (!["paused", "failed"].includes(job.status)) throw new HttpError(409, "Сначала остановите задачу");
    await db
      .update(leadJobs)
      .set({ status: "queued", stage: "schedule", checkpoint: { ...job.checkpoint, retryAt: null, cancelled: true }, updatedAt: new Date() })
      .where(eq(leadJobs.id, id));
    await audit(db, { userId: user.id, action: "update", entityType: "lead_job", entityId: id, summary: `Лидогенерация: завершил сбор № ${id} досрочно`, ip: request.ip });
    return { job: (await jobDto(id))[0] };
  });

  // ── База ──
  app.get("/leadgen/sellers", async (request) => {
    guard(request);
    const query = request.query as Record<string, unknown>;
    const limit = Math.min(500, Math.max(1, Number(query.limit) || 100));
    const offset = Math.max(0, Number(query.offset) || 0);
    return listSellers(db, parseSellerFilter(query), limit, offset);
  });

  app.get("/leadgen/sellers/:inn", async (request) => {
    guard(request);
    return getSeller(db, String((request.params as { inn: string }).inn));
  });

  app.patch("/leadgen/sellers/:inn", async (request) => {
    guard(request);
    const inn = String((request.params as { inn: string }).inn);
    const input = body<{ firstLine: string }>(request);
    if (typeof input.firstLine !== "string") throw new HttpError(400, "Нечего менять");
    const [row] = await db.update(leadSellers).set({ firstLine: input.firstLine.trim().slice(0, 2000), updatedAt: new Date() }).where(eq(leadSellers.inn, inn)).returning({ inn: leadSellers.inn });
    if (!row) throw new HttpError(404, "Продавец не найден");
    return { ok: true };
  });

  app.post("/leadgen/sellers/:inn/status", async (request) => {
    const user = guard(request);
    const inn = String((request.params as { inn: string }).inn);
    const input = body<{ status: SellerStatus; comment: string }>(request);
    if (!input.status || !(input.status in SELLER_STATUSES)) throw new HttpError(400, "Неизвестный статус");
    const s = await getLeadgenSettings(db);
    await db.transaction((tx) => setSellerStatus(tx, inn, input.status!, user.id, typeof input.comment === "string" ? input.comment : null, s));
    return getSeller(db, inn);
  });

  // ── Сегодня, итоги, экспорт ──
  app.get("/leadgen/today", async (request) => {
    guard(request);
    const q = request.query as { day?: string };
    const day = typeof q.day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(q.day) ? q.day : isoDay(new Date());
    return todayList(db, day, await getLeadgenSettings(db));
  });

  app.get("/leadgen/stats", async (request) => {
    guard(request);
    const q = request.query as { month?: string };
    const month = typeof q.month === "string" && /^\d{4}-\d{2}$/.test(q.month) ? q.month : undefined;
    return { rows: await stats(db, month) };
  });

  app.get("/leadgen/export.:format", async (request, reply) => {
    const user = guard(request);
    const format = (request.params as { format: string }).format;
    if (format !== "csv" && format !== "xlsx") throw new HttpError(404, "Не найдено");
    const filter = parseSellerFilter(request.query as Record<string, unknown>);
    const data = await exportSellers(db, filter);
    await audit(db, { userId: user.id, action: "export", entityType: "leadgen", entityId: null, summary: `Лидогенерация: выгрузил базу (${format.toUpperCase()}, ${data.rows.length} продавцов)`, ip: request.ip });
    const name = `leadgen_${filter.month ?? "all"}_${isoDay(new Date())}.${format}`;
    reply.header("content-disposition", `attachment; filename="${name}"`);
    if (format === "csv") return reply.type("text/csv; charset=utf-8").send(toCsv(data.header, data.rows));
    const buf = await toXlsx([
      { name: "Продавцы", header: data.header, rows: data.rows },
      { name: "Контакты", header: data.contactHeader, rows: data.contactRows },
    ]);
    return reply.type("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet").send(buf);
  });
}
