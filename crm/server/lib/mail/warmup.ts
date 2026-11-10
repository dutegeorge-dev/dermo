import { and, desc, eq, gt, inArray, or, sql } from "drizzle-orm";

import { WARMUP_MAX_BOUNCE_RATE, warmupHoldReason, warmupStageLimit } from "../../../shared/mail.ts";
import type { DbOrTx } from "../../db/client.ts";
import { mailDomains, mailInbound, mailboxes, mailMessages } from "../../db/schema.ts";
import { audit } from "../audit.ts";

export type MailboxWarmup = {
  mailboxId: number;
  stage: number;
  stageLimit: number;
  sendingDays: number;
  sent: number;
  bounces: number;
  bounceRate: number;
  recentErrors: number;
  holdReason: string | null;
  firstsPaused: boolean;
};

export function mailboxLiveReady(m: Pick<typeof mailboxes.$inferSelect, "smtpVerifiedAt" | "imapVerifiedAt">): boolean {
  return Boolean(m.smtpVerifiedAt && m.imapVerifiedAt);
}

async function currentStats(tx: DbOrTx, mailboxId: number, now = new Date()): Promise<MailboxWarmup | null> {
  const [row] = await tx.select().from(mailboxes).innerJoin(mailDomains, eq(mailDomains.id, mailboxes.domainId)).where(eq(mailboxes.id, mailboxId));
  if (!row) return null;
  const m = row.mailboxes;
  const start = m.warmupStageStartedAt;
  const sentRows = await tx
    .select({ id: mailMessages.id, day: mailMessages.planDay })
    .from(mailMessages)
    .where(and(eq(mailMessages.mailboxId, mailboxId), eq(mailMessages.status, "sent"), eq(mailMessages.mode, "live"), gt(mailMessages.sentAt, start)))
    .orderBy(desc(mailMessages.planDay));
  const days = [...new Set(sentRows.map((r) => r.day))];
  const [bounce] = await tx
    .select({ n: sql<number>`count(distinct ${mailMessages.id})::int` })
    .from(mailMessages)
    .leftJoin(mailInbound, and(eq(mailInbound.replyToMessageId, mailMessages.id), eq(mailInbound.kind, "bounce")))
    .where(and(
      eq(mailMessages.mailboxId, mailboxId),
      eq(mailMessages.mode, "live"),
      gt(mailMessages.sentAt, start),
      or(
        eq(mailInbound.kind, "bounce"),
        and(eq(mailMessages.status, "failed"), sql`coalesce(${mailMessages.error}, '') ~* '5\\.1\\.[16]|user unknown|recipient address rejected|mailbox unavailable|no such user'`),
      ),
    ));
  const recentDays = days.slice(0, 3);
  const [recent] = recentDays.length
    ? await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(mailMessages)
        .where(and(eq(mailMessages.mailboxId, mailboxId), eq(mailMessages.status, "failed"), eq(mailMessages.mode, "live"), inArray(mailMessages.planDay, recentDays), gt(mailMessages.sentAt, start)))
    : [{ n: 0 }];
  const active = m.status !== "burned" && row.mail_domains.status === "active" && (m.status !== "paused" || Boolean(m.pausedUntil && m.pausedUntil <= now));
  const holdReason = warmupHoldReason({
    stage: m.warmupStage,
    sendingDays: days.length,
    sent: sentRows.length,
    recentErrors: recent.n,
    bounceRate: bounce.n / Math.max(1, sentRows.length),
    ready: mailboxLiveReady(m),
    active,
  });
  return {
    mailboxId,
    stage: m.warmupStage,
    stageLimit: warmupStageLimit(m.warmupStage),
    sendingDays: days.length,
    sent: sentRows.length,
    bounces: bounce.n,
    bounceRate: bounce.n / Math.max(1, sentRows.length),
    recentErrors: recent.n,
    holdReason,
    firstsPaused: m.warmupFirstsPaused,
  };
}

export async function warmupStats(tx: DbOrTx, mailboxId: number): Promise<MailboxWarmup | null> {
  return currentStats(tx, mailboxId);
}

