/**
 * План дня рассылки для ящиков явного запуска. В начале окна (и по кнопке «Построить план») из lead_queue берётся всё,
 * что должно уйти сегодня и раньше: сначала повторы (только с ящика первого письма), потом первые письма — по ящикам пропорционально остатку
 * дневного лимита. Каждый ящик — равномерно по окну со случайным сдвигом ±jitter, не чаще minGap. Не влезшее в лимиты и
 * окно переносится на следующий рабочий день. Письма рендерятся сразу и лежат в mail_messages (status planned).
 * Повторный запуск в тот же день добавляет только новое (уже запланированное не дублируется).
 */

import { and, asc, desc, eq, inArray, isNotNull, lte, sql } from "drizzle-orm";

import { addDaysIso, isWorkday, nextWorkday } from "../../../shared/leadgen.ts";
import { dayInZone, type MailSettings, spreadTimes, warmupDailyLimit, warmupWorkday, zonedTime } from "../../../shared/mail.ts";
import type { DbOrTx } from "../../db/client.ts";
import { leadContacts, leadQueue, leadSellers, mailDomains, mailboxes, mailMessages } from "../../db/schema.ts";
import { getMailSettings, loadMailbox, type MailboxFull, newMessageId, patchMailState, renderForSeller } from "./render.ts";
import { isStopped } from "./stoplist.ts";

/** Статусы продавца, при которых больше не пишем. */
export const FINAL_STATUSES = ["replied", "replied_pos", "replied_neg", "bounced", "do_not_contact"];

export type PlanSummary = {
  day: string;
  at: string;
  planned: number;
  followups: number;
  firsts: number;
  /** Не влезли в лимиты / окно — перенесены на следующий рабочий день. */
  deferred: number;
  deferredTo: string | null;
  /** Нет рабочего email — остаются в «Сегодня» для звонка / ручной работы. */
  noEmail: number;
  /** Сняты: стоп-лист, продавец уже ответил / возврат. */
  skipped: number;
  perMailbox: Record<string, number>;
  note?: string;
};

type MailboxState = Pick<typeof mailboxes.$inferSelect, "status" | "pausedUntil" | "dailyLimit" | "warmupStart">;

/** Ящик может отправлять сейчас: не на паузе / не сожжён, пауза по времени истекла. */
export function mailboxUsable(m: Pick<typeof mailboxes.$inferSelect, "status" | "pausedUntil">, now: Date): boolean {
  if (m.status === "burned") return false;
  if (m.status === "paused") return Boolean(m.pausedUntil && m.pausedUntil <= now);
  return m.status === "active" || m.status === "warming";
}

export function mailboxLimit(m: MailboxState, day: string, settings: Pick<MailSettings, "workdays" | "holidays">): number {
  if (m.status === "burned" || m.status === "active") return Math.max(0, m.dailyLimit);
  return warmupDailyLimit(m.dailyLimit, m.warmupStart, day, settings);
}

/** Завершённый прогрев и истёкшая пауза автоматически возвращают ящик в правильный статус. */
export function mailboxStatusForDay(m: MailboxState, day: string, now: Date, settings: Pick<MailSettings, "workdays" | "holidays">): string {
  if (m.status === "burned" || (m.status === "paused" && (!m.pausedUntil || m.pausedUntil > now))) return m.status;
  if (m.status === "active") return "active";
  if (!m.warmupStart) return "active";
  return warmupDailyLimit(m.dailyLimit, m.warmupStart, day, settings) >= m.dailyLimit && warmupWorkday(m.warmupStart, day, settings) > 0 ? "active" : "warming";
}

const workdaysOf = (s: MailSettings) => ({ workdays: s.workdays, holidays: s.holidays });

export function windowOf(day: string, s: MailSettings): { start: Date; end: Date } {
  return { start: zonedTime(day, s.windowStart, s.timezone), end: zonedTime(day, s.windowEnd, s.timezone) };
}

/** Первый рабочий email продавца, не в стоп-листе (порядок — как получены). */
async function recipientOf(tx: DbOrTx, inn: string): Promise<{ id: number; value: string } | null> {
  const rows = await tx
    .select({ id: leadContacts.id, value: leadContacts.value })
    .from(leadContacts)
    .where(and(eq(leadContacts.sellerInn, inn), eq(leadContacts.type, "email"), eq(leadContacts.valid, true)))
    .orderBy(asc(leadContacts.id));
  for (const r of rows) if (!(await isStopped(tx, null, r.value))) return r;
  return null;
}

