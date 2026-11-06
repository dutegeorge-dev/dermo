/**
 * Раздел «Рассылка»: настройки и режим, план дня и журнал, домены и ящики (только админ), шаблоны и предпросмотр,
 * тест цепочки, входящие, стоп-лист. Доступ — админ или право mail. Пароли ящиков наружу не отдаются никогда.
 */

import { and, asc, desc, eq, gte, inArray, sql } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";

import { addDaysIso } from "../../shared/leadgen.ts";
import { dayInZone, MAIL_PERMISSION, MAIN_DOMAIN_ERROR, mentionsMainDomain, unknownPlaceholders } from "../../shared/mail.ts";
import { db } from "../db/client.ts";
import { doNotContact, leadCategories, leadQueue, leadSellers, mailDomains, mailboxes, mailInbound, mailMessages, mailTemplates } from "../db/schema.ts";
import { audit } from "../lib/audit.ts";
import { body, HttpError, intParam, requireAdmin, requirePermission } from "../lib/http.ts";
import { getLeadgenSettings, setSellerStatus } from "../lib/leadgen/work.ts";
import { decryptSecret, encryptSecret } from "../lib/mail/crypto.ts";
import { checkImap, pollMailbox } from "../lib/mail/inbound.ts";
import { planDay } from "../lib/mail/planner.ts";
import { getMailSettings, getMailState, loadMailbox, newMessageId, renderForSeller, setMailSettings } from "../lib/mail/render.ts";
import { buildMail, makeTransport, sendOne } from "../lib/mail/sender.ts";
import { addToStopList } from "../lib/mail/stoplist.ts";
import { workerAlive } from "../lib/mail/worker.ts";

const guard = (request: FastifyRequest) => requirePermission(request, MAIL_PERMISSION);

const DOMAIN_RE = /^(?=.{3,253}$)([a-z0-9-]+\.)+[a-z]{2,}$/;
const EMAIL_RE = /^[a-z0-9._%+-]+@([a-z0-9-]+\.)+[a-z]{2,}$/;

const mailboxColumns = {
  id: mailboxes.id,
  email: mailboxes.email,
  fromName: mailboxes.fromName,
  domainId: mailboxes.domainId,
  domain: mailDomains.domain,
  smtpHost: mailboxes.smtpHost,
  smtpPort: mailboxes.smtpPort,
  smtpSecure: mailboxes.smtpSecure,
  smtpUser: mailboxes.smtpUser,
  imapHost: mailboxes.imapHost,
  imapPort: mailboxes.imapPort,
  imapUser: mailboxes.imapUser,
  signature: mailboxes.signature,
  dailyLimit: mailboxes.dailyLimit,
  warmupStart: sql<string | null>`${mailboxes.warmupStart}::text`,
  status: mailboxes.status,
  pauseReason: mailboxes.pauseReason,
  pausedUntil: mailboxes.pausedUntil,
  imapCheckedAt: mailboxes.imapCheckedAt,
  imapError: mailboxes.imapError,
};

type MailboxInput = {
  email: string;
  fromName: string;
  domainId: number;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser: string;
  imapHost: string;
  imapPort: number;
  imapUser: string;
  password: string;
  signature: string;
  dailyLimit: number;
  warmupStart: string | null;
  status: string;
};

