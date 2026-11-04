/**
 * Воркер сбора: настоящие источники (WB, DaData, Checko, сайты, DNS) и цикл, который берёт задачи из lead_jobs.
 *
 * Запуск — отдельной службой `bars-crm-leadgen` (`npm run leadgen:worker`), либо внутри bars-crm при
 * CRM_LEADGEN_INLINE=true (разработка). Одновременно работает только один воркер (advisory lock в PostgreSQL).
 * Задача, у которой воркер пропал (перезапуск, падение), подхватывается с места остановки.
 */

import os from "node:os";

import { and, asc, eq, inArray, lt, or, sql } from "drizzle-orm";

import type { LeadgenSettings } from "../../../shared/leadgen.ts";
import { config } from "../../config.ts";
import { db, pool } from "../../db/client.ts";
import { leadJobs, settings as settingsTable } from "../../db/schema.ts";
import { Http } from "./http.ts";
import { type LeadSources, type MakeSources, runJob } from "./job.ts";
import { checkoContacts, dadataParty } from "./registry.ts";
import { domainAcceptsMail, siteContacts } from "./site.ts";
import { WbClient } from "./wb.ts";

export const WORKER_KEY = "leadgen_worker";
const LOCK_ID = 7_342_001;
/** Задача «running», от которой нет отметки дольше этого, — брошена (воркер упал), её можно продолжить. */
export const STALE_MS = 2 * 60_000;

export const realSources: MakeSources = (s: LeadgenSettings, stop, log): LeadSources => {
  const token = config.leadgen.dadataToken;
  if (!token) throw new Error("Не задан DADATA_TOKEN — без реквизитов DaData отбор невозможен (см. crm/.env.example)");
  const wbHttp = new Http({ name: "WB", minDelayMs: s.wbDelayMs, jitterMs: s.wbJitterMs, proxy: config.leadgen.wbProxy, stop, log });
  const dadataHttp = new Http({ name: "DaData", minDelayMs: s.apiDelayMs, jitterMs: 50, stop, log });
  const checkoHttp = new Http({ name: "Checko", minDelayMs: s.apiDelayMs, jitterMs: 50, stop, log });
  const siteHttp = new Http({ name: "Сайт", minDelayMs: 300, jitterMs: 300, retries: 1, timeoutMs: 15_000, stop, log });
  const wb = new WbClient(wbHttp);
  const key = config.leadgen.checkoKey;
  return {
    search: (q, page) => wb.search(q, page),
    sellerInfo: (id) => wb.sellerInfo(id),
    sellerCatalog: (id, page) => wb.sellerCatalog(id, page),
    sellerFeedbacks: (id) => wb.sellerFeedbacks(id),
    cardCountry: (nm) => wb.cardCountry(nm),
    productUrl: (nm) => wb.productUrl(nm),
    dadata: (inn) => dadataParty(dadataHttp, token, inn),
    checko: key ? (inn, kind) => checkoContacts(checkoHttp, key, inn, kind) : null,
    site: (url) => siteContacts(siteHttp, url),
    mx: domainAcceptsMail,
    counts: () => ({ wb: wbHttp.count, dadata: dadataHttp.count, checko: checkoHttp.count, site: siteHttp.count }),
  };
};

/** Следующая задача: в очереди; брошенная упавшим воркером; с ошибкой, у которой подошло время повтора. */
export async function nextJob(): Promise<number | null> {
  const stale = new Date(Date.now() - STALE_MS);
  // Остановку, которую некому было завершить, — завершаем.
  await db.update(leadJobs).set({ status: "paused", updatedAt: new Date() }).where(and(eq(leadJobs.status, "stopping"), lt(leadJobs.heartbeatAt, stale)));
  const [row] = await db
    .select({ id: leadJobs.id })
    .from(leadJobs)
    .where(
      or(
        eq(leadJobs.status, "queued"),
        and(eq(leadJobs.status, "running"), or(lt(leadJobs.heartbeatAt, stale), sql`${leadJobs.heartbeatAt} is null`)),
        and(eq(leadJobs.status, "failed"), sql`(${leadJobs.checkpoint}->>'retryAt')::timestamptz <= now()`),
      ),
    )
    .orderBy(asc(leadJobs.id))
    .limit(1);
  return row?.id ?? null;
}

export async function workerHeartbeat(state: string): Promise<void> {
  const value = { at: new Date().toISOString(), host: os.hostname(), pid: process.pid, state };
  await db.insert(settingsTable).values({ key: WORKER_KEY, value }).onConflictDoUpdate({ target: settingsTable.key, set: { value, updatedAt: new Date() } });
}

type Logger = { info: (msg: string) => void; error: (msg: string) => void };

/** Цикл воркера. Возвращает функцию остановки (дожидается текущего шага). */
export function startLeadgenWorker(logger: Logger, makeSources: MakeSources = realSources): () => Promise<void> {
  let stopping = false;
  let wake: (() => void) | null = null;
  const nap = (ms: number) =>
    new Promise<void>((resolve) => {
      const t = setTimeout(resolve, ms);
      wake = () => {
        clearTimeout(t);
        resolve();
      };
    });

  const loop = (async () => {
    const client = await pool.connect();
    try {
      let locked = false;
      while (!stopping) {
        if (!locked) {
          locked = (await client.query<{ ok: boolean }>("select pg_try_advisory_lock($1) as ok", [LOCK_ID])).rows[0]?.ok ?? false;
          if (!locked) {
            await nap(30_000); // работает другой воркер
            continue;
          }
          logger.info("Лидогенерация: воркер запущен");
        }
        try {
          await workerHeartbeat("idle");
          const id = await nextJob();
          if (id) {
            await workerHeartbeat(`job ${id}`);
            logger.info(`Лидогенерация: задача ${id} — в работу`);
            const beat = setInterval(() => void workerHeartbeat(`job ${id}`).catch(() => {}), 30_000);
            try {
              await runJob(id, makeSources, { log: logger.info });
            } finally {
              clearInterval(beat);
            }
            continue;
          }
        } catch (error) {
          logger.error(`Лидогенерация: ошибка воркера — ${error instanceof Error ? error.message : String(error)}`);
        }
        await nap(5_000);
      }
      if (locked) await client.query("select pg_advisory_unlock($1)", [LOCK_ID]).catch(() => {});
    } finally {
      client.release();
    }
  })();

  return async () => {
    stopping = true;
    // Текущая задача увидит «stopping» и встанет на паузу; воркер после перезапуска продолжит её.
    await db
      .update(leadJobs)
      .set({ status: "queued", updatedAt: new Date() })
      .where(inArray(leadJobs.status, ["running"]))
      .catch(() => {});
    (wake as (() => void) | null)?.();
    await Promise.race([loop, new Promise((r) => setTimeout(r, 5000))]);
  };
}
