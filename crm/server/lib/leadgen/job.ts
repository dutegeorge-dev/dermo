/**
 * Задача «Собрать базу на месяц» (lead_jobs): этапы collect → filter → schedule → done.
 *
 * - collect: выдача WB по каждому запросу категории, страница за страницей; после каждой страницы курсор
 *   (checkpoint.collect[категория] = {q, page}) пишется в БД — после остановки / падения продолжаем со следующей.
 * - filter: кандидаты категории в случайном порядке (rank) проходят фильтры WB (ИНН, SKU, отзывы, доля Китая) и
 *   DaData; прошедшие копятся в пул (квота × poolFactor), по пулу ищем контакты (WB → Checko → сайт), с контактами —
 *   в lead_sellers. Состояние — в статусе кандидата, поэтому продолжение не повторяет уже проверенных.
 * - schedule: отобранные — по рабочим дням, perDay в день, категории вперемешку (lead_queue).
 *
 * Источники данных (WB, DaData, Checko, сайт, DNS) передаются снаружи (LeadSources) — тесты подменяют их.
 */

import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";

import {
  type CategoryProgress,
  type JobError,
  type JobProgress,
  type LeadgenSettings,
  type ProductSample,
  addDaysIso,
  innKind,
  interleave,
  isoDay,
  monthStart,
  normalizeEmail,
  normalizePhone,
  normalizeSettings,
  normalizeSite,
  planDays,
  renderFirstLine,
  shortProduct,
  shuffle,
  TEMPLATE_MARKING,
  TEMPLATE_PLAIN,
} from "../../../shared/leadgen.ts";
import { db } from "../../db/client.ts";
import { leadCandidates, leadCategories, leadContacts, leadJobs, leadQueue, leadSellers } from "../../db/schema.ts";
import { FetchError } from "./http.ts";
import type { RawContacts, Requisites } from "./registry.ts";
import { checkEmail } from "./site.ts";
import { isChina, type WbProduct, type WbSellerInfo } from "./wb.ts";

export interface LeadSources {
  search(query: string, page: number): Promise<WbProduct[]>;
  sellerInfo(supplierId: number): Promise<WbSellerInfo | null>;
  sellerCatalog(supplierId: number, page: number): Promise<{ products: WbProduct[]; total: number | null }>;
  sellerFeedbacks(supplierId: number): Promise<number | null>;
  /** Страна производства; null — не указана; undefined — карточки нет. */
  cardCountry(nm: number): Promise<string | null | undefined>;
  productUrl(nm: number): string;
  dadata(inn: string): Promise<Requisites | null>;
  /** null — ключа Checko нет, шаг пропускается. */
  checko: ((inn: string, kind: "ul" | "ip") => Promise<RawContacts>) | null;
  site(url: string): Promise<RawContacts>;
  mx(domain: string): Promise<boolean | null>;
  /** Сколько запросов сделано (для прогресса). */
  counts(): JobProgress["requests"];
}

export type MakeSources = (settings: LeadgenSettings, stop: () => boolean, log: (msg: string) => void) => LeadSources;

type Job = typeof leadJobs.$inferSelect;
type Category = typeof leadCategories.$inferSelect;
type Candidate = typeof leadCandidates.$inferSelect;

type CandidateInfo = {
  wb?: WbSellerInfo;
  supplierIds?: number[];
  sku?: number;
  feedbacks?: number;
  chinaShare?: number;
  cards?: number;
  catalog?: { nm: number; name: string; brand: string }[];
  /** Каталог продавца, присланный расширением из браузера (до проверки страны). */
  catalogProducts?: WbProduct[];
  requisites?: Requisites;
  contacts?: { type: "phone" | "email" | "site"; value: string; source: "wb" | "checko" | "site"; valid: boolean; note: string | null; at: string }[];
  why?: string;
};

class Stopped extends Error {}

/** Отсев: короткая причина (для счётчиков) и подробность. */
class Reject extends Error {
  constructor(
    readonly reason: string,
    readonly why = "",
  ) {
    super(reason);
  }
}

const BAD_EGR_STATUS = new Set(["LIQUIDATING", "LIQUIDATED", "BANKRUPT"]);
const MAX_ERRORS = 200;

const monthsBetween = (from: string, to: string) => {
  const a = new Date(`${from}T00:00:00Z`);
  const b = new Date(`${to}T00:00:00Z`);
  return (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth()) - (b.getUTCDate() < a.getUTCDate() ? 1 : 0);
};