async function mailboxValues(input: Partial<MailboxInput>, partial: boolean): Promise<Partial<typeof mailboxes.$inferInsert>> {
  const out: Partial<typeof mailboxes.$inferInsert> = {};
  const str = (v: unknown, max = 200) => String(v ?? "").trim().slice(0, max);
  const port = (v: unknown, label: string) => {
    const n = Number(v);
    if (!Number.isInteger(n) || n < 1 || n > 65535) throw new HttpError(400, `${label}: порт 1–65535`);
    return n;
  };
  if (input.email !== undefined || !partial) {
    const email = str(input.email).toLowerCase();
    if (!EMAIL_RE.test(email)) throw new HttpError(400, "Укажите email ящика");
    if (mentionsMainDomain(email)) throw new HttpError(400, MAIN_DOMAIN_ERROR);
    out.email = email;
  }
  if (input.domainId !== undefined || !partial) {
    const [d] = await db.select().from(mailDomains).where(eq(mailDomains.id, Number(input.domainId)));
    if (!d) throw new HttpError(400, "Выберите домен");
    if (out.email && !out.email.endsWith(`@${d.domain}`)) throw new HttpError(400, `Ящик должен быть на домене ${d.domain}`);
    out.domainId = d.id;
  }
  if (input.fromName !== undefined) out.fromName = str(input.fromName, 120);
  if (input.smtpHost !== undefined || !partial) out.smtpHost = str(input.smtpHost) || "smtp.yandex.ru";
  if (input.smtpPort !== undefined || !partial) out.smtpPort = port(input.smtpPort ?? 465, "SMTP");
  if (input.smtpSecure !== undefined) out.smtpSecure = Boolean(input.smtpSecure);
  if (input.smtpUser !== undefined || !partial) out.smtpUser = str(input.smtpUser) || out.email || "";
  if (input.imapHost !== undefined || !partial) out.imapHost = str(input.imapHost) || "imap.yandex.ru";
  if (input.imapPort !== undefined || !partial) out.imapPort = port(input.imapPort ?? 993, "IMAP");
  if (input.imapUser !== undefined || !partial) out.imapUser = str(input.imapUser) || out.email || "";
  if (typeof input.password === "string" && input.password !== "") out.passwordEnc = encryptSecret(input.password);
  else if (!partial) throw new HttpError(400, "Укажите пароль приложения");
  if (input.signature !== undefined) {
    const signature = String(input.signature ?? "").trim().slice(0, 2000);
    if (mentionsMainDomain(signature)) throw new HttpError(400, MAIN_DOMAIN_ERROR);
    out.signature = signature;
  }
  if (input.dailyLimit !== undefined) {
    const n = Number(input.dailyLimit);
    if (!Number.isInteger(n) || n < 0 || n > 500) throw new HttpError(400, "Дневной лимит — 0–500");
    out.dailyLimit = n;
  }
  if (input.warmupStart !== undefined) out.warmupStart = input.warmupStart && /^\d{4}-\d{2}-\d{2}$/.test(input.warmupStart) ? input.warmupStart : null;
  if (input.status !== undefined) {
    if (!["warming", "active", "paused", "burned"].includes(String(input.status))) throw new HttpError(400, "Неизвестный статус ящика");
    out.status = String(input.status);
    if (out.status !== "paused") {
      out.pauseReason = null;
      out.pausedUntil = null;
    }
  }
  return out;
}

type TemplateInput = { categoryId: number | null; forMarking: boolean | null; touch: string; name: string; subject: string; body: string; active: boolean };

function templateValues(input: Partial<TemplateInput>, partial: boolean): Partial<typeof mailTemplates.$inferInsert> {
  const out: Partial<typeof mailTemplates.$inferInsert> = {};
  if (input.subject !== undefined || !partial) {
    const subject = String(input.subject ?? "").trim().slice(0, 300);
    if (!subject) throw new HttpError(400, "Укажите тему");
    out.subject = subject;
  }
  if (input.body !== undefined || !partial) {
    const text = String(input.body ?? "").replace(/\r\n/g, "\n").trim().slice(0, 10000);
    if (!text) throw new HttpError(400, "Укажите текст письма");
    if (/<[a-z][^>]*>/i.test(text)) throw new HttpError(400, "Письмо — только текст, без HTML");
    out.body = text;
  }
  for (const t of [out.subject, out.body]) {
    if (t && mentionsMainDomain(t)) throw new HttpError(400, MAIN_DOMAIN_ERROR);
    const unknown = t ? unknownPlaceholders(t) : [];
    if (unknown.length) throw new HttpError(400, `Неизвестные подстановки: ${unknown.map((u) => `{${u}}`).join(", ")}`);
  }
  if (input.touch !== undefined || !partial) {
    if (input.touch !== "first" && input.touch !== "followup") throw new HttpError(400, "Тип касания — первое письмо или повтор");
    out.touch = input.touch;
  }
  if (input.categoryId !== undefined) out.categoryId = input.categoryId ? Number(input.categoryId) : null;
  if (input.forMarking !== undefined) out.forMarking = input.forMarking === null ? null : Boolean(input.forMarking);
  if (input.name !== undefined) out.name = String(input.name ?? "").trim().slice(0, 120);
  if (input.active !== undefined) out.active = Boolean(input.active);
  return out;
}

