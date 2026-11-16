import { and, eq, inArray, sql } from "drizzle-orm";

import { isWorkday } from "../../../shared/leadgen.ts";
import { dayInZone, MAX_MAILBOXES_PER_RUN, normalizeRunMailboxIds } from "../../../shared/mail.ts";
import { db, type DbOrTx } from "../../db/client.ts";
import { mailDomains, mailboxes, mailMessages, mailRunMailboxes, mailRuns } from "../../db/schema.ts";
import { HttpError } from "../http.ts";
import { mailboxLimit, mailboxReadyForMode, mailboxUsable, planDay, type PlanSummary, windowOf } from "./planner.ts";
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
    if (!mailboxReadyForMode(row.mailboxes, s.mode)) throw new HttpError(409, `Ящик ${row.mailboxes.email}: сначала сервер должен успешно проверить SMTP и IMAP`);
    if (mailboxLimit(row.mailboxes, day, s) <= 0) throw new HttpError(409, `У ящика ${row.mailboxes.email} на сегодня нулевой лимит`);
  }
  const capacity = rows.reduce((sum, row) => sum + mailboxLimit(row.mailboxes, day, s), 0);

  return db.transaction(async (tx) => {
    const [created] = await tx.insert(mailRuns).values({ planDay: day, createdBy: userId }).returning();
    await tx.insert(mailRunMailboxes).values(ids.map((mailboxId) => ({ runId: created.id, mailboxId })));
    const [used] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(mailMessages)
      .where(and(eq(mailMessages.planDay, day), inArray(mailMessages.mailboxId, ids), inArray(mailMessages.status, ["planned", "sending", "sent", "dry_run", "failed"])));
    const [due] = (await tx.execute<{ n: number }>(sql`
      select count(*)::int as n from lead_queue q join lead_sellers s on s.inn = q.seller_inn
      where q.status = 'planned' and q.touch = 'first' and q.planned_date <= ${day} and s.picked_at is not null
        and not exists (select 1 from mail_messages m where m.queue_id = q.id and m.status in ('planned', 'sending'))`)).rows;
    const pull = Math.max(0, Math.min(capacity - used.n - due.n, 500));
    if (pull > 0) {
      await tx.execute(sql`
        with future as (
          select q.id from lead_queue q join lead_sellers s on s.inn = q.seller_inn
          where q.status = 'planned' and q.touch = 'first' and q.planned_date > ${day} and s.picked_at is not null
            and not exists (select 1 from mail_messages m where m.queue_id = q.id and m.status in ('planned', 'sending'))
          order by q.planned_date, q.position, q.id limit ${pull}
        )
        update lead_queue q set planned_date = ${day} from future where q.id = future.id`);
    }
    const plan = await planDay(tx, now, { mailboxIds: ids, rnd: opts.rnd });
    return { run: { ...created, mailboxIds: ids }, plan };
  });
}
