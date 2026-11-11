/**
 * Подготовка и завершение отправки общие для тестового SMTP и локального HTTPS-агента. Сервер атомарно переводит
 * planned → sending, выполняет стоп-лист и запрет tlkbars.ru, а после ответа агента обновляет письмо, воронку и прогрев.
 * Пароли и тела писем в лог не пишутся. sending после аварии автоматически не переотправляется: SMTP мог принять письмо.
 */

import { and, asc, desc, eq, inArray, lte, sql } from "drizzle-orm";
import nodemailer from "nodemailer";

import { isWorkday } from "../../../shared/leadgen.ts";
import { dayInZone, MAIN_DOMAIN_ERROR, type MailMode, type MailSettings, mentionsMainDomain } from "../../../shared/mail.ts";
import { db, type DbOrTx } from "../../db/client.ts";
import { leadContacts, leadSellers, mailboxes, mailMessages } from "../../db/schema.ts";
import { getLeadgenSettings, setSellerStatus } from "../leadgen/work.ts";
import { followupsEnabled } from "../followups.ts";
import { decryptSecret } from "./crypto.ts";
import { FINAL_STATUSES, mailboxReadyForMode, mailboxStatusForDay, mailboxUsable, windowOf } from "./planner.ts";
import { getMailSettings, loadMailbox, type MailboxFull } from "./render.ts";
import { isStopped } from "./stoplist.ts";
import { evaluateWarmup, pauseForConfiguration, pauseForSpam } from "./warmup.ts";

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
export function setTransportFactory(f: TransportFactory | null): void {
  transportFactory = f ?? smtpTransport;
}
export const makeTransport = (m: MailboxFull) => transportFactory(m, decryptSecret(m.passwordEnc));

export function buildMail(m: MailboxFull, msg: Pick<typeof mailMessages.$inferSelect, "subject" | "body" | "messageId" | "inReplyTo">, to: string): OutgoingMail {
  return {
    from: { name: m.fromName || m.email, address: m.email },
    to,
    subject: msg.subject,
    text: msg.body,
    messageId: msg.messageId,
    ...(msg.inReplyTo ? { inReplyTo: msg.inReplyTo, references: msg.inReplyTo } : {}),
    headers: { "List-Unsubscribe": `<mailto:${m.email}?subject=unsubscribe>` },
  };
}

export const SPAM_SMTP_RE = /\b5\.7\.1\b|\b554\b|spam|limit exceeded|too many|rate limit|blocked|заблокир|лимит/i;
export const CONFIG_SMTP_RE = /\b53[45]\b|\b5\.7\.8\b|EAUTH|authentication|auth failed|invalid login|connection timeout|ETIMEDOUT|ECONNREFUSED|ENOTFOUND|ESOCKET/i;
const HARD_BOUNCE_SMTP_RE = /\b5\.1\.[16]\b|user unknown|recipient address rejected|mailbox unavailable|no such user/i;

export type SendResult = { messageId: number; status: string; error?: string };
export type ClaimedOutgoing = {
  msg: typeof mailMessages.$inferSelect;
  box: MailboxFull;
  mode: MailMode;
  to: string;
  mail: OutgoingMail;
};

export function inWindow(now: Date, s: MailSettings): boolean {
  const day = dayInZone(now, s.timezone);
  if (!isWorkday(day, { workdays: s.workdays, holidays: s.holidays })) return false;
  const w = windowOf(day, s);
  return now >= w.start && now < w.end;
}

async function failClaim(tx: DbOrTx, id: number, mode: MailMode, status: "failed" | "cancelled", error: string, now: Date): Promise<SendResult> {
  await tx.update(mailMessages).set({ status, error: error.slice(0, 1000), mode, sentAt: now }).where(and(eq(mailMessages.id, id), eq(mailMessages.status, "sending")));
  return { messageId: id, status, error };
}

/** Атомарно занять письмо и сформировать SMTP-задание. */
export async function claimOutgoing(tx: DbOrTx, id: number, now = new Date(), opts: { force?: boolean } = {}): Promise<{ claim: ClaimedOutgoing } | { result: SendResult }> {
  const s = await getMailSettings(tx);
  const mode: MailMode = opts.force ? "test" : s.mode;
  const [msg] = await tx
    .update(mailMessages)
    .set({ status: "sending", mode })
    .where(and(eq(mailMessages.id, id), eq(mailMessages.status, "planned")))
    .returning();
  if (!msg) return { result: { messageId: id, status: "skipped" } };
  const fail = (status: "failed" | "cancelled", error: string) => failClaim(tx, id, mode, status, error, now);
  const box = await loadMailbox(tx, msg.mailboxId);
  const [seller] = await tx.select().from(leadSellers).where(eq(leadSellers.inn, msg.sellerInn));
  if (msg.touch === "followup" && !followupsEnabled()) return { result: await fail("cancelled", "повторные касания отключены") };
  if (!opts.force) {
    if (!seller || FINAL_STATUSES.includes(seller.status)) return { result: await fail("cancelled", `продавец: ${seller?.status ?? "удалён"}`) };
    if (await isStopped(tx, msg.sellerInn, msg.toEmail)) return { result: await fail("cancelled", "стоп-лист") };
    if (!mailboxUsable(box, now) || box.domain.status !== "active") return { result: await fail("cancelled", "ящик или домен недоступен") };
    if (mode === "live" && !mailboxReadyForMode(box, mode)) return { result: await fail("failed", "live запрещён до успешной проверки SMTP и IMAP локальным агентом") };
    if (msg.touch === "first" && box.warmupFirstsPaused) return { result: await fail("cancelled", "первые касания остановлены до проверки базы из-за возвратов") };
  }
  if ([msg.subject, msg.body, box.signature, box.fromName, box.email, box.domain.domain].some((t) => mentionsMainDomain(t))) return { result: await fail("failed", MAIN_DOMAIN_ERROR) };
  const to = mode === "test" ? s.testAddress : msg.toEmail;
  if (!to) return { result: await fail("failed", "не задан тестовый адрес (Рассылка → настройки)") };
  await tx.update(mailMessages).set({ sentTo: to }).where(and(eq(mailMessages.id, id), eq(mailMessages.status, "sending")));
  return { claim: { msg: { ...msg, mode, sentTo: to }, box, mode, to, mail: buildMail(box, msg, to) } };
}