export async function mailRoutes(app: FastifyInstance): Promise<void> {
  // ── Состояние, настройки, пауза ──
  app.get("/mail/status", async (request) => {
    guard(request);
    const s = await getMailSettings(db);
    const day = dayInZone(new Date(), s.timezone);
    const counts = await db
      .select({ status: mailMessages.status, n: sql<number>`count(*)::int` })
      .from(mailMessages)
      .where(eq(mailMessages.planDay, day))
      .groupBy(mailMessages.status);
    const [due] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(leadQueue)
      .innerJoin(leadSellers, eq(leadSellers.inn, leadQueue.sellerInn))
      .where(and(eq(leadQueue.status, "planned"), sql`${leadQueue.plannedDate} <= ${day}`, sql`${leadSellers.pickedAt} is not null`));
    const [unresolved] = await db.select({ n: sql<number>`count(*)::int` }).from(mailInbound).where(and(eq(mailInbound.kind, "human"), sql`${mailInbound.resolution} is null`));
    return {
      settings: s,
      day,
      today: Object.fromEntries(counts.map((c) => [c.status, c.n])),
      queueDue: due.n,
      unresolved: unresolved.n,
      state: await getMailState(db),
      worker: await workerAlive(),
      secretKey: Boolean(process.env.MAILBOX_SECRET_KEY?.trim()),
      mailboxes: await db.select(mailboxColumns).from(mailboxes).innerJoin(mailDomains, eq(mailDomains.id, mailboxes.domainId)).orderBy(asc(mailboxes.id)),
    };
  });

  app.put("/mail/settings", async (request) => {
    const user = requireAdmin(request);
    const before = await getMailSettings(db);
    const next = await setMailSettings(db, { ...before, ...(request.body as object) }, user.id);
    await audit(db, { userId: user.id, action: "update", entityType: "mail", entityId: null, summary: `Рассылка: настройки${before.mode !== next.mode ? `, режим ${before.mode} → ${next.mode}` : ""}`, data: next, ip: request.ip });
    return { settings: next };
  });

  /** «Пауза всей рассылки» — может любой с доступом; снять — только админ. */
  app.post("/mail/pause", async (request) => {
    const user = guard(request);
    const paused = Boolean(body<{ paused: boolean }>(request).paused);
    if (!paused) requireAdmin(request);
    const next = await setMailSettings(db, { ...(await getMailSettings(db)), paused }, user.id);
    await audit(db, { userId: user.id, action: "update", entityType: "mail", entityId: null, summary: paused ? "Рассылка: пауза всей рассылки" : "Рассылка: пауза снята", ip: request.ip });
    return { settings: next };
  });

  app.post("/mail/plan", async (request) => {
    guard(request);
    return { plan: await planDay(db) };
  });

  // ── План и журнал ──
  app.get("/mail/messages", async (request) => {
    guard(request);
    const q = request.query as { day?: string; status?: string; mailbox?: string; inn?: string };
    const conds = [
      q.day && /^\d{4}-\d{2}-\d{2}$/.test(q.day) ? eq(mailMessages.planDay, q.day) : undefined,
      q.status ? inArray(mailMessages.status, q.status.split(",")) : undefined,
      q.mailbox ? eq(mailMessages.mailboxId, Number(q.mailbox)) : undefined,
      q.inn ? eq(mailMessages.sellerInn, q.inn) : undefined,
    ];
    const rows = await db
      .select({
        id: mailMessages.id,
        sellerInn: mailMessages.sellerInn,
        brand: sql<string | null>`${leadSellers.brands}[1]`,
        legalName: leadSellers.legalName,
        mailbox: mailboxes.email,
        toEmail: mailMessages.toEmail,
        sentTo: mailMessages.sentTo,
        touch: mailMessages.touch,
        subject: mailMessages.subject,
        status: mailMessages.status,
        mode: mailMessages.mode,
        scheduledAt: mailMessages.scheduledAt,
        sentAt: mailMessages.sentAt,
        error: mailMessages.error,
        templateId: mailMessages.templateId,
      })
      .from(mailMessages)
      .innerJoin(mailboxes, eq(mailboxes.id, mailMessages.mailboxId))
      .leftJoin(leadSellers, eq(leadSellers.inn, mailMessages.sellerInn))
      .where(and(...conds.filter(Boolean)))
      .orderBy(asc(mailMessages.scheduledAt))
      .limit(1000);
    return { messages: rows };
  });

  app.get("/mail/messages/:id", async (request) => {
    guard(request);
    const [row] = await db.select().from(mailMessages).where(eq(mailMessages.id, intParam((request.params as { id: string }).id)));
    if (!row) throw new HttpError(404, "Письмо не найдено");
    return { message: row };
  });

  app.post("/mail/messages/:id/cancel", async (request) => {
    const user = guard(request);
    const id = intParam((request.params as { id: string }).id);
    const [row] = await db.update(mailMessages).set({ status: "cancelled", error: `снято вручную: ${user.name}` }).where(and(eq(mailMessages.id, id), eq(mailMessages.status, "planned"))).returning({ id: mailMessages.id });
    if (!row) throw new HttpError(409, "Письмо уже не в плане");
    return { ok: true };
  });

  // ── Домены (только админ) ──
  app.get("/mail/domains", async (request) => {
    guard(request);
    return { domains: await db.select().from(mailDomains).orderBy(asc(mailDomains.domain)) };
  });

  app.post("/mail/domains", async (request) => {
    const user = requireAdmin(request);
    const input = body<{ domain: string; landingBaseUrl: string; note: string; dkimSelector: string }>(request);
    const domain = String(input.domain ?? "").trim().toLowerCase();
    if (!DOMAIN_RE.test(domain)) throw new HttpError(400, "Укажите домен, например tlkbars-import.ru");
    if (mentionsMainDomain(domain)) throw new HttpError(400, MAIN_DOMAIN_ERROR);
    const landing = String(input.landingBaseUrl ?? "").trim() || `https://${domain}/wb/`;
    if (mentionsMainDomain(landing) || !landing.startsWith(`https://${domain}/`)) throw new HttpError(400, `Посадочные страницы — только на https://${domain}/`);
    const [row] = await db
      .insert(mailDomains)
      .values({ domain, landingBaseUrl: landing, note: String(input.note ?? "").slice(0, 500), dkimSelector: String(input.dkimSelector ?? "").trim() || "mail" })
      .returning();
    await audit(db, { userId: user.id, action: "create", entityType: "mail_domain", entityId: row.id, summary: `Рассылка: домен ${domain}`, ip: request.ip });
    return { domain: row };
  });

  app.patch("/mail/domains/:id", async (request) => {
    const user = requireAdmin(request);
    const id = intParam((request.params as { id: string }).id);
    const input = body<{ landingBaseUrl: string; status: string; note: string; dkimSelector: string }>(request);
    const [d] = await db.select().from(mailDomains).where(eq(mailDomains.id, id));
    if (!d) throw new HttpError(404, "Домен не найден");
    const set: Partial<typeof mailDomains.$inferInsert> = { updatedAt: new Date() };
    if (input.landingBaseUrl !== undefined) {
      const landing = String(input.landingBaseUrl).trim();
      if (mentionsMainDomain(landing) || !landing.startsWith(`https://${d.domain}/`)) throw new HttpError(400, `Посадочные страницы — только на https://${d.domain}/`);
      set.landingBaseUrl = landing;
    }
    if (input.status !== undefined) {
      if (!["active", "paused", "burned"].includes(input.status)) throw new HttpError(400, "Неизвестный статус домена");
      set.status = input.status;
    }
    if (input.note !== undefined) set.note = String(input.note).slice(0, 500);
    if (input.dkimSelector !== undefined) set.dkimSelector = String(input.dkimSelector).trim() || "mail";
    const [row] = await db.update(mailDomains).set(set).where(eq(mailDomains.id, id)).returning();
    await audit(db, { userId: user.id, action: "update", entityType: "mail_domain", entityId: id, summary: `Рассылка: домен ${d.domain}`, ip: request.ip });
    return { domain: row };
  });

  app.delete("/mail/domains/:id", async (request) => {
    const user = requireAdmin(request);
    const id = intParam((request.params as { id: string }).id);
    const [busy] = await db.select({ id: mailboxes.id }).from(mailboxes).where(eq(mailboxes.domainId, id)).limit(1);
    if (busy) throw new HttpError(409, "На домене есть ящики — сначала удалите их");
    const [row] = await db.delete(mailDomains).where(eq(mailDomains.id, id)).returning();
    if (!row) throw new HttpError(404, "Домен не найден");
    await audit(db, { userId: user.id, action: "delete", entityType: "mail_domain", entityId: id, summary: `Рассылка: удалил домен ${row.domain}`, ip: request.ip });
    return { ok: true };
  });

  // ── Ящики (только админ; пароль наружу не отдаётся) ──
  app.post("/mail/mailboxes", async (request) => {
    const user = requireAdmin(request);
    const values = (await mailboxValues(body<MailboxInput>(request), false)) as typeof mailboxes.$inferInsert;
    const [exists] = await db.select({ id: mailboxes.id }).from(mailboxes).where(eq(mailboxes.email, values.email));
    if (exists) throw new HttpError(409, "Такой ящик уже есть");
    const [row] = await db
      .insert(mailboxes)
      .values({ status: "warming", warmupStart: new Date().toISOString().slice(0, 10), ...values })
      .returning({ id: mailboxes.id, email: mailboxes.email });
    await audit(db, { userId: user.id, action: "create", entityType: "mailbox", entityId: row.id, summary: `Рассылка: ящик ${row.email}`, ip: request.ip });
    return { mailbox: row };
  });

  app.patch("/mail/mailboxes/:id", async (request) => {
    const user = requireAdmin(request);
    const id = intParam((request.params as { id: string }).id);
    const values = await mailboxValues(body<MailboxInput>(request), true);
    const [row] = await db.update(mailboxes).set({ ...values, updatedAt: new Date() }).where(eq(mailboxes.id, id)).returning({ id: mailboxes.id, email: mailboxes.email });
    if (!row) throw new HttpError(404, "Ящик не найден");
    await audit(db, { userId: user.id, action: "update", entityType: "mailbox", entityId: id, summary: `Рассылка: ящик ${row.email}${values.passwordEnc ? " (новый пароль)" : ""}`, ip: request.ip });
    return { mailbox: row };
  });

  app.delete("/mail/mailboxes/:id", async (request) => {
    const user = requireAdmin(request);
    const id = intParam((request.params as { id: string }).id);
    const [used] = await db.select({ id: mailMessages.id }).from(mailMessages).where(and(eq(mailMessages.mailboxId, id), inArray(mailMessages.status, ["sent"]))).limit(1);
    if (used) throw new HttpError(409, "С ящика уже отправлялись письма — поставьте его на паузу или «сожжён» вместо удаления");
    await db.delete(mailMessages).where(eq(mailMessages.mailboxId, id));
    const [row] = await db.delete(mailboxes).where(eq(mailboxes.id, id)).returning({ email: mailboxes.email });
    if (!row) throw new HttpError(404, "Ящик не найден");
    await audit(db, { userId: user.id, action: "delete", entityType: "mailbox", entityId: id, summary: `Рассылка: удалил ящик ${row.email}`, ip: request.ip });
    return { ok: true };
  });

  /** «Проверить подключение»: SMTP-логин, IMAP-логин, при testTo — тестовое письмо. */
  app.post("/mail/mailboxes/:id/check", async (request) => {
    requireAdmin(request);
    const id = intParam((request.params as { id: string }).id);
    const testTo = String(body<{ testTo: string }>(request).testTo ?? "").trim().toLowerCase();
    const m = await loadMailbox(db, id);
    const result: { smtp: string; imap: string; test: string | null } = { smtp: "", imap: "", test: null };
    const transport = makeTransport(m);
    try {
      await transport.verify();
      result.smtp = "ok";
    } catch (error) {
      result.smtp = error instanceof Error ? error.message : String(error);
    }
    try {
      await checkImap(m, decryptSecret(m.passwordEnc));
      result.imap = "ok";
    } catch (error) {
      result.imap = error instanceof Error ? error.message : String(error);
    }
    if (testTo && result.smtp === "ok") {
      if (!EMAIL_RE.test(testTo)) throw new HttpError(400, "Тестовый адрес — email");
      try {
        await transport.send(buildMail(m, { subject: "Проверка ящика", body: `Тестовое письмо с ${m.email}: SMTP работает.\n\n${m.signature}`, messageId: newMessageId(m.domain.domain), inReplyTo: null }, testTo));
        result.test = "ok";
      } catch (error) {
        result.test = error instanceof Error ? error.message : String(error);
      }
    }
    transport.close?.();
    return result;
  });

  /** Опросить входящие ящика сейчас (не ждать 5 минут). */
  app.post("/mail/mailboxes/:id/poll", async (request) => {
    guard(request);
    return pollMailbox(intParam((request.params as { id: string }).id));
  });

  // ── Шаблоны ──
  app.get("/mail/templates", async (request) => {
    guard(request);
    return { templates: await db.select().from(mailTemplates).orderBy(asc(mailTemplates.touch), asc(mailTemplates.id)) };
  });

  app.post("/mail/templates", async (request) => {
    const user = guard(request);
    const values = templateValues(body<TemplateInput>(request), false) as typeof mailTemplates.$inferInsert;
    const [row] = await db.insert(mailTemplates).values(values).returning();
    await audit(db, { userId: user.id, action: "create", entityType: "mail_template", entityId: row.id, summary: `Рассылка: шаблон «${row.name || row.subject}»`, ip: request.ip });
    return { template: row };
  });

  /** Правка текста — новая версия (в отправленных письмах записан номер версии). */
  app.patch("/mail/templates/:id", async (request) => {
    const user = guard(request);
    const id = intParam((request.params as { id: string }).id);
    const values = templateValues(body<TemplateInput>(request), true);
    const [old] = await db.select().from(mailTemplates).where(eq(mailTemplates.id, id));
    if (!old) throw new HttpError(404, "Шаблон не найден");
    const textChanged = (values.subject !== undefined && values.subject !== old.subject) || (values.body !== undefined && values.body !== old.body);
    const [row] = await db
      .update(mailTemplates)
      .set({ ...values, ...(textChanged ? { version: old.version + 1 } : {}), updatedAt: new Date() })
      .where(eq(mailTemplates.id, id))
      .returning();
    await audit(db, { userId: user.id, action: "update", entityType: "mail_template", entityId: id, summary: `Рассылка: шаблон «${row.name || row.subject}»${textChanged ? `, версия ${row.version}` : ""}`, ip: request.ip });
    return { template: row };
  });

  app.delete("/mail/templates/:id", async (request) => {
    const user = guard(request);
    const id = intParam((request.params as { id: string }).id);
    const [used] = await db.select({ id: mailMessages.id }).from(mailMessages).where(eq(mailMessages.templateId, id)).limit(1);
    if (used) {
      await db.update(mailTemplates).set({ active: false, updatedAt: new Date() }).where(eq(mailTemplates.id, id));
      return { ok: true, deactivated: true };
    }
    await db.delete(mailTemplates).where(eq(mailTemplates.id, id));
    await audit(db, { userId: user.id, action: "delete", entityType: "mail_template", entityId: id, summary: "Рассылка: удалил шаблон", ip: request.ip });
    return { ok: true };
  });

  /** Предпросмотр: продавец + ящик + шаблон (или подбор как при отправке) → итоговое письмо. */
  app.post("/mail/preview", async (request) => {
    guard(request);
    const input = body<{ inn: string; mailboxId: number; templateId: number | null; touch: "first" | "followup" }>(request);
    const mailboxId = Number(input.mailboxId) || (await db.select({ id: mailboxes.id }).from(mailboxes).orderBy(asc(mailboxes.id)).limit(1))[0]?.id;
    if (!mailboxId) throw new HttpError(400, "Сначала добавьте ящик (Рассылка → Ящики)");
    const m = await loadMailbox(db, mailboxId);
    const touch = input.touch === "followup" ? "followup" : "first";
    const r = await renderForSeller(db, String(input.inn ?? ""), m, touch, { templateId: input.templateId ? Number(input.templateId) : undefined });
    return { subject: r.subject, body: r.body, variants: r.variants, templateId: r.template.id, from: `${m.fromName || m.email} <${m.email}>` };
  });

  /** Тест цепочки: первое письмо и повтор (Re:, In-Reply-To) продавцу — на тестовый адрес, сразу. Воронка не меняется. */
  app.post("/mail/test-chain", async (request) => {
    const user = guard(request);
    const input = body<{ inn: string; mailboxId: number }>(request);
    const s = await getMailSettings(db);
    if (!s.testAddress) throw new HttpError(400, "Задайте тестовый адрес в настройках рассылки");
    const m = await loadMailbox(db, Number(input.mailboxId));
    const inn = String(input.inn ?? "");
    const day = dayInZone(new Date(), s.timezone);
    const first = await renderForSeller(db, inn, m, "first");
    const insert = async (touch: "first" | "followup", r: Awaited<ReturnType<typeof renderForSeller>>, inReplyTo: string | null) =>
      (
        await db
          .insert(mailMessages)
          .values({ sellerInn: inn, mailboxId: m.id, toEmail: s.testAddress, touch, templateId: r.template.id, templateVersion: r.template.version, subject: r.subject, body: r.body, variants: r.variants, messageId: newMessageId(m.domain.domain), inReplyTo, planDay: day, scheduledAt: new Date() })
          .returning()
      )[0];
    const a = await insert("first", first, null);
    const ra = await sendOne(a.id, new Date(), { force: true });
    if (ra.status !== "sent") return { first: ra };
    const follow = await renderForSeller(db, inn, m, "followup", { firstSubject: first.subject });
    const b = await insert("followup", follow, a.messageId);
    const rb = await sendOne(b.id, new Date(), { force: true });
    await audit(db, { userId: user.id, action: "create", entityType: "mail", entityId: null, summary: `Рассылка: тест цепочки ${m.email} → ${s.testAddress}`, ip: request.ip });
    return { first: ra, followup: rb };
  });

  // ── Входящие ──
  app.get("/mail/inbound", async (request) => {
    guard(request);
    const q = request.query as { kind?: string; unresolved?: string; days?: string };
    const since = addDaysIso(new Date().toISOString().slice(0, 10), -Math.min(365, Math.max(1, Number(q.days) || 30)));
    const rows = await db
      .select({
        id: mailInbound.id,
        mailbox: mailboxes.email,
        fromEmail: mailInbound.fromEmail,
        fromName: mailInbound.fromName,
        subject: mailInbound.subject,
        receivedAt: mailInbound.receivedAt,
        kind: mailInbound.kind,
        sellerInn: mailInbound.sellerInn,
        brand: sql<string | null>`${leadSellers.brands}[1]`,
        legalName: leadSellers.legalName,
        sellerStatus: leadSellers.status,
        bouncedEmail: mailInbound.bouncedEmail,
        text: mailInbound.text,
        refusalHint: mailInbound.refusalHint,
        resolution: mailInbound.resolution,
      })
      .from(mailInbound)
      .innerJoin(mailboxes, eq(mailboxes.id, mailInbound.mailboxId))
      .leftJoin(leadSellers, eq(leadSellers.inn, mailInbound.sellerInn))
      .where(
        and(
          gte(mailInbound.createdAt, new Date(`${since}T00:00:00Z`)),
          q.kind ? eq(mailInbound.kind, q.kind) : undefined,
          q.unresolved === "1" ? sql`${mailInbound.resolution} is null` : undefined,
        ),
      )
      .orderBy(desc(mailInbound.id))
      .limit(500);
    return { inbound: rows };
  });

  /** Разбор ответа человеком: «Ответил +», «Ответил −», «Отказ — в стоп-лист». */
  app.post("/mail/inbound/:id/resolve", async (request) => {
    const user = guard(request);
    const id = intParam((request.params as { id: string }).id);
    const resolution = body<{ resolution: string }>(request).resolution;
    if (!["replied_pos", "replied_neg", "stop"].includes(String(resolution))) throw new HttpError(400, "Неизвестное решение");
    const [row] = await db.select().from(mailInbound).where(eq(mailInbound.id, id));
    if (!row) throw new HttpError(404, "Письмо не найдено");
    if (!row.sellerInn) throw new HttpError(409, "Письмо не сопоставлено с продавцом");
    const ls = await getLeadgenSettings(db);
    await db.transaction(async (tx) => {
      const status = resolution === "replied_pos" ? "replied_pos" : "replied_neg";
      await setSellerStatus(tx, row.sellerInn!, status, user.id, resolution === "stop" ? "отказ — не писать (подтверждено)" : "по ответу на письмо", ls);
      if (resolution === "stop") await addToStopList(tx, { inn: row.sellerInn, reason: "отказ в ответе на письмо", userId: user.id });
      await tx.update(mailInbound).set({ resolution }).where(eq(mailInbound.id, id));
    });
    return { ok: true };
  });

  // ── Стоп-лист ──
  app.get("/mail/stoplist", async (request) => {
    guard(request);
    const rows = await db
      .select({ id: doNotContact.id, inn: doNotContact.inn, email: doNotContact.email, reason: doNotContact.reason, createdAt: doNotContact.createdAt, legalName: leadSellers.legalName })
      .from(doNotContact)
      .leftJoin(leadSellers, eq(leadSellers.inn, doNotContact.inn))
      .orderBy(desc(doNotContact.id))
      .limit(2000);
    return { stoplist: rows };
  });

  app.post("/mail/stoplist", async (request) => {
    const user = guard(request);
    const input = body<{ inn: string; email: string; reason: string }>(request);
    const inn = String(input.inn ?? "").replace(/\D/g, "") || null;
    const email = String(input.email ?? "").trim().toLowerCase() || null;
    if (!inn && !email) throw new HttpError(400, "Укажите ИНН или email");
    if (email && !EMAIL_RE.test(email)) throw new HttpError(400, "Некорректный email");
    await db.transaction(async (tx) => {
      await addToStopList(tx, { inn, email, reason: String(input.reason ?? "").trim().slice(0, 300) || "вручную", userId: user.id });
      if (inn) {
        const [seller] = await tx.select({ status: leadSellers.status }).from(leadSellers).where(eq(leadSellers.inn, inn));
        if (seller && seller.status !== "do_not_contact") await setSellerStatus(tx, inn, "do_not_contact", user.id, "стоп-лист рассылки", await getLeadgenSettings(tx));
      }
    });
    await audit(db, { userId: user.id, action: "create", entityType: "do_not_contact", entityId: null, summary: `Рассылка: в стоп-лист ${[inn, email].filter(Boolean).join(", ")}`, ip: request.ip });
    return { ok: true };
  });

  app.delete("/mail/stoplist/:id", async (request) => {
    const user = requireAdmin(request);
    const id = intParam((request.params as { id: string }).id);
    const [row] = await db.delete(doNotContact).where(eq(doNotContact.id, id)).returning();
    if (!row) throw new HttpError(404, "Запись не найдена");
    await audit(db, { userId: user.id, action: "delete", entityType: "do_not_contact", entityId: id, summary: `Рассылка: убрал из стоп-листа ${[row.inn, row.email].filter(Boolean).join(", ")}`, ip: request.ip });
    return { ok: true };
  });

  /** Категории: адрес страницы, {category}, {marking_note} — правятся здесь же, рядом с шаблонами. */
  app.get("/mail/categories", async (request) => {
    guard(request);
    return { categories: await db.select({ id: leadCategories.id, name: leadCategories.name, marking: leadCategories.marking, slug: leadCategories.slug, mailName: leadCategories.mailName, mailNote: leadCategories.mailNote }).from(leadCategories).orderBy(asc(leadCategories.sort)) };
  });

  app.patch("/mail/categories/:id", async (request) => {
    guard(request);
    const id = intParam((request.params as { id: string }).id);
    const input = body<{ slug: string; mailName: string; mailNote: string }>(request);
    const set: Partial<typeof leadCategories.$inferInsert> = { updatedAt: new Date() };
    if (input.slug !== undefined) {
      const slug = String(input.slug).trim().toLowerCase();
      if (!/^[a-z0-9-]{1,60}$/.test(slug)) throw new HttpError(400, "Адрес страницы — латиница, цифры, дефис");
      set.slug = slug;
    }
    if (input.mailName !== undefined) set.mailName = String(input.mailName).trim().slice(0, 120);
    if (input.mailNote !== undefined) {
      const note = String(input.mailNote).trim().slice(0, 500);
      if (mentionsMainDomain(note)) throw new HttpError(400, MAIN_DOMAIN_ERROR);
      set.mailNote = note;
    }
    const [row] = await db.update(leadCategories).set(set).where(eq(leadCategories.id, id)).returning({ id: leadCategories.id });
    if (!row) throw new HttpError(404, "Категория не найдена");
    return { ok: true };
  });
}
