/**
 * Отправка запланированных писем с ящиков текущего запуска. Раз в ~20 с: по каждому ящику — одно письмо, срок которого подошёл, если с прошлого
 * прошло не меньше minGap и сейчас окно отправки. Перед отправкой — стоп-лист, статус продавца, запрет tlkbars.ru.
 * Режимы: dry_run — только журнал; test — на тестовый адрес (воронка не меняется); live — продавцу (первое письмо →
 * «Написал» и повтор в очереди лидогенерации, повтор → «Повтор отправлен»). Повтор — в той же цепочке
 * (In-Reply-To / References = Message-ID первого). Пароли и тела писем в лог не пишутся.
 */

import { and, asc, desc, eq, inArray, lte, sql } from "drizzle-orm";
import nodemailer from "nodemailer";

import { isWorkday } from "../../../shared/leadgen.ts";
import { dayInZone, MAIN_DOMAIN_ERROR, type MailSettings, mentionsMainDomain } from "../../../shared/mail.ts";
import { db, type DbOrTx } from "../../db/client.ts";
import { leadSellers, mailboxes, mailMessages } from "../../db/schema.ts";
import { getLeadgenSettings, setSellerStatus } from "../leadgen/work.ts";
import { decryptSecret } from "./crypto.ts";
import { FINAL_STATUSES, mailboxStatusForDay, mailboxUsable, windowOf } from "./planner.ts";
import { getMailSettings, loadMailbox, type MailboxFull } from "./render.ts";
import { isStopped } from "./stoplist.ts";

export type OutgoingMail = {
  from: { name: string; address: string };
  to: string;
  subject: string;
  text: string;
  messageId: string;
  inReplyTo?: string;
  references?: string;
  headers: Record<string, string>;
};

export type MailTransport = { send(mail: OutgoingMail): Promise<{ response?: string }>; verify(): Promise<void>; close?(): void };
export type TransportFactory = (mailbox: MailboxFull, password: string) => MailTransport;

/** Настоящий SMTP (хост, порт, TLS — из полей ящика; Яндекс 360: smtp.yandex.ru:465 SSL). */
export const smtpTransport: TransportFactory = (m, password) => {
  const t = nodemailer.createTransport({
    host: m.smtpHost,
    port: m.smtpPort,
    secure: m.smtpSecure,
    requireTLS: !m.smtpSecure,
    auth: { user: m.smtpUser, pass: password },
    connectionTimeout: 30_000,
    greetingTimeout: 30_000,
    socketTimeout: 60_000,
    logger: false,
    debug: false,
  });
  return {
    async send(mail) {
      const info = await t.sendMail({
        from: mail.from,
        to: mail.to,
        subject: mail.subject,
        text: mail.text,
        messageId: mail.messageId,
        inReplyTo: mail.inReplyTo,
        references: mail.references,
        headers: mail.headers,
        // Только текст: без HTML, картинок и пикселей.
        textEncoding: "quoted-printable",
      });
      return { response: info.response };
    },
    async verify() {
      await t.verify();
    },
    close: () => t.close(),
  };
};

let transportFactory: TransportFactory = smtpTransport;
/** Тесты подменяют SMTP. */
export function setTransportFactory(f: TransportFactory | null): void {
  transportFactory = f ?? smtpTransport;
}
export const makeTransport = (m: MailboxFull) => transportFactory(m, decryptSecret(m.passwordEnc));

/** Письмо в формате для SMTP. replyTo — первое письмо цепочки (для повтора). */
export function buildMail(m: MailboxFull, msg: Pick<typeof mailMessages.$inferSelect, "subject" | "body" | "messageId" | "inReplyTo">, to: string): OutgoingMail {
  return {
    from: { name: m.fromName || m.email, address: m.email },
    to,
    subject: msg.subject,
    text: msg.body,
    messageId: msg.messageId,
    ...(msg.inReplyTo ? { inReplyTo: msg.inReplyTo, references: msg.inReplyTo } : {}),
    // Отписка в один клик (письмом на тот же ящик) — меньше жалоб «спам».
    headers: { "List-Unsubscribe": `<mailto:${m.email}?subject=unsubscribe>` },
  };
}

/** Признаки отказа SMTP из-за спама / лимита — ящик на паузу (подробнее — этап 2). */
export const SPAM_SMTP_RE = /\b5\.7\.1\b|\b554\b|spam|limit exceeded|too many|rate limit|blocked|заблокир|лимит/i;

export type SendResult = { messageId: number; status: string; error?: string };

/** Окно отправки сейчас? */
export function inWindow(now: Date, s: MailSettings): boolean {
  const day = dayInZone(now, s.timezone);
  if (!isWorkday(day, { workdays: s.workdays, holidays: s.holidays })) return false;
  const w = windowOf(day, s);
  return now >= w.start && now < w.end;
}