export const hasStopWord = (name: string, stopWords: string[]) => {
  const n = name.toLowerCase();
  return stopWords.some((w) => w.trim() && n.includes(w.trim().toLowerCase()));
};

export async function appendJobError(jobId: number, stage: string, message: string): Promise<void> {
  const entry: JobError = { at: new Date().toISOString(), stage, message: message.slice(0, 1000) };
  await db
    .update(leadJobs)
    .set({ errors: sql`(${leadJobs.errors} || ${JSON.stringify([entry])}::jsonb)` })
    .where(eq(leadJobs.id, jobId));
  // Лог ошибок не растёт бесконечно: оставляем последние MAX_ERRORS.
  await db.execute(sql`update lead_jobs set errors = (select coalesce(jsonb_agg(e order by n), '[]'::jsonb) from jsonb_array_elements(errors) with ordinality as t(e, n) where n > jsonb_array_length(errors) - ${MAX_ERRORS}) where id = ${jobId} and jsonb_array_length(errors) > ${MAX_ERRORS}`);
}

/** Счётчики по категориям — из статусов кандидатов. */
export async function computeProgress(job: Job, cats: Category[], requests: JobProgress["requests"]): Promise<JobProgress> {
  const rows = await db
    .select({ categoryId: leadCandidates.categoryId, status: leadCandidates.status, reason: leadCandidates.reason, n: sql<number>`count(*)::int` })
    .from(leadCandidates)
    .where(eq(leadCandidates.jobId, job.id))
    .groupBy(leadCandidates.categoryId, leadCandidates.status, leadCandidates.reason);
  const cp = (job.checkpoint.collect ?? {}) as Record<string, { q: number; page: number }>;
  const categories: Record<string, CategoryProgress> = {};
  for (const c of cats) {
    const mine = rows.filter((r) => r.categoryId === c.id);
    const sum = (pred: (r: (typeof mine)[number]) => boolean) => mine.filter(pred).reduce((s, r) => s + r.n, 0);
    const rejected: Record<string, number> = {};
    for (const r of mine) if (r.status === "rejected" || r.status === "no_contacts") rejected[r.reason ?? "—"] = (rejected[r.reason ?? "—"] ?? 0) + r.n;
    categories[c.id] = {
      name: c.name,
      quota: job.params.quotas[c.id] ?? c.quota,
      queriesDone: Math.min(c.queries.length, cp[c.id]?.q ?? 0),
      queriesTotal: c.queries.length,
      collected: sum(() => true),
      checked: sum((r) => r.status !== "new"),
      passed: sum((r) => ["pool", "selected", "no_contacts"].includes(r.status)),
      withContacts: sum((r) => r.status === "selected"),
      selected: sum((r) => r.status === "selected"),
      waiting: sum((r) => r.status === "need_seller" || r.status === "seller_done"),
      rejected,
    };
  }
  return { ...job.progress, categories, requests };
}

export type RunOptions = { log?: (msg: string) => void; rnd?: () => number; today?: string };