export type OutgoingOutcome = { ok: boolean; error?: string; responseCode?: number };

/** Применить фактический результат SMTP ровно один раз. */
export async function completeOutgoing(tx: DbOrTx, claim: ClaimedOutgoing, outcome: OutgoingOutcome, now = new Date()): Promise<SendResult> {
  const { msg, box, mode, to } = claim;
  if (mode === "dry_run") {
    const [updated] = await tx.update(mailMessages).set({ status: "dry_run", mode, sentAt: now }).where(and(eq(mailMessages.id, msg.id), eq(mailMessages.status, "sending"))).returning({ id: mailMessages.id });
    return { messageId: msg.id, status: updated ? "dry_run" : "skipped" };
  }
  if (!outcome.ok) {
    const text = (outcome.error || "SMTP: неизвестная ошибка").slice(0, 1000);
    const [updated] = await tx.update(mailMessages).set({ status: "failed", error: text, mode, sentAt: now }).where(and(eq(mailMessages.id, msg.id), eq(mailMessages.status, "sending"))).returning({ id: mailMessages.id });
    if (!updated) return { messageId: msg.id, status: "skipped" };
    await tx.update(mailboxes).set({ smtpError: text, updatedAt: now }).where(eq(mailboxes.id, box.id));
    if (mode === "live" && SPAM_SMTP_RE.test(text)) await pauseForSpam(tx, box.id, text, now);
    else if (CONFIG_SMTP_RE.test(text)) await pauseForConfiguration(tx, box.id, text, now, "SMTP");
    if (mode === "live" && HARD_BOUNCE_SMTP_RE.test(text)) {
      await tx.update(leadContacts).set({ valid: false, note: `возврат SMTP ${now.toISOString().slice(0, 10)}` }).where(and(eq(leadContacts.sellerInn, msg.sellerInn), eq(leadContacts.type, "email"), eq(leadContacts.value, msg.toEmail)));
      await cancelPlanned(tx, msg.sellerInn, "возврат SMTP", msg.toEmail);
      await evaluateWarmup(tx, box.id, now);
    }
    return { messageId: msg.id, status: "failed", error: text };
  }
  const [updated] = await tx.update(mailMessages).set({ status: "sent", mode, sentTo: to, sentAt: now, error: null }).where(and(eq(mailMessages.id, msg.id), eq(mailMessages.status, "sending"))).returning({ id: mailMessages.id });
  if (!updated) return { messageId: msg.id, status: "skipped" };
  await tx.update(mailboxes).set({ smtpError: null, smtpVerifiedAt: box.smtpVerifiedAt ?? now, updatedAt: now }).where(eq(mailboxes.id, box.id));
  if (mode === "live") {
    const ls = await getLeadgenSettings(tx);
    await tx.transaction((nested) => setSellerStatus(nested, msg.sellerInn, msg.touch === "followup" ? "followup_sent" : "sent", null, `рассылка: ${box.email}`, ls, now));
    await evaluateWarmup(tx, box.id, now);
  }
  return { messageId: msg.id, status: "sent" };
}

/** Непосредственная отправка используется тестами с подменённым транспортом; прод отправляет локальный агент. */
export async function sendOne(id: number, now = new Date(), opts: { force?: boolean } = {}): Promise<SendResult> {
  const claimed = await claimOutgoing(db, id, now, opts);
  if ("result" in claimed) return claimed.result;
  if (claimed.claim.mode === "dry_run") return completeOutgoing(db, claimed.claim, { ok: true }, now);
  const transport = makeTransport(claimed.claim.box);
  let outcome: OutgoingOutcome;
  try {
    await transport.send(claimed.claim.mail);
    outcome = { ok: true };
  } catch (error) {
    const text = error instanceof Error ? `${(error as { responseCode?: number }).responseCode ?? ""} ${error.message}`.trim() : String(error);
    outcome = { ok: false, error: text, responseCode: (error as { responseCode?: number }).responseCode };
  } finally {
    transport.close?.();
  }
  return completeOutgoing(db, claimed.claim, outcome, now);
}

/** Тик для интеграционных проверок: одно подошедшее письмо с каждого доступного ящика. */
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
    const [stored] = await db.select().from(mailboxes).where(eq(mailboxes.id, m.id));
    if (stored && stored.status !== m.status) await db.update(mailboxes).set({ status: m.status, pauseReason: null, pausedUntil: null, updatedAt: now }).where(eq(mailboxes.id, m.id));
    if (!mailboxReadyForMode({ ...m, ...stored }, s.mode)) return null;
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

export async function cancelPlanned(tx: DbOrTx, inn: string, reason: string, toEmail?: string): Promise<void> {
  await tx
    .update(mailMessages)
    .set({ status: "cancelled", error: reason })
    .where(and(eq(mailMessages.sellerInn, inn), eq(mailMessages.status, "planned"), toEmail ? eq(mailMessages.toEmail, toEmail) : undefined));
}
