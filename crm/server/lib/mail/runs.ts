import { eq, inArray } from "drizzle-orm";

import { isWorkday } from "../../../shared/leadgen.ts";
import { dayInZone, MAX_MAILBOXES_PER_RUN, normalizeRunMailboxIds } from "../../../shared/mail.ts";
import { db, type DbOrTx } from "../../db/client.ts";
import { mailDomains, mailboxes, mailRunMailboxes, mailRuns } from "../../db/schema.ts";
import { HttpError } from "../http.ts";
import { mailboxLimit, mailboxUsable, planDay, type PlanSummary, windowOf } from "./planner.ts";
import { getMailSettings } from "./render.ts";

export type DailyRun = typeof mailRuns.$inferSelect & { mailboxIds: number[] };

export async function getDailyRun(tx: DbOrTx, day: string): Promise<DailyRun | null> {
  const [run] = await tx.select().from(mailRuns).where(eq(mailRuns.planDay, day));
  if (!run) return null;
  const selected = await tx.select({ mailboxId: mailRunMailboxes.mailboxId }).from(mailRunMailboxes).where(eq(mailRunMailboxes.runId, run.id)).orderBy(mailRunMailboxes.mailboxId);
  return { ...run, mailboxIds: selected.map((r) => r.mailboxId) };
}

export async function startDailyRun(now: Date, userId: number | null, input: unknown, opts: { rnd?: () => number } = {}): Promise<{ run: DailyRun; plan: PlanSummary }> {
  const ids = normalizeRunMailboxIds(input);
  if (!ids.length) throw new HttpError(400, "Выберите хотя бы один ящик");
  if (ids.length > MAX_MAILBOXES_PER_RUN) throw new HttpError(400, `За один день можно выбрать не больше ${MAX_MAILBOXES_PER_RUN} ящиков`);
  const s = await getMailSettings(db);
  if (s.paused) throw new HttpError(409, "Снимите паузу всей рассылки перед запуском");
  const day = dayInZone(now, s.timezone);
  if (!isWorkday(day, s)) throw new HttpError(409, "Сегодня нерабочий день — запуск будет доступен в следующий рабочий день");
  if (now >= windowOf(day, s).end) throw new HttpError(409, "Окно отправки на сегодня уже закончилось");
  if (await getDailyRun(db, day)) throw new HttpError(409, "Рассылка на сегодня уже запущена. Допланируйте её без повторного выбора ящиков");

  const rows = await db.select().from(mailboxes).innerJoin(mailDomains, eq(mailDomains.id, mailboxes.domainId)).where(inArray(mailboxes.id, ids));
  if (rows.length !== ids.length) throw new HttpError(400, "Один из выбранных ящиков не найден");
  for (const row of rows) {
    if (row.mail_domains.status !== "active" || !mailboxUsable(row.mailboxes, now)) throw new HttpError(409, `Ящик ${row.mailboxes.email} сейчас недоступен`);
    if (mailboxLimit(row.mailboxes, day, s) <= 0) throw new HttpError(409, `У ящика ${row.mailboxes.email} на сегодня нулевой лимит`);
  }

  return db.transaction(async (tx) => {
    const [created] = await tx.insert(mailRuns).values({ planDay: day, createdBy: userId }).returning();
    await tx.insert(mailRunMailboxes).values(ids.map((mailboxId) => ({ runId: created.id, mailboxId })));
    const plan = await planDay(tx, now, { mailboxIds: ids, rnd: opts.rnd });
    return { run: { ...created, mailboxIds: ids }, plan };
  });
}