/** Одно письмо: проверки → отправка (или журнал) → отметки. */
export async function sendOne(id: number, now = new Date(), opts: { force?: boolean } = {}): Promise<SendResult> {
  const s = await getMailSettings(db);
  const [msg] = await db
    .update(mailMessages)
    .set({ status: "sending" })
    .where(and(eq(mailMessages.id, id), eq(mailMessages.status, "planned")))
    .returning();
  if (!msg) return { messageId: id, status: "skipped" };
  const fail = async (status: "failed" | "cancelled", error: string) => {
    await db.update(mailMessages).set({ status, error: error.slice(0, 1000), mode: s.mode }).where(eq(mailMessages.id, id));
    return { messageId: id, status, error };
  };
  const box = await loadMailbox(db, msg.mailboxId);
  const [seller] = await db.select().from(leadSellers).where(eq(leadSellers.inn, msg.sellerInn));
  if (!opts.force) {
    if (!seller || FINAL_STATUSES.includes(seller.status)) return fail("cancelled", `продавец: ${seller?.status ?? "удалён"}`);
    if (await isStopped(db, msg.sellerInn, msg.toEmail)) return fail("cancelled", "стоп-лист");
  }
  if ([msg.subject, msg.body, box.signature, box.email, box.domain.domain].some((t) => mentionsMainDomain(t))) return fail("failed", MAIN_DOMAIN_ERROR);

  if (s.mode === "dry_run" && !opts.force) {
    await db.update(mailMessages).set({ status: "dry_run", mode: "dry_run", sentAt: now }).where(eq(mailMessages.id, id));
    return { messageId: id, status: "dry_run" };
  }
  const to = s.mode === "test" || opts.force ? s.testAddress : msg.toEmail;
  if (!to) return fail("failed", "не задан тестовый адрес (Рассылка → настройки)");
  const transport = makeTransport(box);
  try {
    await transport.send(buildMail(box, msg, to));
  } catch (error) {
    const text = error instanceof Error ? `${(error as { responseCode?: number }).responseCode ?? ""} ${error.message}`.trim() : String(error);
    if (SPAM_SMTP_RE.test(text)) {
      await db
        .update(mailboxes)
        .set({ status: "paused", pauseReason: `SMTP: ${text.slice(0, 200)}`, pausedUntil: new Date(now.getTime() + 48 * 3600_000), updatedAt: now })
        .where(eq(mailboxes.id, box.id));
    }
    return fail("failed", text);
  } finally {
    transport.close?.();
  }
  const mode = opts.force ? "test" : s.mode;
  await db.update(mailMessages).set({ status: "sent", mode, sentTo: to, sentAt: now, error: null }).where(eq(mailMessages.id, id));
  if (mode === "live") {
    // Воронка лидогенерации: первое письмо → «Написал» (+ повтор через followupDays), повтор → «Повтор отправлен».
    const ls = await getLeadgenSettings(db);
    await db.transaction((tx) => setSellerStatus(tx, msg.sellerInn, msg.touch === "followup" ? "followup_sent" : "sent", null, `рассылка: ${box.email}`, ls, now));
  }
  return { messageId: id, status: "sent" };
}

/** Тик отправки: только ящики запуска дня; одно подошедшее письмо с каждого, параллельно. */
export async function sendDue(now = new Date(), mailboxIds?: number[]): Promise<SendResult[]> {
  const s = await getMailSettings(db);
  if (s.paused || !inWindow(now, s) || mailboxIds?.length === 0) return [];
  const selected = mailboxIds === undefined ? null : new Set(mailboxIds);
  const day = dayInZone(now, s.timezone);
  const boxes = (await db.select().from(mailboxes))
    .filter((m) => (!selected || selected.has(m.id)) && mailboxUsable(m, now))
    .map((m) => ({ ...m, status: mailboxStatusForDay(m, day, now, s) }));
  const minGapMs = s.minGapMinutes * 60_000;
  const work = boxes.map(async (m) => {
    const [stored] = await db.select({ status: mailboxes.status }).from(mailboxes).where(eq(mailboxes.id, m.id));
    if (stored && stored.status !== m.status) await db.update(mailboxes).set({ status: m.status, pauseReason: null, pausedUntil: null, updatedAt: now }).where(eq(mailboxes.id, m.id));
    const [last] = await db
      .select({ at: mailMessages.sentAt })
      .from(mailMessages)
      .where(and(eq(mailMessages.mailboxId, m.id), inArray(mailMessages.status, ["sent", "failed"]), sql`${mailMessages.sentAt} is not null`))
      .orderBy(desc(mailMessages.sentAt))
      .limit(1);
    if (last?.at && now.getTime() - last.at.getTime() < minGapMs) return null;
    const [due] = await db
      .select({ id: mailMessages.id })
      .from(mailMessages)
      .where(and(eq(mailMessages.mailboxId, m.id), eq(mailMessages.status, "planned"), lte(mailMessages.scheduledAt, now)))
      .orderBy(asc(mailMessages.scheduledAt))
      .limit(1);
    return due ? sendOne(due.id, now) : null;
  });
  return (await Promise.all(work)).filter((r): r is SendResult => r !== null);
}

/** Отменить запланированные письма продавцу (ответил, возврат, стоп-лист). */
export async function cancelPlanned(tx: DbOrTx, inn: string, reason: string, toEmail?: string): Promise<void> {
  await tx
    .update(mailMessages)
    .set({ status: "cancelled", error: reason })
    .where(and(eq(mailMessages.sellerInn, inn), eq(mailMessages.status, "planned"), toEmail ? eq(mailMessages.toEmail, toEmail) : undefined));
}