export async function planDay(tx: DbOrTx, now = new Date(), opts: { rnd?: () => number; mailboxIds?: number[] } = {}): Promise<PlanSummary> {
  const rnd = opts.rnd ?? Math.random;
  const s = await getMailSettings(tx);
  const day = dayInZone(now, s.timezone);
  const summary: PlanSummary = { day, at: now.toISOString(), planned: 0, followups: 0, firsts: 0, deferred: 0, deferredTo: null, noEmail: 0, skipped: 0, perMailbox: {} };
  const finish = async (note?: string) => {
    if (note) summary.note = note;
    await patchMailState(tx, { lastPlan: summary, lastPlanDay: day });
    return summary;
  };
  if (s.paused) return finish("рассылка на паузе");
  if (!isWorkday(day, workdaysOf(s))) return finish("нерабочий день");
  const win = windowOf(day, s);
  if (now >= win.end) return finish("окно отправки на сегодня закончилось");
  const from = new Date(Math.max(now.getTime(), win.start.getTime()));

  // В боевом запуске сюда передаются только явно выбранные ящики.
  const selected = opts.mailboxIds === undefined ? null : new Set(opts.mailboxIds);
  const boxes: MailboxFull[] = [];
  for (const m of await tx.select().from(mailboxes).innerJoin(mailDomains, eq(mailDomains.id, mailboxes.domainId))) {
    if (selected && !selected.has(m.mailboxes.id)) continue;
    const status = mailboxStatusForDay(m.mailboxes, day, now, s);
    if (status !== m.mailboxes.status) await tx.update(mailboxes).set({ status, pauseReason: null, pausedUntil: null, updatedAt: now }).where(eq(mailboxes.id, m.mailboxes.id));
    const box = { ...m.mailboxes, status };
    if (mailboxUsable(box, now) && m.mail_domains.status === "active") boxes.push({ ...box, domain: m.mail_domains });
  }
  const used = await tx
    .select({ mailboxId: mailMessages.mailboxId, n: sql<number>`count(*)::int` })
    .from(mailMessages)
    .where(and(eq(mailMessages.planDay, day), inArray(mailMessages.status, ["planned", "sending", "sent", "dry_run"])))
    .groupBy(mailMessages.mailboxId);
  const left = new Map(boxes.map((b) => [b.id, Math.max(0, mailboxLimit(b, day, s) - (used.find((u) => u.mailboxId === b.id)?.n ?? 0))]));
  const limit = new Map(boxes.map((b) => [b.id, Math.max(1, mailboxLimit(b, day, s))]));

  // Всё, что должно уйти сегодня и раньше: сначала повторы, потом первые письма (по плану лидогенерации).
  const items = await tx
    .select({ id: leadQueue.id, inn: leadQueue.sellerInn, touch: leadQueue.touch, status: leadSellers.status })
    .from(leadQueue)
    .innerJoin(leadSellers, eq(leadSellers.inn, leadQueue.sellerInn))
    .where(
      and(
        eq(leadQueue.status, "planned"),
        lte(leadQueue.plannedDate, day),
        isNotNull(leadSellers.pickedAt),
        sql`not exists (select 1 from mail_messages m where m.queue_id = ${leadQueue.id} and m.status in ('planned', 'sending'))`,
      ),
    )
    .orderBy(sql`(${leadQueue.touch} = 'followup') desc`, asc(leadQueue.plannedDate), asc(leadQueue.position), asc(leadQueue.id));

  type Item = { queueId: number; inn: string; touch: "first" | "followup"; mailbox: MailboxFull; to: { id: number | null; value: string }; inReplyTo: string | null; firstSubject?: string };
  const chosen: Item[] = [];
  const defer: number[] = [];
  for (const it of items) {
    if (FINAL_STATUSES.includes(it.status) || (await isStopped(tx, it.inn))) {
      await tx.update(leadQueue).set({ status: "cancelled", note: "рассылка: стоп-лист или продавец уже ответил" }).where(eq(leadQueue.id, it.id));
      summary.skipped++;
      continue;
    }
    if (it.touch === "followup") {
      // Повтор — с того же ящика и на тот же адрес, в той же цепочке.
      const [first] = await tx
        .select()
        .from(mailMessages)
        .where(and(eq(mailMessages.sellerInn, it.inn), eq(mailMessages.touch, "first"), eq(mailMessages.status, "sent"), eq(mailMessages.mode, "live")))
        .orderBy(desc(mailMessages.sentAt))
        .limit(1);
      if (first) {
        const box = boxes.find((b) => b.id === first.mailboxId);
        const [contact] = first.contactId ? await tx.select().from(leadContacts).where(eq(leadContacts.id, first.contactId)) : [];
        if (contact && !contact.valid) {
          summary.skipped++;
          continue; // адрес первого письма вернулся — повтор некуда
        }
        if (!box || (left.get(box.id) ?? 0) <= 0) {
          defer.push(it.id);
          continue;
        }
        left.set(box.id, (left.get(box.id) ?? 0) - 1);
        chosen.push({ queueId: it.id, inn: it.inn, touch: "followup", mailbox: box, to: { id: first.contactId, value: first.toEmail }, inReplyTo: first.messageId, firstSubject: first.subject });
        continue;
      }
      // Первое письмо ушло не рассылкой — повтор как отдельное письмо, ящик — как для первого.
    }
    const to = await recipientOf(tx, it.inn);
    if (!to) {
      summary.noEmail++;
      continue;
    }
    // Ящик с наибольшей долей оставшегося лимита — распределение пропорционально остатку.
    const box = boxes.filter((b) => (left.get(b.id) ?? 0) > 0).sort((a, b) => (left.get(b.id)! / limit.get(b.id)!) - (left.get(a.id)! / limit.get(a.id)!))[0];
    if (!box) {
      defer.push(it.id);
      continue;
    }
    left.set(box.id, (left.get(box.id) ?? 0) - 1);
    chosen.push({ queueId: it.id, inn: it.inn, touch: it.touch === "followup" ? "followup" : "first", mailbox: box, to, inReplyTo: null });
  }

  // Время каждого письма: по ящику, равномерно по остатку окна, не ближе minGap к уже запланированным.
  const minGapMs = s.minGapMinutes * 60_000;
  for (const box of boxes) {
    const mine = chosen.filter((c) => c.mailbox.id === box.id);
    if (!mine.length) continue;
    const busy = (
      await tx
        .select({ at: mailMessages.scheduledAt })
        .from(mailMessages)
        .where(and(eq(mailMessages.mailboxId, box.id), eq(mailMessages.planDay, day), inArray(mailMessages.status, ["planned", "sending", "sent", "dry_run"])))
    ).map((r) => r.at.getTime());
    const times = spreadTimes(mine.length, from.getTime(), win.end.getTime(), { minGapMs, jitter: s.jitter, rnd, busy });
    // Повторы — раньше первых писем (они первыми в списке).
    for (let i = 0; i < mine.length; i++) {
      const c = mine[i];
      if (i >= times.length) {
        defer.push(c.queueId); // не влезло в окно
        continue;
      }
      const r = await renderForSeller(tx, c.inn, box, c.touch, { firstSubject: c.firstSubject });
      await tx.insert(mailMessages).values({
        sellerInn: c.inn,
        queueId: c.queueId,
        mailboxId: box.id,
        contactId: c.to.id,
        toEmail: c.to.value,
        touch: c.touch,
        templateId: r.template.id,
        templateVersion: r.template.version,
        subject: r.subject,
        body: r.body,
        variants: r.variants,
        messageId: newMessageId(box.domain.domain),
        inReplyTo: c.inReplyTo,
        planDay: day,
        scheduledAt: new Date(times[i]),
      });
      summary.planned++;
      if (c.touch === "followup") summary.followups++;
      else summary.firsts++;
      summary.perMailbox[box.email] = (summary.perMailbox[box.email] ?? 0) + 1;
    }
  }

  // Не влезшее — на следующий рабочий день (в «Сегодня» лидогенерации его видно там же).
  if (defer.length) {
    const next = nextWorkday(addDaysIso(day, 1), workdaysOf(s));
    await tx.update(leadQueue).set({ plannedDate: next }).where(inArray(leadQueue.id, defer));
    summary.deferred = defer.length;
    summary.deferredTo = next;
  }
  return finish();
}

/** Подгрузить ящик письма (для отправки). */
export const mailboxOf = (tx: DbOrTx, id: number) => loadMailbox(tx, id);
