/**
 * Задачи лидогенерации (lead_jobs). Два вида (params.kind):
 *
 * collect — «Собрать базу на месяц»: этапы collect → enrich → done.
 * - collect: выдача WB по запросам категорий (с сервера — страницами, курсор checkpoint.collect; в режиме браузера
 *   выдачу присылает расширение, collector.ts) → кандидаты (lead_candidates), товары со стоп-словами отброшены.
 * - enrich: каждый кандидат — профиль WB (ИНН, юрназвание, email из профиля), отзывы о продавце, DaData → в базу
 *   (lead_sellers) **без отсева**: фильтрует потом сам владелец в «Базе». Не попадают только продавцы без российского
 *   ИНН. Уже известные ИНН (другая категория, второй кабинет, прошлые сборы) склеиваются. Состояние — в статусе
 *   кандидата, продолжение не повторяет проверенных.
 *
 * pick — «Отобрать в работу»: этапы pick → schedule → done. Из базы по фильтру (params.filter) — случайно, N на
 * категорию (params.quotas), по каждому контакты Checko / сайт (платные — только здесь, решение владельца) и проверка
 * email; нет телефона и рабочего email — пометка «нет контактов», берётся следующий. Взятые в работу —
 * по рабочим дням, perDay в день, категории вперемешку (lead_queue).
 *
 * Источники данных (WB, DaData, Checko, сайт, DNS) передаются снаружи (LeadSources) — тесты подменяют их.
 */

import { and, asc, eq, inArray, sql } from "drizzle-orm";

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
import type { WbProduct, WbSellerInfo } from "./wb.ts";
import { filterWhere, parseSellerFilter } from "./work.ts";
import { isStopped, notStoppedInn } from "../mail/stoplist.ts";

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
type Seller = typeof leadSellers.$inferSelect;

class Stopped extends Error {}

const MAX_ERRORS = 200;
/** Кандидат сбора обработан: в базе, склеен с известным ИНН, без российского ИНН, ошибка. */
const DONE_STATUSES = ["in_base", "merged", "no_inn", "error"];

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