/** Выполнить (или продолжить) задачу. Возвращает итоговый статус. */
export async function runJob(jobId: number, makeSources: MakeSources, opts: RunOptions = {}): Promise<string> {
  const log = opts.log ?? (() => {});
  const rnd = opts.rnd ?? Math.random;
  const today = opts.today ?? isoDay(new Date());

  const [claimed] = await db
    .update(leadJobs)
    .set({ status: "running", startedAt: sql`coalesce(${leadJobs.startedAt}, now())`, finishedAt: null, heartbeatAt: new Date(), updatedAt: new Date() })
    .where(and(eq(leadJobs.id, jobId), inArray(leadJobs.status, ["queued", "running", "failed"])))
    .returning();
  if (!claimed) return "skipped";
  let job: Job = claimed;
  const settings = normalizeSettings(job.params.settings);
  const baseRequests = { ...{ wb: 0, dadata: 0, checko: 0, site: 0 }, ...(job.progress.requests ?? {}) };

  const stop = { flag: false };
  let sources: LeadSources | null = null;
  const requests = () => {
    if (!sources) return baseRequests;
    const c = sources.counts();
    return { wb: baseRequests.wb + c.wb, dadata: baseRequests.dadata + c.dadata, checko: baseRequests.checko + c.checko, site: baseRequests.site + c.site };
  };

  const cats = (await db.select().from(leadCategories).where(inArray(leadCategories.id, job.params.categoryIds.length ? job.params.categoryIds : [0]))).sort(
    (a, b) => job.params.categoryIds.indexOf(a.id) - job.params.categoryIds.indexOf(b.id),
  );

  // Раз в 2 с: остановили ли задачу, отметка «жив», прогресс.
  let lastProgress = 0;
  const save = async (patch: Partial<typeof leadJobs.$inferInsert> = {}, force = false) => {
    const set: Partial<typeof leadJobs.$inferInsert> = { ...patch, heartbeatAt: new Date(), updatedAt: new Date() };
    if (force || Date.now() - lastProgress > 2000) {
      lastProgress = Date.now();
      const snapshot = { ...job, ...patch } as Job;
      set.progress = await computeProgress(snapshot, cats, requests());
    }
    const [row] = await db.update(leadJobs).set(set).where(eq(leadJobs.id, job.id)).returning();
    if (row) job = row;
    if (row?.status === "stopping") stop.flag = true;
  };
  const timer = setInterval(() => {
    db.select({ status: leadJobs.status })
      .from(leadJobs)
      .where(eq(leadJobs.id, job.id))
      .then(([r]) => {
        if (r?.status === "stopping") stop.flag = true;
      })
      .catch(() => {});
  }, 2000);
  timer.unref();
  const checkStop = () => {
    if (stop.flag) throw new Stopped();
  };

  try {
    sources = makeSources(settings, () => stop.flag, log);
    if (!cats.length) throw new Error("Нет категорий для сбора — включите хотя бы одну");
    const browser = job.params.source === "browser";
    if (job.stage === "collect") {
      if (browser) {
        // Выдачу WB присылает расширение в браузере (collector.ts) — ждём его.
        await save({ status: "collecting" }, true);
        log(`Лидогенерация: задача ${job.id} ждёт сборщик в браузере (выдача WB)`);
        return "collecting";
      }
      await collect(job, cats, settings, sources, save, checkStop, log);
      await save({ stage: "filter" }, true);
    }
    if (job.stage === "filter") {
      let waiting = false;
      for (const cat of cats) if ((await filterCategory(job, cat, settings, sources, save, checkStop, rnd, log, today)) === "wait") waiting = true;
      if (waiting) {
        await save({ status: "collecting" }, true);
        log(`Лидогенерация: задача ${job.id} ждёт сборщик в браузере (страницы продавцов)`);
        return "collecting";
      }
      await save({ stage: "schedule" }, true);
    }
    if (job.stage === "schedule") {
      const scheduled = await schedule(job, cats, settings, rnd, today);
      await save({ stage: "done", progress: { ...job.progress, scheduled } }, true);
    }
    await save({ status: "done", finishedAt: new Date() }, true);
    log(`Лидогенерация: задача ${job.id} (${job.month}) готова`);
    return "done";
  } catch (error) {
    if (error instanceof Stopped || (stop.flag && error instanceof FetchError)) {
      await save({ status: "paused" }, true);
      log(`Лидогенерация: задача ${job.id} остановлена на этапе ${job.stage}`);
      return "paused";
    }
    const message = error instanceof Error ? error.message : String(error);
    const transient = error instanceof FetchError && error.transient;
    await appendJobError(job.id, job.stage, message);
    const retries = Number(job.checkpoint.autoRetries ?? 0);
    // Временный сбой (сеть, 429/5xx, лимит DaData) — воркер сам продолжит позже, до 6 раз подряд.
    const checkpoint = transient && retries < 6 ? { ...job.checkpoint, autoRetries: retries + 1, retryAt: new Date(Date.now() + (/DaData/.test(message) ? 6 * 3600_000 : 15 * 60_000)).toISOString() } : { ...job.checkpoint, retryAt: null };
    await save({ status: "failed", checkpoint }, true);
    log(`Лидогенерация: задача ${job.id} — ошибка: ${message}`);
    return "failed";
  } finally {
    clearInterval(timer);
  }
}

type Save = (patch?: Partial<typeof leadJobs.$inferInsert>, force?: boolean) => Promise<void>;

// ── Шаг 1. Продавцы из выдачи WB ─────────────────────────────────────────────

