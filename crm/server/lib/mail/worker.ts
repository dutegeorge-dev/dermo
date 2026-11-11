/**
 * Воркер рассылки (служба bars-crm-mail, `npm run mail:worker`; в разработке — CRM_MAIL_INLINE=true в bars-crm):
 * - раз в 20 с: план явно запущенного дня и отправка подошедших писем с выбранных ящиков;
 * - раз в 5 минут: входящие всех ящиков по IMAP, включая ящики на SMTP-паузе.
 * Одновременно работает один воркер (advisory lock в PostgreSQL). Пароли и тела писем в лог не пишутся.
 */

import os from "node:os";

import { eq } from "drizzle-orm";
import type { PoolClient } from "pg";

import { isWorkday } from "../../../shared/leadgen.ts";
import { dayInZone } from "../../../shared/mail.ts";
import { db, pool } from "../../db/client.ts";
import { settings as settingsTable } from "../../db/schema.ts";
import { pollAll } from "./inbound.ts";
import { planDay, windowOf } from "./planner.ts";
import { getMailSettings, getMailState } from "./render.ts";
import { getDailyRun } from "./runs.ts";
import { sendDue } from "./sender.ts";

export const MAIL_WORKER_KEY = "mail_worker";
export const MAIL_WORKER_LOCK_ID = 7_342_002;
const TICK_MS = 20_000;

export async function tryMailWorkerLock(client: PoolClient): Promise<boolean> {
  return (await client.query<{ ok: boolean }>("select pg_try_advisory_lock($1) as ok", [MAIL_WORKER_LOCK_ID])).rows[0]?.ok ?? false;
}

/** План дня строится только после явного запуска с выбранными ящиками. */
export async function maybePlan(now = new Date()): Promise<boolean> {
  const s = await getMailSettings(db);
  if (s.paused) return false;
  const day = dayInZone(now, s.timezone);
  if (!isWorkday(day, { workdays: s.workdays, holidays: s.holidays })) return false;
  const w = windowOf(day, s);
  if (now < w.start || now >= w.end) return false;
  const run = await getDailyRun(db, day);
  if (!run) return false;
  const state = await getMailState<{ lastPlanDay?: string }>(db);
  if (state.lastPlanDay === day) return false;
  await planDay(db, now, { mailboxIds: run.mailboxIds });
  return true;
}

async function heartbeat(state: string): Promise<void> {
  const value = { at: new Date().toISOString(), host: os.hostname(), pid: process.pid, state };
  await db.insert(settingsTable).values({ key: MAIL_WORKER_KEY, value }).onConflictDoUpdate({ target: settingsTable.key, set: { value, updatedAt: new Date() } });
}

type Logger = { info: (msg: string) => void; error: (msg: string) => void };

export function startMailWorker(logger: Logger): () => Promise<void> {
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
    let locked = false;
    let lastImap = 0;
    try {
      while (!stopping) {
        if (!locked) {
          locked = await tryMailWorkerLock(client);
          if (!locked) {
            await nap(30_000);
            continue;
          }
          logger.info("Рассылка: серверный воркер запущен; SMTP и IMAP выполняются на сервере");
        }
        try {
          await heartbeat("работает: план, SMTP, IMAP");
          if (await maybePlan()) logger.info("Рассылка: план дня построен");
          const s = await getMailSettings(db);
          const run = await getDailyRun(db, dayInZone(new Date(), s.timezone));
          const results = run ? await sendDue(new Date(), run.mailboxIds) : [];
          for (const r of results) logger.info(`Рассылка: письмо ${r.messageId} — ${r.status}${r.error ? ` (${r.error.slice(0, 200)})` : ""}`);
          if (Date.now() - lastImap >= 5 * 60_000) {
            lastImap = Date.now();
            await pollAll(new Date(), logger.info);
          }
        } catch (error) {
          logger.error(`Рассылка: ошибка воркера — ${error instanceof Error ? error.message : String(error)}`);
        }
        await nap(TICK_MS);
      }
    } finally {
      if (locked) await client.query("select pg_advisory_unlock($1)", [MAIL_WORKER_LOCK_ID]).catch(() => {});
      client.release();
    }
  })();
  return async () => {
    stopping = true;
    (wake as (() => void) | null)?.();
    await Promise.race([loop, new Promise((r) => setTimeout(r, 10_000))]);
  };
}

export async function workerAlive(): Promise<{ at: string | null; alive: boolean }> {
  const [row] = await db.select().from(settingsTable).where(eq(settingsTable.key, MAIL_WORKER_KEY));
  const at = (row?.value as { at?: string } | undefined)?.at ?? null;
  return { at, alive: Boolean(at && Date.now() - Date.parse(at) < 2 * 60_000) };
}
