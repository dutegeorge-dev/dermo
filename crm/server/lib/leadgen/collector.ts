/**
 * Сборщик в браузере: расширение Chrome (crm/tools/wb-extension) на компьютере сотрудника открывает страницы WB в его
 * обычном браузере и присылает сюда то, что браузер получил от WB. Сервер говорит, что открыть дальше:
 *  - этап collect — страницы выдачи по запросам категорий (курсор checkpoint.collect, как у сбора с сервера);
 *    реквизиты продавцов (профиль WB, отзывы, DaData) сервер берёт сам — страницы продавцов не открываются.
 * Задача в это время в статусе collecting; когда всё нужное прислано — снова queued, дальше работает воркер.
 * Доступ — по ключу сборщика (Authorization: Bearer), ключ выпускается на вкладке «Сбор», в БД — только SHA-256.
 */

import crypto from "node:crypto";

import { and, asc, eq, inArray } from "drizzle-orm";

import { normalizeSettings } from "../../../shared/leadgen.ts";
import { config } from "../../config.ts";
import { db } from "../../db/client.ts";
import { leadCategories, leadJobs, settings as settingsTable } from "../../db/schema.ts";
import { HttpError } from "../http.ts";
import { Http } from "./http.ts";
import { appendJobError, computeProgress, hasStopWord, upsertCandidates } from "./job.ts";
import { parseProducts, WbClient, type WbProduct } from "./wb.ts";

export const COLLECTOR_KEY = "leadgen_collector";

type CollectorState = { hash: string | null; createdAt: string | null; createdBy: number | null; lastSeenAt: string | null; lastTask: string | null };

const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

export async function collectorState(): Promise<CollectorState> {
  const [row] = await db.select().from(settingsTable).where(eq(settingsTable.key, COLLECTOR_KEY));
  return { hash: null, createdAt: null, createdBy: null, lastSeenAt: null, lastTask: null, ...((row?.value as Partial<CollectorState>) ?? {}) };
}

async function saveState(state: CollectorState): Promise<void> {
  await db.insert(settingsTable).values({ key: COLLECTOR_KEY, value: state }).onConflictDoUpdate({ target: settingsTable.key, set: { value: state, updatedAt: new Date() } });
}

/** Новый ключ сборщика (старый перестаёт работать). Показывается один раз. */
export async function issueCollectorToken(userId: number): Promise<string> {
  const token = `irbis_${crypto.randomBytes(24).toString("hex")}`;
  await saveState({ ...(await collectorState()), hash: sha256(token), createdAt: new Date().toISOString(), createdBy: userId });
  return token;
}

export async function checkCollectorToken(header: unknown): Promise<void> {
  const token = typeof header === "string" ? header.replace(/^Bearer\s+/i, "").trim() : "";
  const state = await collectorState();
  const ok = Boolean(token && state.hash) && crypto.timingSafeEqual(Buffer.from(sha256(token)), Buffer.from(state.hash!));
  if (!ok) throw new HttpError(401, "Неверный ключ сборщика — выпустите новый на вкладке «Сбор» и вставьте в расширение");
}

async function touch(lastTask: string): Promise<void> {
  await saveState({ ...(await collectorState()), lastSeenAt: new Date().toISOString(), lastTask });
}

export type CollectorTask =
  | { type: "idle"; message: string }
  | { type: "search"; jobId: number; categoryId: number; q: number; page: number; query: string; url: string; want: number; delay: [number, number] };

/** WB не листает выдачу по ?page=N — одна страница на запрос, расширение прокручивает её до want товаров. */
const searchUrl = (query: string) => `https://www.wildberries.ru/catalog/0/search.aspx?sort=popular&search=${encodeURIComponent(query)}`;

async function collectingJob() {
  const [job] = await db.select().from(leadJobs).where(eq(leadJobs.status, "collecting")).orderBy(asc(leadJobs.id)).limit(1);
  return job ?? null;
}

async function jobCategories(job: typeof leadJobs.$inferSelect) {
  const ids = job.params.categoryIds.length ? job.params.categoryIds : [0];
  return (await db.select().from(leadCategories).where(inArray(leadCategories.id, ids))).sort((a, b) => job.params.categoryIds.indexOf(a.id) - job.params.categoryIds.indexOf(b.id));
}

/** Курсор выдачи: первая категория с непройденными запросами. */
function cursorOf(job: typeof leadJobs.$inferSelect, cats: (typeof leadCategories.$inferSelect)[]) {
  const cp = (job.checkpoint.collect ?? {}) as Record<string, { q: number; page: number }>;
  for (const cat of cats) {
    const c = cp[cat.id] ?? { q: 0, page: 1 };
    if (c.q < cat.queries.length) return { cat, q: c.q, page: c.page };
  }
  return null;
}

/** Задача снова к воркеру (дальше — фильтры / отбор). */
async function handBack(jobId: number, patch: Partial<typeof leadJobs.$inferInsert> = {}): Promise<void> {
  await db
    .update(leadJobs)
    .set({ ...patch, status: "queued", updatedAt: new Date() })
    .where(and(eq(leadJobs.id, jobId), eq(leadJobs.status, "collecting")));
}