async function collect(job: Job, cats: Category[], s: LeadgenSettings, src: LeadSources, save: Save, checkStop: () => void, log: (m: string) => void) {
  const cp = { ...((job.checkpoint.collect ?? {}) as Record<string, { q: number; page: number }>) };
  for (const cat of cats) {
    const start = cp[cat.id] ?? { q: 0, page: 1 };
    for (let q = start.q; q < cat.queries.length; q++) {
      for (let page = q === start.q ? start.page : 1; page <= s.searchPages; page++) {
        checkStop();
        let products: WbProduct[];
        try {
          products = await src.search(cat.queries[q], page);
        } catch (error) {
          if (error instanceof FetchError && !error.transient && page === 1) {
            // Первая страница не отдаётся — сломан адрес / версия или не российский IP: дальше смысла нет.
            throw new Error(`Поиск WB не отвечает (${error.message}). Проверьте: npm run leadgen:check; адреса — server/lib/leadgen/wb-endpoints.json; не российский IP — WB_PROXY`);
          }
          if (error instanceof FetchError && !error.transient) {
            // Дальняя страница не отдалась (WB часто отвечает 4xx на глубокие страницы) — следующий запрос.
            await appendJobError(job.id, "collect", `${cat.name} / «${cat.queries[q]}», стр. ${page}: ${error.message}`);
            break;
          }
          throw error;
        }
        if (!products.length) break;
        await upsertCandidates(job.id, cat.id, products.filter((p) => p.supplierId > 0 && !hasStopWord(p.name, cat.stopWords)));
        cp[cat.id] = { q, page: page + 1 };
        await save({ checkpoint: { ...job.checkpoint, collect: cp, autoRetries: 0 } });
      }
      cp[cat.id] = { q: q + 1, page: 1 };
      await save({ checkpoint: { ...job.checkpoint, collect: cp } }, true);
      log(`Лидогенерация: ${cat.name} — запрос «${cat.queries[q]}» пройден`);
    }
  }
}

export async function upsertCandidates(jobId: number, categoryId: number, products: WbProduct[]) {
  const bySupplier = new Map<number, WbProduct[]>();
  for (const p of products) bySupplier.set(p.supplierId, [...(bySupplier.get(p.supplierId) ?? []), p]);
  if (!bySupplier.size) return;
  const existing = await db
    .select({ supplierId: leadCandidates.supplierId, products: leadCandidates.products })
    .from(leadCandidates)
    .where(and(eq(leadCandidates.jobId, jobId), eq(leadCandidates.categoryId, categoryId), inArray(leadCandidates.supplierId, [...bySupplier.keys()])));
  const old = new Map(existing.map((e) => [e.supplierId, e.products]));
  const values = [...bySupplier].map(([supplierId, list]) => {
    const merged = [...(old.get(supplierId) ?? [])];
    for (const p of list) if (!merged.some((m) => m.nm === p.nm) && merged.length < 50) merged.push({ nm: p.nm, name: p.name, brand: p.brand, feedbacks: p.feedbacks });
    return { jobId, categoryId, supplierId, products: merged };
  });
  await db
    .insert(leadCandidates)
    .values(values)
    .onConflictDoUpdate({ target: [leadCandidates.jobId, leadCandidates.categoryId, leadCandidates.supplierId], set: { products: sql`excluded.products`, updatedAt: new Date() } });
}

// ── Шаги 2–4. Фильтры, реквизиты, контакты ───────────────────────────────────

/** Продавец «в работе» после первых фильтров: в пуле, ждёт страницу продавца, отобран и т.п. — для склейки по ИНН. */
const ALIVE = ["pool", "selected", "no_contacts", "need_seller", "seller_done"];

