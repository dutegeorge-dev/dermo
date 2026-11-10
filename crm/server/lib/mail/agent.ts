import crypto from "node:crypto";

import { and, asc, eq, inArray, isNotNull, isNull, lt, lte, or, sql } from "drizzle-orm";

import { dayInZone } from "../../../shared/mail.ts";
import { db } from "../../db/client.ts";
import { mailboxes, mailMessages, settings as settingsTable } from "../../db/schema.ts";
import { HttpError } from "../http.ts";
import { checkImap, type FetchedMessage, IMAP_CONFIG_RE, processMessage } from "./inbound.ts";
import { decryptSecret } from "./crypto.ts";
import { inWindow, buildMail, claimOutgoing, completeOutgoing, type ClaimedOutgoing, type OutgoingMail } from "./sender.ts";
import { mailboxLimit, mailboxUsable } from "./planner.ts";
import { getMailSettings, loadMailbox, newMessageId, type MailboxFull } from "./render.ts";
import { getDailyRun } from "./runs.ts";
import { evaluateWarmup, pauseForConfiguration } from "./warmup.ts";
import { MAIL_WORKER_KEY } from "./worker.ts";

export const MAIL_AGENT_KEY = "mail_agent";
const CLAIM_LOCK_ID = 7_342_102;
const IMAP_INTERVAL_MS = 5 * 60_000;

type AgentState = { hash: string | null; createdAt: string | null; createdBy: number | null; lastSeenAt: string | null; host: string | null };
const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

export async function mailAgentState(): Promise<AgentState> {
  const [row] = await db.select().from(settingsTable).where(eq(settingsTable.key, MAIL_AGENT_KEY));
  return { hash: null, createdAt: null, createdBy: null, lastSeenAt: null, host: null, ...((row?.value as Partial<AgentState>) ?? {}) };
}

async function saveAgentState(state: AgentState): Promise<void> {
  await db.insert(settingsTable).values({ key: MAIL_AGENT_KEY, value: state }).onConflictDoUpdate({ target: settingsTable.key, set: { value: state, updatedAt: new Date() } });
}

export async function issueMailAgentToken(userId: number): Promise<string> {
  const token = `irbis_mail_${crypto.randomBytes(24).toString("hex")}`;
  await saveAgentState({ ...(await mailAgentState()), hash: sha256(token), createdAt: new Date().toISOString(), createdBy: userId });
  return token;
}

export async function checkMailAgentToken(header: unknown): Promise<void> {
  const token = typeof header === "string" ? header.replace(/^Bearer\s+/i, "").trim() : "";
  const state = await mailAgentState();
  const ok = Boolean(token && state.hash) && crypto.timingSafeEqual(Buffer.from(sha256(token)), Buffer.from(state.hash!));
  if (!ok) throw new HttpError(401, "Неверный ключ локального агента — выпустите новый в разделе «Рассылка → Ящики»");
}

async function touchAgent(host: unknown): Promise<void> {
  const at = new Date().toISOString();
  const name = String(host ?? "").trim().slice(0, 200) || "рабочий компьютер";
  await db.insert(settingsTable).values({ key: MAIL_AGENT_KEY, value: { hash: null, createdAt: null, createdBy: null, lastSeenAt: at, host: name } }).onConflictDoUpdate({
    target: settingsTable.key,
    set: { value: sql`jsonb_set(jsonb_set(${settingsTable.value}, '{lastSeenAt}', to_jsonb(${at}::text), true), '{host}', to_jsonb(${name}::text), true)`, updatedAt: new Date() },
  });
  const value = { at, host: name, state: "локальный агент" };
  await db.insert(settingsTable).values({ key: MAIL_WORKER_KEY, value }).onConflictDoUpdate({ target: settingsTable.key, set: { value, updatedAt: new Date() } });
}

type AgentMailbox = {
  id: number;
  email: string;
  fromName: string;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser: string;
  imapHost: string;
  imapPort: number;
  imapUser: string;
  password: string;
};

const agentMailbox = (m: MailboxFull): AgentMailbox => ({
  id: m.id,
  email: m.email,
  fromName: m.fromName,
  smtpHost: m.smtpHost,
  smtpPort: m.smtpPort,
  smtpSecure: m.smtpSecure,
  smtpUser: m.smtpUser,
  imapHost: m.imapHost,
  imapPort: m.imapPort,
  imapUser: m.imapUser,
  password: decryptSecret(m.passwordEnc),
});

export type MailAgentTask =
  | { type: "idle"; message: string }
  | { type: "check"; mailboxId: number; mailbox: AgentMailbox; testTo: string | null; testMail: OutgoingMail | null }
  | { type: "send"; messageId: number; mailbox: AgentMailbox; mail: OutgoingMail }
  | { type: "imap"; mailboxId: number; mailbox: AgentMailbox; cursor: { uidValidity: number | null; lastUid: number | null } };