/** Счётчики по категориям: у сбора — из статусов кандидатов, у отбора — из отметок продавцов этой задачи. */
export async function computeProgress(job: Job, cats: Category[], requests: JobProgress["requests"]): Promise<JobProgress> {
  const categories: Record<string, CategoryProgress> = {};
  if (job.params.kind === "pick") {
    const rows = await db
      .select({
        categoryId: leadSellers.categoryId,
        checked: sql<number>`count(*) filter (where ${leadSellers.contactsJobId} = ${job.id})::int`,
        none: sql<number>`count(*) filter (where ${leadSellers.contactsJobId} = ${job.id} and ${leadSellers.contactsStatus} = 'none')::int`,
        picked: sql<number>`count(*) filter (where ${leadSellers.pickJobId} = ${job.id})::int`,
      })
      .from(leadSellers)
      .where(sql`${leadSellers.contactsJobId} = ${job.id} or ${leadSellers.pickJobId} = ${job.id}`)
      .groupBy(leadSellers.categoryId);
    for (const c of cats) {
      const r = rows.find((x) => x.categoryId === c.id);
      categories[c.id] = {
        name: c.name,
        quota: job.params.quotas[c.id] ?? 0,
        queriesDone: 0,
        queriesTotal: 0,
        collected: 0,
        checked: r?.checked ?? 0,
        passed: 0,
        withContacts: r?.picked ?? 0,
        selected: r?.picked ?? 0,
        rejected: r?.none ? { "нет контактов": r.none } : {},
      };
    }
    return { ...job.progress, categories, requests };
  }
  const rows = await db
    .select({ categoryId: leadCandidates.categoryId, status: leadCandidates.status, reason: leadCandidates.reason, n: sql<number>`count(*)::int` })
    .from(leadCandidates)
    .where(eq(leadCandidates.jobId, job.id))
    .groupBy(leadCandidates.categoryId, leadCandidates.status, leadCandidates.reason);
  const cp = (job.checkpoint.collect ?? {}) as Record<string, { q: number; page: number }>;
  for (const c of cats) {
    const mine = rows.filter((r) => r.categoryId === c.id);
    const sum = (pred: (r: (typeof mine)[number]) => boolean) => mine.filter(pred).reduce((s, r) => s + r.n, 0);
    const rejected: Record<string, number> = {};
    for (const r of mine) if (r.status === "merged" || r.status === "no_inn" || r.status === "error") rejected[r.reason ?? "—"] = (rejected[r.reason ?? "—"] ?? 0) + r.n;
    categories[c.id] = {
      name: c.name,
      quota: 0,
      queriesDone: Math.min(c.queries.length, cp[c.id]?.q ?? 0),
      queriesTotal: c.queries.length,
      collected: sum(() => true),
      checked: sum((r) => DONE_STATUSES.includes(r.status)),
      passed: sum((r) => r.status === "in_base"),
      withContacts: 0,
      selected: 0,
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
    if (!cats.length) throw new Error("Нет категорий — включите хотя бы одну");
    if (job.params.kind === "pick") {
      if (job.stage === "pick") {
        await pickAll(job, cats, sources, save, checkStop, log, today);
        await save({ stage: "schedule" }, true);
      }
      if (job.stage === "schedule") {
        const scheduled = await schedule(job, cats, settings, rnd, today);
        await save({ stage: "done", progress: { ...job.progress, scheduled } }, true);
      }
    } else {
      if (job.stage === "collect") {
        if (job.params.source === "browser") {
          // Выдачу WB присылает расширение в браузере (collector.ts) — ждём его.
          await save({ status: "collecting" }, true);
          log(`Лидогенерация: задача ${job.id} ждёт сборщик в браузере (выдача WB)`);
          return "collecting";
        }
        await collect(job, cats, settings, sources, save, checkStop, log);
        await save({ stage: "enrich" }, true);
      }
      // filter — этап сборов, начатых до «сначала собрать всё»: продолжаются как enrich.
      if (job.stage === "enrich" || job.stage === "filter") {
        await enrichAll(job, cats, sources, save, checkStop, rnd);
        await save({ stage: "done" }, true);
      }
    }
    await save({ status: "done", finishedAt: new Date() }, true);
    log(`Лидогенерация: задача ${job.id} готова`);
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
    // Временный сбой (сеть, 429/5xx, лимит DaData, баланс Checko) — воркер сам продолжит позже, до 6 раз подряд.
    const checkpoint = transient && retries < 6 ? { ...job.checkpoint, autoRetries: retries + 1, retryAt: new Date(Date.now() + (/DaData/.test(message) ? 6 * 3600_000 : 15 * 60_000)).toISOString() } : { ...job.checkpoint, retryAt: null };
    await save({ status: "failed", checkpoint }, true);
    log(`Лидогенерация: задача ${job.id} — ошибка: ${message}`);
    return "failed";
  } finally {
    clearInterval(timer);
  }
}

type Save = (patch?: Partial<typeof leadJobs.$inferInsert>, force?: boolean) => Promise<void>;

// ── Сбор: выдача WB с сервера ────────────────────────────────────────────────

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

// ── Сбор: реквизиты каждого продавца — в базу без отсева ─────────────────────

async function enrichAll(job: Job, cats: Category[], src: LeadSources, save: Save, checkStop: () => void, rnd: () => number) {
  for (const cat of cats) {
    for (;;) {
      checkStop();
      const [cand] = await db
        .select()
        .from(leadCandidates)
        .where(and(eq(leadCandidates.jobId, job.id), eq(leadCandidates.categoryId, cat.id), sql`${leadCandidates.status} not in ('in_base', 'merged', 'no_inn', 'error')`))
        .orderBy(asc(leadCandidates.id))
        .limit(1);
      if (!cand) break;
      try {
        await enrichOne(job, cat, cand, src, rnd);
      } catch (error) {
        if (error instanceof FetchError && error.transient) throw error;
        const message = error instanceof Error ? error.message : String(error);
        await appendJobError(job.id, "enrich", `продавец WB ${cand.supplierId}: ${message}`);
        await markCandidate(cand.id, "error", "ошибка", message.slice(0, 300));
      }
      await save();
    }
  }
}

async function markCandidate(id: number, status: string, reason: string | null, why?: string, patch: Partial<typeof leadCandidates.$inferInsert> = {}) {
  await db
    .update(leadCandidates)
    .set({ ...patch, status, reason, ...(why ? { info: sql`${leadCandidates.info} || ${JSON.stringify({ why })}::jsonb` } : {}), updatedAt: new Date() })
    .where(eq(leadCandidates.id, id));
}

/** Бренды кандидата: по частоте в выдаче, торговая марка из профиля WB — в конце. */
function brandsOf(products: Candidate["products"], trademark: string): string[] {
  const count = new Map<string, number>();
  for (const p of products) if (p.brand) count.set(p.brand, (count.get(p.brand) ?? 0) + 1);
  const brands = [...count].sort((a, b) => b[1] - a[1]).map(([b]) => b);
  if (trademark && !brands.some((b) => b.toLowerCase() === trademark.toLowerCase())) brands.push(trademark);
  return brands.slice(0, 10);
}

async function enrichOne(job: Job, cat: Category, cand: Candidate, src: LeadSources, rnd: () => number) {
  const sid = cand.supplierId;
  const wb = await src.sellerInfo(sid);
  if (!wb) return markCandidate(cand.id, "error", "нет профиля на WB");
  const kind = innKind(wb.inn);
  if (!kind) return markCandidate(cand.id, "no_inn", "нет российского ИНН", wb.inn ? `ИНН «${wb.inn}»` : "ИНН не указан", { inn: wb.inn || null, info: { wb } });
  const inn = wb.inn;
  const brands = brandsOf(cand.products, wb.trademark);

  const [known] = await db.select().from(leadSellers).where(eq(leadSellers.inn, inn));
  if (known) {
    // Тот же ИНН: другая категория / второй кабинет в этом сборе или продавец из прошлых сборов — одна запись.
    const sameJob = known.jobId === job.id;
    const feedbacks = sameJob ? null : await src.sellerFeedbacks(sid);
    await db
      .update(leadSellers)
      .set({
        wbSupplierIds: [...new Set([...known.wbSupplierIds, sid])],
        brands: [...new Set([...known.brands, ...brands])].slice(0, 10),
        ...(feedbacks !== null ? { feedbacksTotal: feedbacks } : {}),
        updatedAt: new Date(),
      })
      .where(eq(leadSellers.inn, inn));
    return markCandidate(cand.id, "merged", sameJob ? "дубль: другая категория или кабинет" : "уже в базе с прошлых сборов", undefined, { inn });
  }

  const feedbacks = await src.sellerFeedbacks(sid);
  const req = await src.dadata(inn);
  const mainBrand = brands[0] ?? "";
  // Примеры — товары из выдачи по запросам категории, сначала с главным брендом.
  const pick = shuffle(cand.products, rnd).sort((a, b) => Number(b.brand === mainBrand) - Number(a.brand === mainBrand));
  const products: ProductSample[] = pick.slice(0, 3).map((p) => ({ nm: p.nm, name: p.name, url: src.productUrl(p.nm) }));
  const firstLine = renderFirstLine(cat.template || (cat.marking ? TEMPLATE_MARKING : TEMPLATE_PLAIN), { brand: mainBrand, product: shortProduct(pick[0]?.name ?? "", mainBrand) });
  // Email / телефон из профиля WB — бесплатно, сразу (Checko — только при отборе в работу).
  const wbContacts = await checkContacts(normalizeAll({ phones: wb.phones, emails: wb.emails, sites: [] }, "wb"), src);

  await db.transaction(async (tx) => {
    await tx
      .insert(leadSellers)
      .values({
        inn,
        wbSupplierIds: [sid],
        brands,
        legalName: req?.legalName || wb.fullName || wb.name,
        ogrn: req?.ogrn ?? (wb.ogrn || null),
        kind: req?.kind ?? kind,
        managerName: req?.managerName ?? null,
        managerPost: req?.managerPost ?? null,
        regDate: req?.regDate ?? null,
        okved: req?.okved ?? null,
        region: req?.region ?? null,
        address: req?.address ?? (wb.address || null),
        egrStatus: req?.status ?? "NOT_FOUND",
        feedbacksTotal: feedbacks,
        // В стоп-листе рассылки (отказался раньше) — сразу «Не писать».
        status: (await isStopped(db, inn)) ? "do_not_contact" : "new",
        products,
        categoryId: cat.id,
        batchMonth: job.month,
        jobId: job.id,
        firstLine,
      })
      .onConflictDoNothing();
    if (wbContacts.length) await tx.insert(leadContacts).values(wbContacts.map((c) => ({ sellerInn: inn, ...c }))).onConflictDoNothing();
    await tx.update(leadCandidates).set({ status: "in_base", reason: null, inn, updatedAt: new Date() }).where(eq(leadCandidates.id, cand.id));
  });
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


/** Дубли — первый источник важнее; email — синтаксис и MX. */
async function checkContacts(found: Found[], src: LeadSources, known: { type: string; value: string }[] = []) {
  const unique: Found[] = [];
  for (const f of found) if (!known.some((k) => k.type === f.type && k.value === f.value) && !unique.some((u) => u.type === f.type && u.value === f.value)) unique.push(f);
  const out: { type: string; value: string; source: string; valid: boolean; note: string | null; receivedAt: Date }[] = [];
  for (const f of unique) {
    const check = f.type === "email" ? await checkEmail(f.value, (d) => src.mx(d)) : { valid: true, note: null };
    out.push({ ...f, ...check, receivedAt: new Date() });
  }
  return out;
}

// ── Отбор в работу: контакты Checko / сайт → в работу ────────────────────────

async function pickAll(job: Job, cats: Category[], src: LeadSources, save: Save, checkStop: () => void, log: (m: string) => void, today: string) {
  const filter = parseSellerFilter(job.params.filter ?? {});
  for (const cat of cats) {
    const quota = job.params.quotas[cat.id] ?? 0;
    for (;;) {
      checkStop();
      const [{ picked }] = await db
        .select({ picked: sql<number>`count(*)::int` })
        .from(leadSellers)
        .where(and(eq(leadSellers.pickJobId, job.id), eq(leadSellers.categoryId, cat.id)));
      if (picked >= quota) break;
      // Случайно, но воспроизводимо (продолжение после остановки идёт тем же порядком).
      const [seller] = await db
        .select()
        .from(leadSellers)
        .where(
          and(
            filterWhere({ ...filter, categoryId: cat.id, inWork: false }, today),
            sql`${leadSellers.status} <> 'do_not_contact'`,
            sql`${leadSellers.contactsStatus} is distinct from 'none'`,
            sql`${leadSellers.contactsJobId} is distinct from ${job.id}`,
            notStoppedInn(leadSellers.inn),
          ),
        )
        .orderBy(sql`md5(${leadSellers.inn} || ${String(job.id)})`)
        .limit(1);
      if (!seller) {
        const msg = `${cat.name}: в работу взято ${picked} из ${quota} — в базе по этому фильтру больше нет подходящих продавцов`;
        await appendJobError(job.id, "pick", msg);
        log(`Лидогенерация: ${msg}`);
        break;
      }
      try {
        await pickOne(job, seller, src);
      } catch (error) {
        if (error instanceof FetchError && error.transient) throw error;
        const message = error instanceof Error ? error.message : String(error);
        await appendJobError(job.id, "pick", `ИНН ${seller.inn}: ${message}`);
        // Не повторяем в этой задаче; в следующих отборах продавец снова доступен.
        await db.update(leadSellers).set({ contactsJobId: job.id, updatedAt: new Date() }).where(eq(leadSellers.inn, seller.inn));
      }
      await save();
    }
  }
}

async function pickOne(job: Job, seller: Seller, src: LeadSources) {
  const known = await db.select().from(leadContacts).where(eq(leadContacts.sellerInn, seller.inn));
  const found: Found[] = [];
  if (src.checko) found.push(...normalizeAll(await src.checko(seller.inn, seller.kind === "ip" ? "ip" : "ul"), "checko"));
  const hasEmail = () => known.some((k) => k.type === "email" && k.valid) || found.some((f) => f.type === "email");
  if (!hasEmail()) {
    const sites = [...new Set([...known.filter((k) => k.type === "site").map((k) => k.value), ...found.filter((f) => f.type === "site").map((f) => f.value)])];
    for (const site of sites.slice(0, 2)) {
      found.push(...normalizeAll(await src.site(site), "site"));
      if (hasEmail()) break;
    }
  }
  const fresh = await checkContacts(found, src, known);
  const all = [...known, ...fresh];
  const usable = all.some((c) => c.type === "phone" || (c.type === "email" && c.valid));
  await db.transaction(async (tx) => {
    if (fresh.length) await tx.insert(leadContacts).values(fresh.map((c) => ({ sellerInn: seller.inn, ...c }))).onConflictDoNothing();
    await tx
      .update(leadSellers)
      .set({
        contactsStatus: usable ? "found" : "none",
        contactsJobId: job.id,
        contactsCheckedAt: new Date(),
        ...(usable ? { pickedAt: new Date(), pickJobId: job.id } : {}),
        updatedAt: new Date(),
      })
      .where(eq(leadSellers.inn, seller.inn));
  });
}

// ── Раскладка по рабочим дням ────────────────────────────────────────────────

async function schedule(job: Job, cats: Category[], s: LeadgenSettings, rnd: () => number, today: string): Promise<JobProgress["scheduled"]> {
  const rows = await db
    .select({ inn: leadSellers.inn, categoryId: leadSellers.categoryId })
    .from(leadSellers)
    .where(and(eq(leadSellers.pickJobId, job.id), sql`not exists (select 1 from lead_queue q where q.seller_inn = ${leadSellers.inn})`));
  if (!rows.length) return job.progress.scheduled ?? { sellers: 0, from: "", to: "" };
  const groups = cats.map((c) => shuffle(rows.filter((r) => r.categoryId === c.id).map((r) => r.inn), rnd));
  const order = interleave(groups);
  // После уже запланированных первых писем (прошлые отборы), не раньше сегодняшнего дня.
  const [last] = await db
    .select({ day: sql<string | null>`max(${leadQueue.plannedDate})::text` })
    .from(leadQueue)
    .where(and(eq(leadQueue.touch, "first"), eq(leadQueue.status, "planned")));
  const begin = last?.day && last.day >= today ? addDaysIso(last.day, 1) : today;
  const days = planDays(order.length, begin, s);
  const values = order.map((inn, i) => ({ sellerInn: inn, plannedDate: days[i], position: i % s.perDay, touch: "first" }));
  for (let i = 0; i < values.length; i += 500) await db.insert(leadQueue).values(values.slice(i, i + 500));
  return { sellers: (job.progress.scheduled?.sellers ?? 0) + order.length, from: job.progress.scheduled?.from || days[0], to: days.at(-1)! };
}