/** Категория: "wait" — нужны страницы продавцов от расширения в браузере (задача ждёт сборщик). */
async function filterCategory(job: Job, cat: Category, s: LeadgenSettings, src: LeadSources, save: Save, checkStop: () => void, rnd: () => number, log: (m: string) => void, today: string): Promise<"done" | "wait"> {
  const browser = job.params.source === "browser";
  const quota = job.params.quotas[cat.id] ?? cat.quota;
  const countBy = async () => {
    const rows = await db
      .select({ status: leadCandidates.status, n: sql<number>`count(*)::int` })
      .from(leadCandidates)
      .where(and(eq(leadCandidates.jobId, job.id), eq(leadCandidates.categoryId, cat.id)))
      .groupBy(leadCandidates.status);
    return Object.fromEntries(rows.map((r) => [r.status, r.n])) as Record<string, number>;
  };
  const next = async (status: string) =>
    (
      await db
        .select()
        .from(leadCandidates)
        .where(and(eq(leadCandidates.jobId, job.id), eq(leadCandidates.categoryId, cat.id), eq(leadCandidates.status, status)))
        .orderBy(asc(leadCandidates.rank), asc(leadCandidates.id))
        .limit(1)
    )[0];

  for (;;) {
    checkStop();
    const counts = await countBy();
    const selected = counts.selected ?? 0;
    if (selected >= quota) return "done";
    const pooled = await next("pool");
    if (pooled) {
      await step(job, pooled, "contacts", () => contactsStep(job, cat, pooled, src, rnd));
      await save();
      continue;
    }
    const sellerDone = await next("seller_done");
    if (sellerDone) {
      const info = sellerDone.info as CandidateInfo;
      await step(job, sellerDone, "filter", () => catalogStep(sellerDone, s, src, rnd, info.catalogProducts ?? [], info.sku ?? null));
      await save();
      continue;
    }
    if ((counts.need_seller ?? 0) > 0) return "wait";
    // Пул пуст — набираем новый с запасом: (сколько осталось) × poolFactor прошедших фильтры.
    const need = Math.ceil((quota - selected) * s.poolFactor);
    let passed = 0;
    let any = false;
    while (passed < need) {
      checkStop();
      const cand = await next("new");
      if (!cand) break;
      any = true;
      const ok = await step(job, cand, "filter", async () => {
        if (!(await sellerStep(job, cand, s, src, today))) return false;
        if (browser) {
          // Каталог продавца (SKU и товары для страны) откроет расширение в браузере.
          await db.update(leadCandidates).set({ status: "need_seller", updatedAt: new Date() }).where(eq(leadCandidates.id, cand.id));
          return true;
        }
        const catalog = await fetchCatalog(cand.supplierId, s, src);
        return catalogStep(cand, s, src, rnd, catalog.products, catalog.sku);
      });
      if (ok) passed++;
      await save();
    }
    if (!any) {
      if (selected < quota) {
        const msg = `${cat.name}: отобрано ${selected} из ${quota} — продавцы в выдаче кончились (добавьте поисковых запросов или снизьте пороги)`;
        await appendJobError(job.id, "filter", msg);
        log(`Лидогенерация: ${msg}`);
      }
      return "done";
    }
  }
}

/** Шаг по кандидату: отсев → rejected с причиной; разовая ошибка по продавцу — rejected «ошибка», не роняет задачу. */
async function step(job: Job, cand: Candidate, stage: string, fn: () => Promise<boolean>): Promise<boolean> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof Stopped) throw error;
    if (error instanceof Reject) {
      await rejectCandidate(cand.id, error.reason, error.why);
      return false;
    }
    if (error instanceof FetchError && error.transient) throw error;
    const message = error instanceof Error ? error.message : String(error);
    await appendJobError(job.id, stage, `продавец WB ${cand.supplierId}: ${message}`);
    await rejectCandidate(cand.id, "ошибка", message.slice(0, 300));
    return false;
  }
}

export async function rejectCandidate(id: number, reason: string, why = ""): Promise<void> {
  await db
    .update(leadCandidates)
    .set({ status: "rejected", reason, info: sql`${leadCandidates.info} || ${JSON.stringify({ why: why || reason })}::jsonb`, updatedAt: new Date() })
    .where(eq(leadCandidates.id, id));
}