export async function nextTask(): Promise<CollectorTask> {
  const job = await collectingJob();
  if (!job) {
    await touch("ожидание");
    return { type: "idle", message: "Сбор не запущен или его этап идёт на сервере — расширение подождёт" };
  }
  const s = normalizeSettings(job.params.settings);
  const delay: [number, number] = [s.browserDelayMin, s.browserDelayMax];
  if (job.stage === "collect") {
    const cur = cursorOf(job, await jobCategories(job));
    if (!cur) {
      await handBack(job.id, { stage: "enrich" });
      await touch("выдача собрана");
      return { type: "idle", message: "Выдача собрана — сервер проверяет продавцов" };
    }
    const query = cur.cat.queries[cur.q];
    await touch(`поиск «${query}»`);
    return { type: "search", jobId: job.id, categoryId: cur.cat.id, q: cur.q, page: cur.page, query, url: searchUrl(query), want: s.browserProducts, delay };
  }
  // Выдача собрана — дальше сервер сам (реквизиты); расширению делать нечего.
  await handBack(job.id);
  await touch("выдача собрана");
  return { type: "idle", message: "Выдача собрана — сервер дополняет продавцов реквизитами" };
}

/** Ответ расширения: data — JSON, который страница получила от WB; items — артикулы со страницы (если JSON не перехватился). */
export type CollectorResult = {
  type: "search" | "seller";
  jobId: number;
  categoryId?: number;
  q?: number;
  page?: number;
  supplierId?: number;
  data?: unknown;
  items?: { nm: number; name?: string; brand?: string }[];
  /** Число товаров продавца, прочитанное со страницы продавца. */
  count?: number;
  blocked?: boolean;
  failed?: string;
};

/** Карточка по артикулу → продавец (для артикулов со страницы). Подменяется в тестах. */
let cardResolver: ((nm: number) => Promise<WbProduct | null>) | null = null;
export function setCardResolver(fn: ((nm: number) => Promise<WbProduct | null>) | null): void {
  cardResolver = fn;
}
function resolver(): (nm: number) => Promise<WbProduct | null> {
  if (!cardResolver) {
    const wb = new WbClient(new Http({ name: "WB", minDelayMs: 50, jitterMs: 50, retries: 2, proxy: config.leadgen.wbProxy }));
    cardResolver = (nm) => wb.cardProduct(nm);
  }
  return cardResolver;
}

async function productsFrom(result: CollectorResult): Promise<{ products: WbProduct[]; total: number | null }> {
  if (result.data !== undefined && result.data !== null) {
    const parsed = parseProducts(result.data);
    if (parsed.products.length || parsed.total !== null) return parsed;
  }
  const items = (result.items ?? []).filter((i) => Number.isSafeInteger(i.nm) && i.nm > 0).slice(0, 1000);
  const products: WbProduct[] = [];
  const resolve = resolver();
  // Только артикулы — продавца берём из карточки (статика WB отдаётся и не из России), по 8 параллельно.
  for (let i = 0; i < items.length; i += 8) {
    const batch = await Promise.all(items.slice(i, i + 8).map((it) => resolve(it.nm).catch(() => null)));
    batch.forEach((p, k) => p && products.push({ ...p, name: p.name || items[i + k].name || "", brand: p.brand || items[i + k].brand || "" }));
  }
  return { products, total: null };
}

export async function applyResult(result: CollectorResult): Promise<{ ok: boolean; message: string }> {
  const job = await collectingJob();
  if (!job || job.id !== Number(result.jobId)) return { ok: false, message: "Задача уже не ждёт этих данных" };

  if (result.blocked) {
    await appendJobError(job.id, job.stage, "WB показал проверку «Подозрительная активность» в браузере — расширение остановилось. Пройдите проверку в браузере и запустите расширение снова");
    await touch("WB попросил проверку");
    return { ok: true, message: "Записал: WB просит проверку" };
  }

  if (result.type === "search") {
    if (job.stage !== "collect") return { ok: false, message: "Выдача уже собрана" };
    const cats = await jobCategories(job);
    const cur = cursorOf(job, cats);
    if (!cur || cur.cat.id !== Number(result.categoryId) || cur.q !== Number(result.q) || cur.page !== Number(result.page)) return { ok: false, message: "Эта страница уже учтена" };
    let products: WbProduct[] = [];
    if (result.failed) {
      await appendJobError(job.id, "collect", `${cur.cat.name} / «${cur.cat.queries[cur.q]}», стр. ${cur.page}: ${result.failed.slice(0, 300)}`);
    } else {
      products = (await productsFrom(result)).products;
      await upsertCandidates(job.id, cur.cat.id, products.filter((p) => p.supplierId > 0 && !hasStopWord(p.name, cur.cat.stopWords)));
    }
    // Запрос пройден целиком за одну прокрученную страницу — дальше следующий.
    const cp = { ...((job.checkpoint.collect ?? {}) as Record<string, { q: number; page: number }>), [cur.cat.id]: { q: cur.q + 1, page: 1 } };
    const checkpoint = { ...job.checkpoint, collect: cp };
    const [updated] = await db.update(leadJobs).set({ checkpoint, heartbeatAt: new Date(), updatedAt: new Date() }).where(eq(leadJobs.id, job.id)).returning();
    await db.update(leadJobs).set({ progress: await computeProgress(updated, cats, job.progress.requests) }).where(eq(leadJobs.id, job.id));
    if (!cursorOf(updated, cats)) await handBack(job.id, { stage: "enrich" });
    return { ok: true, message: `${cur.cat.name}: «${cur.cat.queries[cur.q]}» — товаров ${products.length}` };
  }

  return { ok: false, message: "Страницы продавцов больше не нужны — сервер берёт реквизиты сам" };
}