async function nextCheck(): Promise<MailAgentTask | null> {
  const [row] = await db.select({ id: mailboxes.id }).from(mailboxes).where(isNotNull(mailboxes.checkRequestedAt)).orderBy(asc(mailboxes.checkRequestedAt)).limit(1);
  if (!row) return null;
  const m = await loadMailbox(db, row.id);
  const testTo = m.checkTestTo;
  const testMail = testTo ? buildMail(m, { subject: "Проверка ящика", body: `Тестовое письмо с ${m.email}: SMTP работает.\n\n${m.signature}`, messageId: newMessageId(m.domain.domain), inReplyTo: null }, testTo) : null;
  return { type: "check", mailboxId: m.id, mailbox: agentMailbox(m), testTo, testMail };
}

async function claimNextOutgoing(now: Date): Promise<MailAgentTask | null> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${CLAIM_LOCK_ID})`);
    const s = await getMailSettings(tx);
    const day = dayInZone(now, s.timezone);
    const run = await getDailyRun(tx, day);
    const regular = !s.paused && inWindow(now, s) && Boolean(run);
    const candidates = await tx
      .select()
      .from(mailMessages)
      .where(and(eq(mailMessages.status, "planned"), lte(mailMessages.scheduledAt, now)))
      .orderBy(asc(mailMessages.scheduledAt))
      .limit(500);
    for (const msg of candidates) {
      const force = msg.mode === "test" && msg.queueId === null;
      if (!force && (!regular || msg.planDay !== day || !run!.mailboxIds.includes(msg.mailboxId))) continue;
      const box = await loadMailbox(tx, msg.mailboxId);
      if (!force && (!mailboxUsable(box, now) || box.domain.status !== "active")) continue;
      const [last] = await tx
        .select({ at: mailMessages.sentAt })
        .from(mailMessages)
        .where(and(eq(mailMessages.mailboxId, box.id), inArray(mailMessages.status, ["sent", "failed"]), sql`${mailMessages.sentAt} is not null`))
        .orderBy(sql`${mailMessages.sentAt} desc`)
        .limit(1);
      if (!force && last?.at && now.getTime() - last.at.getTime() < s.minGapMinutes * 60_000) continue;
      const [used] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(mailMessages)
        .where(and(eq(mailMessages.mailboxId, box.id), eq(mailMessages.planDay, day), inArray(mailMessages.status, ["sending", "sent", "failed"]), sql`(${mailMessages.mode} = ${s.mode} or (${mailMessages.mode} is null and ${mailMessages.status} = 'sending'))`));
      if (!force && used.n >= mailboxLimit(box, day, s)) continue;
      const claimed = await claimOutgoing(tx, msg.id, now, { force });
      if ("result" in claimed) continue;
      if (claimed.claim.mode === "dry_run") {
        await completeOutgoing(tx, claimed.claim, { ok: true }, now);
        return { type: "idle", message: `Письмо ${msg.id} записано в журнал dry-run` };
      }
      return { type: "send", messageId: msg.id, mailbox: agentMailbox(claimed.claim.box), mail: claimed.claim.mail };
    }
    return null;
  });
}

async function nextImap(now: Date): Promise<MailAgentTask | null> {
  const stale = new Date(now.getTime() - IMAP_INTERVAL_MS);
  const [row] = await db
    .select({ id: mailboxes.id })
    .from(mailboxes)
    .where(and(sql`${mailboxes.status} <> 'burned'`, or(isNotNull(mailboxes.imapPollRequestedAt), isNull(mailboxes.imapCheckedAt), lt(mailboxes.imapCheckedAt, stale))))
    .orderBy(sql`${mailboxes.imapPollRequestedAt} is not null desc`, asc(mailboxes.imapCheckedAt))
    .limit(1);
  if (!row) return null;
  const m = await loadMailbox(db, row.id);
  return { type: "imap", mailboxId: m.id, mailbox: agentMailbox(m), cursor: { uidValidity: m.imapUidValidity, lastUid: m.imapLastUid } };
}

export async function nextMailAgentTask(host: unknown, now = new Date()): Promise<MailAgentTask> {
  await touchAgent(host);
  return (await nextCheck()) ?? (await claimNextOutgoing(now)) ?? (await nextImap(now)) ?? { type: "idle", message: "Заданий нет" };
}

export type AgentCheckResult = {
  type: "check";
  mailboxId: number;
  smtp: { ok: boolean; error?: string };
  imap: { ok: boolean; error?: string };
  test?: { ok: boolean; error?: string } | null;
};
export type AgentSendResult = { type: "send"; messageId: number; ok: boolean; error?: string; responseCode?: number };
export type AgentImapResult = {
  type: "imap";
  mailboxId: number;
  ok: boolean;
  error?: string;
  uidValidity?: number;
  lastUid?: number;
  messages?: { uid: number; source: string }[];
  done?: boolean;
};
export type MailAgentResult = AgentCheckResult | AgentSendResult | AgentImapResult;

async function applyCheckResult(result: AgentCheckResult, now: Date): Promise<void> {
  const m = await loadMailbox(db, result.mailboxId);
  const smtpError = result.smtp.ok ? result.test && !result.test.ok ? result.test.error ?? "тестовое письмо не отправлено" : null : result.smtp.error ?? "SMTP: ошибка";
  const imapError = result.imap.ok ? null : result.imap.error ?? "IMAP: ошибка";
  const configError = (!result.smtp.ok && (result.smtp.error ?? "SMTP")) || (!result.imap.ok && (result.imap.error ?? "IMAP"));
  await db
    .update(mailboxes)
    .set({
      checkRequestedAt: null,
      checkTestTo: null,
      smtpVerifiedAt: result.smtp.ok && (!result.test || result.test.ok) ? now : m.smtpVerifiedAt,
      smtpError,
      imapVerifiedAt: result.imap.ok ? now : m.imapVerifiedAt,
      imapCheckedAt: now,
      imapError,
      ...(result.smtp.ok && result.imap.ok && m.status === "paused" && !m.pausedUntil ? { status: "warming", pauseReason: null } : {}),
      updatedAt: now,
    })
    .where(eq(mailboxes.id, m.id));
  if (configError) {
    if (!result.smtp.ok) await pauseForConfiguration(db, m.id, result.smtp.error ?? "SMTP: ошибка", now, "SMTP");
    if (!result.imap.ok) await pauseForConfiguration(db, m.id, result.imap.error ?? "IMAP: ошибка", now, "IMAP");
  }
  await evaluateWarmup(db, m.id, now);
}

async function applySendResult(result: AgentSendResult, now: Date): Promise<void> {
  const [msg] = await db.select().from(mailMessages).where(and(eq(mailMessages.id, result.messageId), eq(mailMessages.status, "sending")));
  if (!msg) return;
  const box = await loadMailbox(db, msg.mailboxId);
  const mode = msg.mode === "test" || msg.mode === "live" || msg.mode === "dry_run" ? msg.mode : "live";
  const to = msg.sentTo ?? msg.toEmail;
  const claim: ClaimedOutgoing = { msg, box, mode, to, mail: buildMail(box, msg, to) };
  await completeOutgoing(db, claim, { ok: result.ok, error: String(result.error ?? "").slice(0, 1000), responseCode: result.responseCode }, now);
}

async function applyImapResult(result: AgentImapResult, now: Date): Promise<void> {
  const m = await loadMailbox(db, result.mailboxId);
  if (!result.ok) {
    const error = String(result.error ?? "IMAP: ошибка").slice(0, 1000);
    await db.update(mailboxes).set({ imapCheckedAt: now, imapError: error, imapPollRequestedAt: null, updatedAt: now }).where(eq(mailboxes.id, m.id));
    if (IMAP_CONFIG_RE.test(error)) await pauseForConfiguration(db, m.id, error, now, "IMAP");
    return;
  }
  const uidValidity = Number(result.uidValidity);
  if (!Number.isSafeInteger(uidValidity) || uidValidity <= 0) throw new HttpError(400, "IMAP: некорректный UIDVALIDITY");
  const messages = (result.messages ?? []).slice(0, 5);
  let processed = 0;
  for (const item of messages) {
    const uid = Number(item.uid);
    if (!Number.isSafeInteger(uid) || uid <= 0 || typeof item.source !== "string") throw new HttpError(400, "IMAP: некорректное письмо");
    const source = Buffer.from(item.source, "base64");
    if (source.length > 3_100_000) throw new HttpError(413, "IMAP: письмо больше 3 МБ");
    if (await processMessage(m, uidValidity, uid, source, now)) processed++;
  }
  const lastUid = Number(result.lastUid ?? m.imapLastUid ?? 0);
  await db
    .update(mailboxes)
    .set({ imapUidValidity: uidValidity, imapLastUid: lastUid, imapCheckedAt: now, imapVerifiedAt: m.imapVerifiedAt ?? now, imapError: null, ...(result.done === false ? {} : { imapPollRequestedAt: null }), updatedAt: now })
    .where(eq(mailboxes.id, m.id));
  await evaluateWarmup(db, m.id, now);
  return void processed;
}

export async function applyMailAgentResult(result: MailAgentResult, host: unknown, now = new Date()): Promise<{ ok: true }> {
  await touchAgent(host);
  if (result.type === "check") await applyCheckResult(result, now);
  else if (result.type === "send") await applySendResult(result, now);
  else await applyImapResult(result, now);
  return { ok: true };
}

/** Проверка IMAP с рабочего ПК используется агентом; серверную функцию сохраняем для интеграционных тестов. */
export { checkImap };
export type { FetchedMessage };