/** Фильтры по профилю продавца: российский ИНН, не в базе, не дубль ИНН, отзывы, DaData. */
async function sellerStep(job: Job, cand: Candidate, s: LeadgenSettings, src: LeadSources, today: string): Promise<boolean> {
  const sid = cand.supplierId;
  const wb = await src.sellerInfo(sid);
  if (!wb) throw new Reject("нет профиля на WB");
  const kind = innKind(wb.inn);
  await db.update(leadCandidates).set({ inn: wb.inn || null, info: { wb, supplierIds: [sid] } }).where(eq(leadCandidates.id, cand.id));
  if (!kind) throw new Reject("нет российского ИНН", wb.inn ? `ИНН «${wb.inn}»` : "ИНН не указан");
  const inn = wb.inn;

  // Уже в базе прошлых выгрузок или «Не писать».
  const [known] = await db.select({ status: leadSellers.status, jobId: leadSellers.jobId, month: leadSellers.batchMonth }).from(leadSellers).where(eq(leadSellers.inn, inn));
  if (known && known.jobId !== job.id) throw new Reject(known.status === "do_not_contact" ? "не писать" : "уже в базе", `выгрузка ${known.month}`);

  // Тот же ИНН (другой кабинет WB) уже прошёл в этой задаче — склеиваем в одну запись.
  const [twin] = await db
    .select()
    .from(leadCandidates)
    .where(and(eq(leadCandidates.jobId, job.id), eq(leadCandidates.inn, inn), ne(leadCandidates.id, cand.id), inArray(leadCandidates.status, ALIVE)))
    .limit(1);
  if (twin) {
    await mergeTwin(twin, cand, sid);
    throw new Reject("дубль ИНН", `второй кабинет продавца WB ${twin.supplierId}`);
  }

  // Отзывы о продавце (рейтинг продавца WB); нет ответа — посчитаем по товарам каталога на следующем шаге.
  const feedbacks = await src.sellerFeedbacks(sid);
  if (feedbacks !== null && (feedbacks < s.feedbacksMin || feedbacks > s.feedbacksMax)) throw new Reject("отзывы вне порога", `отзывов ${feedbacks}`);

  // Реквизиты по ИНН — DaData.
  const requisites = await src.dadata(inn);
  if (!requisites) throw new Reject("нет в ЕГРЮЛ / ЕГРИП", "DaData не нашла ИНН");
  if (BAD_EGR_STATUS.has(requisites.status)) throw new Reject("ликвидация / банкротство", requisites.status);
  if (!requisites.regDate) throw new Reject("нет даты регистрации");
  if (monthsBetween(requisites.regDate, today) < s.minAgeMonths) throw new Reject(`моложе ${s.minAgeMonths} мес.`, `зарегистрирован ${requisites.regDate}`);

  const info: CandidateInfo = { wb, supplierIds: [sid], ...(feedbacks !== null ? { feedbacks } : {}), requisites };
  await db.update(leadCandidates).set({ inn, info, updatedAt: new Date() }).where(eq(leadCandidates.id, cand.id));
  return true;
}

/** Каталог продавца с сервера (API WB): SKU и товары для выборки по стране. */
async function fetchCatalog(sid: number, s: LeadgenSettings, src: LeadSources): Promise<{ sku: number | null; products: WbProduct[] }> {
  const first = await src.sellerCatalog(sid, 1);
  const products = [...first.products];
  if (first.total !== null) return { sku: first.total, products };
  // Эндпоинт без total — считаем страницами (до skuMax + 1).
  for (let page = 2; first.products.length && products.length <= s.skuMax && page <= 30; page++) {
    const more = await src.sellerCatalog(sid, page);
    if (!more.products.length) break;
    products.push(...more.products);
  }
  return { sku: products.length, products };
}

/** SKU, отзывы (если рейтинг не ответил) и доля «Китай» по карточкам → в пул. sku null — неизвестно (порог не проверяется). */
async function catalogStep(cand: Candidate, s: LeadgenSettings, src: LeadSources, rnd: () => number, catalog: WbProduct[], sku: number | null): Promise<boolean> {
  const [fresh] = await db.select().from(leadCandidates).where(eq(leadCandidates.id, cand.id));
  const info = (fresh?.info ?? cand.info) as CandidateInfo;
  if (sku !== null && (sku < s.skuMin || sku > s.skuMax)) throw new Reject("SKU вне порога", `SKU ${sku}`);
  let feedbacks = info.feedbacks ?? null;
  if (feedbacks === null) {
    feedbacks = catalog.reduce((sum, p) => sum + p.feedbacks, 0);
    if (feedbacks < s.feedbacksMin || feedbacks > s.feedbacksMax) throw new Reject("отзывы вне порога", `отзывов ${feedbacks} (по товарам каталога)`);
  }

  // Страна производства по выборке карточек.
  const nms = shuffle([...new Set([...catalog.map((p) => p.nm), ...cand.products.map((p) => p.nm)])], rnd).slice(0, s.cardsSample);
  let withCountry = 0;
  let china = 0;
  for (const nm of nms) {
    const country = await src.cardCountry(nm);
    if (!country) continue;
    withCountry++;
    if (isChina(country)) china++;
  }
  if (withCountry < Math.min(s.minCountryCards, nms.length) || withCountry === 0) throw new Reject("мало данных о стране", `страна указана в ${withCountry} из ${nms.length} карточек`);
  const chinaShare = china / withCountry;
  if (chinaShare < s.chinaShareMin) throw new Reject(`Китай < ${Math.round(s.chinaShareMin * 100)} %`, `Китай ${Math.round(chinaShare * 100)} % (${china} из ${withCountry})`);

  const next: CandidateInfo = {
    ...info,
    sku: sku ?? undefined,
    feedbacks,
    chinaShare,
    cards: withCountry,
    catalog: catalog.slice(0, 30).map((p) => ({ nm: p.nm, name: p.name, brand: p.brand })),
    catalogProducts: undefined,
  };
  await db.update(leadCandidates).set({ status: "pool", reason: null, info: next, updatedAt: new Date() }).where(eq(leadCandidates.id, cand.id));
  return true;
}