/** Переход возможен только по фактическим live-отправкам текущей ступени. */
export async function evaluateWarmup(tx: DbOrTx, mailboxId: number, now = new Date()): Promise<MailboxWarmup | null> {
  const stats = await currentStats(tx, mailboxId, now);
  if (!stats) return null;
  const [m] = await tx.select().from(mailboxes).where(eq(mailboxes.id, mailboxId));
  if (!m) return stats;
  const massBounces = stats.sent + stats.bounces >= 5 && stats.bounceRate > WARMUP_MAX_BOUNCE_RATE;
  const firstsPaused = m.warmupFirstsPaused || massBounces;
  if (stats.holdReason === null && stats.stage < 5) {
    const stage = stats.stage + 1;
    await tx.update(mailboxes).set({ warmupStage: stage, warmupStageStartedAt: now, warmupHoldReason: null, status: stage === 5 ? "active" : "warming", updatedAt: now }).where(eq(mailboxes.id, mailboxId));
    await audit(tx, { userId: null, action: "update", entityType: "mailbox", entityId: mailboxId, summary: `Рассылка: прогрев ${m.email}, ступень ${stats.stage} → ${stage}, лимит ${warmupStageLimit(stage)}` });
    return currentStats(tx, mailboxId, now);
  }
  if (m.warmupHoldReason !== stats.holdReason || m.warmupFirstsPaused !== firstsPaused || (m.status === "warming" && stats.stage === 5)) {
    await tx
      .update(mailboxes)
      .set({ warmupHoldReason: stats.holdReason, warmupFirstsPaused: firstsPaused, ...(stats.stage === 5 && m.status === "warming" ? { status: "active" } : {}), updatedAt: now })
      .where(eq(mailboxes.id, mailboxId));
  }
  return { ...stats, firstsPaused };
}

/** После блокировки ступень откатывается сразу; отсчёт начинается заново после паузы. */
export async function pauseForSpam(tx: DbOrTx, mailboxId: number, reason: string, now: Date): Promise<void> {
  const [m] = await tx.select().from(mailboxes).where(eq(mailboxes.id, mailboxId));
  if (!m) return;
  const stage = Math.max(1, m.warmupStage - 1);
  await tx
    .update(mailboxes)
    .set({
      status: "paused",
      pauseReason: `SMTP: ${reason.slice(0, 400)}`,
      pausedUntil: new Date(now.getTime() + 48 * 3600_000),
      warmupStage: stage,
      warmupStageStartedAt: now,
      warmupHoldReason: "после 48-часовой паузы нужно заново пройти текущую ступень",
      smtpError: reason.slice(0, 1000),
      updatedAt: now,
    })
    .where(eq(mailboxes.id, mailboxId));
}

export async function pauseForConfiguration(tx: DbOrTx, mailboxId: number, reason: string, now: Date, protocol: "SMTP" | "IMAP"): Promise<void> {
  await tx
    .update(mailboxes)
    .set({
      status: "paused",
      pauseReason: `${protocol}: ${reason.slice(0, 400)}`,
      pausedUntil: null,
      ...(protocol === "SMTP" ? { smtpVerifiedAt: null, smtpError: reason.slice(0, 1000) } : { imapVerifiedAt: null, imapError: reason.slice(0, 1000) }),
      updatedAt: now,
    })
    .where(eq(mailboxes.id, mailboxId));
}

export async function resumeFirstsAfterReview(tx: DbOrTx, mailboxId: number, userId: number, now = new Date()): Promise<void> {
  const [m] = await tx.update(mailboxes).set({ warmupFirstsPaused: false, warmupStageStartedAt: now, warmupHoldReason: null, updatedAt: now }).where(eq(mailboxes.id, mailboxId)).returning();
  if (!m) return;
  await audit(tx, { userId, action: "update", entityType: "mailbox", entityId: mailboxId, summary: `Рассылка: база проверена, первые касания с ${m.email} разрешены заново` });
}