/** Второй кабинет того же ИНН: его id и товары — к уже прошедшему кандидату (и в lead_sellers, если уже отобран). */
async function mergeTwin(twin: Candidate, cand: Candidate, sid: number) {
  const info = twin.info as CandidateInfo;
  const supplierIds = [...new Set([...(info.supplierIds ?? [twin.supplierId]), sid])];
  const products = [...twin.products];
  for (const p of cand.products) if (!products.some((m) => m.nm === p.nm) && products.length < 50) products.push(p);
  await db
    .update(leadCandidates)
    .set({ info: { ...info, supplierIds }, products, updatedAt: new Date() })
    .where(eq(leadCandidates.id, twin.id));
  if (twin.status === "selected" && twin.inn) {
    const brands = [...new Set(cand.products.map((p) => p.brand).filter(Boolean))];
    await db
      .update(leadSellers)
      .set({
        wbSupplierIds: supplierIds,
        brands: sql`(select array(select distinct unnest(${leadSellers.brands} || ${brands}::text[])))`,
        updatedAt: new Date(),
      })
      .where(eq(leadSellers.inn, twin.inn));
  }
}

type Found = { type: "phone" | "email" | "site"; value: string; source: "wb" | "checko" | "site" };

function normalizeAll(raw: RawContacts, source: Found["source"]): Found[] {
  const out: Found[] = [];
  for (const p of raw.phones) {
    const v = normalizePhone(p);
    if (v) out.push({ type: "phone", value: v, source });
  }
  for (const e of raw.emails) {
    const v = normalizeEmail(e);
    if (v) out.push({ type: "email", value: v, source });
  }
  for (const w of raw.sites) {
    const v = normalizeSite(w);
    if (v) out.push({ type: "site", value: v, source });
  }
  return out;
}

async function contactsStep(job: Job, cat: Category, cand: Candidate, src: LeadSources, rnd: () => number): Promise<boolean> {
  const info = cand.info as CandidateInfo;
  const inn = cand.inn!;
  const wb = info.wb!;
  const req = info.requisites!;
  const found: Found[] = normalizeAll({ phones: wb.phones, emails: wb.emails, sites: [] }, "wb");
  if (src.checko) found.push(...normalizeAll(await src.checko(inn, req.kind), "checko"));
  const hasEmail = () => found.some((f) => f.type === "email");
  if (!hasEmail()) {
    for (const site of found.filter((f) => f.type === "site").slice(0, 2)) {
      found.push(...normalizeAll(await src.site(site.value), "site"));
      if (hasEmail()) break;
    }
  }
  // Дубли — первый источник важнее (WB → Checko → сайт).
  const unique: Found[] = [];
  for (const f of found) if (!unique.some((u) => u.type === f.type && u.value === f.value)) unique.push(f);
  const at = new Date().toISOString();
  const contacts: NonNullable<CandidateInfo["contacts"]> = [];
  for (const f of unique) {
    const check = f.type === "email" ? await checkEmail(f.value, (d) => src.mx(d)) : { valid: true, note: null };
    contacts.push({ ...f, ...check, at });
  }
  const usable = contacts.some((c) => c.type === "phone" || (c.type === "email" && c.valid));
  if (!usable) {
    await db
      .update(leadCandidates)
      .set({ status: "no_contacts", reason: "нет контактов", info: { ...info, contacts }, updatedAt: new Date() })
      .where(eq(leadCandidates.id, cand.id));
    return false;
  }

  // Отбор: запись в базу продавцов.
  const brandCount = new Map<string, number>();
  for (const p of cand.products) if (p.brand) brandCount.set(p.brand, (brandCount.get(p.brand) ?? 0) + 1);
  const brands = [...brandCount].sort((a, b) => b[1] - a[1]).map(([b]) => b);
  if (wb.trademark && !brands.some((b) => b.toLowerCase() === wb.trademark.toLowerCase())) brands.push(wb.trademark);
  const mainBrand = brands[0] ?? wb.trademark ?? "";
  // Примеры — товары из выдачи по запросам категории (они про категорию), сначала с главным брендом.
  // Мало попаданий в выдачу — добираем из каталога продавца (без стоп-слов категории).
  const extra = (info.catalog ?? []).filter((p) => p.name && !hasStopWord(p.name, cat.stopWords) && !cand.products.some((m) => m.nm === p.nm));
  const pick = [
    ...shuffle(cand.products, rnd).sort((a, b) => Number(b.brand === mainBrand) - Number(a.brand === mainBrand)),
    ...shuffle(extra, rnd),
  ];
  const products: ProductSample[] = pick.slice(0, 3).map((p) => ({ nm: p.nm, name: p.name, url: src.productUrl(p.nm) }));
  const product = shortProduct(pick[0]?.name ?? "", mainBrand);
  const firstLine = renderFirstLine(cat.template || (cat.marking ? TEMPLATE_MARKING : TEMPLATE_PLAIN), { brand: mainBrand, product });

  await db.transaction(async (tx) => {
    const values = {
      inn,
      wbSupplierIds: info.supplierIds ?? [cand.supplierId],
      brands: brands.slice(0, 10),
      legalName: req.legalName || wb.fullName || wb.name,
      ogrn: req.ogrn ?? (wb.ogrn || null),
      kind: req.kind,
      managerName: req.managerName,
      managerPost: req.managerPost,
      regDate: req.regDate,
      okved: req.okved,
      region: req.region,
      address: req.address ?? (wb.address || null),
      egrStatus: req.status,
      skuCount: info.sku ?? null,
      feedbacksTotal: info.feedbacks ?? null,
      chinaShare: info.chinaShare ?? null,
      products,
      categoryId: cat.id,
      batchMonth: job.month,
      jobId: job.id,
      firstLine,
    };
    await tx.insert(leadSellers).values(values).onConflictDoUpdate({ target: leadSellers.inn, set: { ...values, updatedAt: new Date() }, where: eq(leadSellers.jobId, job.id) });
    await tx
      .insert(leadContacts)
      .values(contacts.map((c) => ({ sellerInn: inn, type: c.type, value: c.value, source: c.source, valid: c.valid, note: c.note, receivedAt: new Date(c.at) })))
      .onConflictDoNothing();
    await tx.update(leadCandidates).set({ status: "selected", reason: null, info: { ...info, contacts }, updatedAt: new Date() }).where(eq(leadCandidates.id, cand.id));
  });
  return true;
}

// ── Шаг 5. Раскладка по рабочим дням ─────────────────────────────────────────

async function schedule(job: Job, cats: Category[], s: LeadgenSettings, rnd: () => number, today: string): Promise<JobProgress["scheduled"]> {
  const rows = await db
    .select({ inn: leadSellers.inn, categoryId: leadSellers.categoryId })
    .from(leadSellers)
    .where(and(eq(leadSellers.jobId, job.id), sql`not exists (select 1 from lead_queue q where q.seller_inn = ${leadSellers.inn})`));
  if (!rows.length) return job.progress.scheduled ?? { sellers: 0, from: "", to: "" };
  const groups = cats.map((c) => shuffle(rows.filter((r) => r.categoryId === c.id).map((r) => r.inn), rnd));
  const order = interleave(groups);
  // Продолжаем после уже разложенных этой задачей (если раскладку прерывали), иначе — с начала месяца / сегодня.
  const [last] = await db
    .select({ day: sql<string | null>`max(${leadQueue.plannedDate})::text` })
    .from(leadQueue)
    .innerJoin(leadSellers, eq(leadSellers.inn, leadQueue.sellerInn))
    .where(and(eq(leadSellers.jobId, job.id), eq(leadQueue.touch, "first")));
  const begin = [monthStart(job.month) ?? today, today, last?.day ? addDaysIso(last.day, 1) : ""].sort().at(-1)!;
  const days = planDays(order.length, begin, s);
  const values = order.map((inn, i) => ({ sellerInn: inn, plannedDate: days[i], position: i % s.perDay, touch: "first" }));
  for (let i = 0; i < values.length; i += 500) await db.insert(leadQueue).values(values.slice(i, i + 500));
  return { sellers: (job.progress.scheduled?.sellers ?? 0) + order.length, from: job.progress.scheduled?.from || days[0], to: days.at(-1)! };
}
