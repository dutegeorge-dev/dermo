/**
 * Входящие ящиков рассылки (IMAP, раз в 5 минут): новые письма INBOX с последнего UID. Письма в ящике не удаляются,
 * не перемещаются и не отмечаются прочитанными (BODY.PEEK).
 * - Возврат (mailer-daemon / postmaster, multipart/report delivery-status, 5xx): адрес — невалидный; у продавца есть
 *   другой рабочий email — первое письмо уйдёт на него в следующем окне, иначе продавец — «возврат».
 * - Автоответ (Auto-Submitted, X-Autoreply, Precedence: auto_reply, «в отпуске»…): ничего не меняет.
 * - Ответ человека: продавец — «ответил», запланированные письма и повтор сняты, текст — в истории; подсказка
 *   «похоже на отказ». Положительный / отрицательный ставит человек.
 * Сопоставление: In-Reply-To / References → Message-ID отправленного; иначе — адрес отправителя среди адресов,
 * на которые писал этот ящик.
 */

import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { ImapFlow } from "imapflow";
import { type ParsedMail, simpleParser } from "mailparser";

import { addDaysIso, nextWorkday } from "../../../shared/leadgen.ts";
import { looksLikeRefusal } from "../../../shared/mail.ts";
import { db } from "../../db/client.ts";
import { leadContacts, leadQueue, leadSellers, mailboxes, mailInbound, mailMessages } from "../../db/schema.ts";
import { getLeadgenSettings, setSellerStatus } from "../leadgen/work.ts";
import { decryptSecret } from "./crypto.ts";
import { FINAL_STATUSES } from "./planner.ts";
import { cancelPlanned } from "./sender.ts";
import { loadMailbox, type MailboxFull } from "./render.ts";

export type FetchedMessage = { uid: number; source: Buffer };
export type FetchResult = { uidValidity: number; lastUid: number; messages: FetchedMessage[] };
export type ImapFetcher = (mailbox: MailboxFull, password: string, cursor: { uidValidity: number | null; lastUid: number | null }) => Promise<FetchResult>;

/** Настоящий IMAP (хост, порт — из полей ящика; Яндекс 360: imap.yandex.ru:993). Первый запуск — только запомнить курсор. */
export const imapFetcher: ImapFetcher = async (m, password, cursor) => {
  const client = new ImapFlow({ host: m.imapHost, port: m.imapPort, secure: m.imapPort === 993, auth: { user: m.imapUser, pass: password }, logger: false });
  await client.connect();
  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      const box = client.mailbox;
      if (!box) throw new Error("INBOX не открылся");
      const uidValidity = Number(box.uidValidity);
      const top = Number(box.uidNext) - 1;
      if (cursor.lastUid === null || cursor.uidValidity !== uidValidity) return { uidValidity, lastUid: top, messages: [] };
      const messages: FetchedMessage[] = [];
      if (top > cursor.lastUid) {
        for await (const msg of client.fetch(`${cursor.lastUid + 1}:*`, { uid: true, source: true }, { uid: true })) {
          if (msg.uid <= cursor.lastUid || !msg.source) continue;
          messages.push({ uid: msg.uid, source: msg.source.length > 3_000_000 ? msg.source.subarray(0, 3_000_000) : msg.source });
          if (messages.length >= 200) break;
        }
      }
      return { uidValidity, lastUid: messages.length ? Math.max(...messages.map((x) => x.uid)) : cursor.lastUid, messages };
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => client.close());
  }
};

let fetcher: ImapFetcher = imapFetcher;
export function setImapFetcher(f: ImapFetcher | null): void {
  fetcher = f ?? imapFetcher;
}

/** IMAP-логин без чтения писем — «Проверить подключение». */
export async function checkImap(m: MailboxFull, password: string): Promise<void> {
  const client = new ImapFlow({ host: m.imapHost, port: m.imapPort, secure: m.imapPort === 993, auth: { user: m.imapUser, pass: password }, logger: false });
  await client.connect();
  await client.logout().catch(() => client.close());
}

// ── Разбор письма ────────────────────────────────────────────────────────────

const header = (p: ParsedMail, name: string): string => {
  const v = p.headers.get(name);
  if (v === undefined || v === null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "object" && "value" in (v as object)) return String((v as { value: unknown }).value ?? "");
  return String(v);
};

const ids = (v: string | string[] | undefined) => (Array.isArray(v) ? v : v ? v.split(/\s+/) : []).map((x) => x.trim()).filter((x) => /^<.+>$/.test(x));

export type Classified = {
  kind: "human" | "auto" | "bounce";
  fromEmail: string;
  fromName: string;
  subject: string;
  messageId: string | null;
  refs: string[];
  bouncedEmail: string | null;
  text: string;
};

export function classify(p: ParsedMail): Classified {
  const from = p.from?.value?.[0];
  const fromEmail = (from?.address ?? "").toLowerCase();
  const subject = p.subject ?? "";
  const ctype = header(p, "content-type").toLowerCase();
  const reportType = String((p.headers.get("content-type") as { params?: Record<string, string> } | undefined)?.params?.["report-type"] ?? "").toLowerCase();
  // Текст самого письма + вложенные части DSN (message/delivery-status, rfc822-headers) — там исходный Message-ID.
  const parts = [p.text ?? "", ...p.attachments.filter((a) => /message\/|text\/rfc822|delivery-status/i.test(a.contentType)).map((a) => a.content.toString("utf8"))].join("\n");
  const refs = [...ids(p.inReplyTo), ...ids(p.references as string | string[] | undefined)];

  const bounce =
    /mailer-daemon|postmaster/i.test(fromEmail) ||
    (ctype.includes("multipart/report") && (reportType.includes("delivery-status") || /delivery-status/i.test(ctype))) ||
    (/undeliver|не доставлен|delivery status|returned mail|failure notice|delivery failure|недоставлен/i.test(subject) && /\b5\d\d\b|\b5\.\d\.\d+\b/.test(parts));
  if (bounce) {
    const original = [...parts.matchAll(/^\s*Message-ID:\s*(<[^>\s]+>)/gim)].map((m) => m[1]);
    const rcpt = /(?:Final|Original)-Recipient:\s*rfc822;\s*<?([^\s<>;]+@[^\s<>;]+)>?/i.exec(parts)?.[1] ?? /<([^\s<>]+@[^\s<>]+)>:?\s*\n?.*?\b5\d\d\b/i.exec(parts)?.[1] ?? null;
    return { kind: "bounce", fromEmail, fromName: from?.name ?? "", subject, messageId: p.messageId ?? null, refs: [...refs, ...original], bouncedEmail: rcpt?.toLowerCase() ?? null, text: (p.text ?? "").slice(0, 20000) };
  }
  const auto =
    (header(p, "auto-submitted") && !/^no$/i.test(header(p, "auto-submitted").trim())) ||
    Boolean(header(p, "x-autoreply") || header(p, "x-autorespond") || header(p, "x-autogenerated")) ||
    /auto_reply|auto-reply/i.test(header(p, "precedence")) ||
    /автоматическ\w* ответ|автоответ|в отпуске|out of office|auto(matic)?[- ]?reply|vacation/i.test(`${subject}\n${(p.text ?? "").slice(0, 600)}`);
  return { kind: auto ? "auto" : "human", fromEmail, fromName: from?.name ?? "", subject, messageId: p.messageId ?? null, refs, bouncedEmail: null, text: (p.text ?? "").slice(0, 20000) };
}

/** Текст ответа без цитаты (строки «> …» и всё после «… пишет:» / «On … wrote:»). */
export function stripQuote(text: string): string {
  const lines = text.split(/\r?\n/);
  const out: string[] = [];
  for (const l of lines) {
    if (/^\s*>/.test(l)) break;
    if (/(пишет|написал\(а\)|wrote):\s*$/i.test(l)) break;
    if (/^-{2,}\s*(Original Message|Исходное сообщение|Пересылаемое сообщение)/i.test(l)) break;
    out.push(l);
  }
  return out.join("\n").trim();
}

// ── Применение ───────────────────────────────────────────────────────────────

async function matchMessage(m: MailboxFull, c: Classified) {
  if (c.refs.length) {
    const [hit] = await db.select().from(mailMessages).where(inArray(mailMessages.messageId, c.refs)).orderBy(desc(mailMessages.id)).limit(1);
    if (hit) return hit;
  }
  const address = c.kind === "bounce" ? c.bouncedEmail : c.fromEmail;
  if (!address) return null;
  // По адресу — среди писем этого ящика (и тестовых: ответ с тестового адреса тоже сопоставляется).
  const [byAddr] = await db
    .select()
    .from(mailMessages)
    .where(and(eq(mailMessages.mailboxId, m.id), eq(mailMessages.status, "sent"), sql`(${mailMessages.toEmail} = ${address} or ${mailMessages.sentTo} = ${address})`))
    .orderBy(desc(mailMessages.sentAt))
    .limit(1);
  return byAddr ?? null;
}

export async function processMessage(m: MailboxFull, uidValidity: number, uid: number, source: Buffer, now = new Date()): Promise<typeof mailInbound.$inferSelect | null> {
  const parsed = await simpleParser(source, { skipHtmlToText: false, skipImageLinks: true });
  const c = classify(parsed);
  const sent = await matchMessage(m, c);
  const inn = sent?.sellerInn ?? null;
  const reply = c.kind === "human" ? stripQuote(c.text) || c.text : c.text;
  const [row] = await db
    .insert(mailInbound)
    .values({
      mailboxId: m.id,
      uidValidity,
      uid,
      messageId: c.messageId,
      fromEmail: c.fromEmail,
      fromName: c.fromName.slice(0, 200),
      subject: c.subject.slice(0, 500),
      receivedAt: parsed.date ?? now,
      kind: c.kind,
      replyToMessageId: sent?.id ?? null,
      sellerInn: inn,
      bouncedEmail: c.bouncedEmail,
      text: reply.slice(0, 20000),
      refusalHint: c.kind === "human" && looksLikeRefusal(reply),
    })
    .onConflictDoNothing()
    .returning();
  if (!row) return null; // уже разобрано

  const ls = await getLeadgenSettings(db);
  if (c.kind === "human" && inn) {
    const [seller] = await db.select().from(leadSellers).where(eq(leadSellers.inn, inn));
    await db.transaction(async (tx) => {
      await cancelPlanned(tx, inn, "продавец ответил");
      if (seller && !FINAL_STATUSES.includes(seller.status)) {
        await setSellerStatus(tx, inn, "replied", null, `ответ на письмо (${m.email}): ${reply.slice(0, 1500)}`, ls, now);
      } else {
        await tx.execute(sql`insert into lead_events (seller_inn, type, comment, created_at) values (${inn}, 'reply', ${`ответ на письмо (${m.email}): ${reply.slice(0, 1500)}`}, ${now})`);
      }
    });
  }
  if (c.kind === "bounce") {
    const address = c.bouncedEmail ?? (sent && sent.mode === "live" ? sent.toEmail : null);
    // Только адреса продавцов: возврат с тестового адреса контакты не трогает.
    const contacts = address ? await db.select().from(leadContacts).where(and(eq(leadContacts.type, "email"), eq(leadContacts.value, address))) : [];
    for (const contact of contacts) {
      await db.update(leadContacts).set({ valid: false, note: `возврат ${now.toISOString().slice(0, 10)}` }).where(eq(leadContacts.id, contact.id));
      const sInn = contact.sellerInn;
      await db.transaction(async (tx) => {
        await cancelPlanned(tx, sInn, "возврат", address!);
        const [other] = await tx
          .select({ id: leadContacts.id })
          .from(leadContacts)
          .where(and(eq(leadContacts.sellerInn, sInn), eq(leadContacts.type, "email"), eq(leadContacts.valid, true)))
          .limit(1);
        const [seller] = await tx.select().from(leadSellers).where(eq(leadSellers.inn, sInn));
        if (!seller || FINAL_STATUSES.includes(seller.status)) return;
        if (other) {
          // Есть другой адрес — повтор снимаем, первое письмо — на него в следующем окне.
          await tx.update(leadQueue).set({ status: "cancelled", note: "возврат — пишем на другой адрес" }).where(and(eq(leadQueue.sellerInn, sInn), eq(leadQueue.status, "planned")));
          await tx.insert(leadQueue).values({ sellerInn: sInn, plannedDate: nextWorkday(addDaysIso(now.toISOString().slice(0, 10), 1), ls), touch: "first", note: `возврат с ${address} — другой адрес` });
          await tx.execute(sql`insert into lead_events (seller_inn, type, comment, created_at) values (${sInn}, 'bounce', ${`возврат: ${address} — следующее письмо на другой адрес`}, ${now})`);
        } else {
          await setSellerStatus(tx, sInn, "bounced", null, `возврат: ${address}`, ls, now);
        }
      });
    }
  }
  return row;
}

/** Опрос одного ящика: новые письма с последнего UID. */
export async function pollMailbox(id: number, now = new Date()): Promise<{ fetched: number; processed: number }> {
  const m = await loadMailbox(db, id);
  try {
    const res = await fetcher(m, decryptSecret(m.passwordEnc), { uidValidity: m.imapUidValidity, lastUid: m.imapLastUid });
    let processed = 0;
    for (const msg of res.messages.sort((a, b) => a.uid - b.uid)) {
      if (await processMessage(m, res.uidValidity, msg.uid, msg.source, now)) processed++;
    }
    await db.update(mailboxes).set({ imapUidValidity: res.uidValidity, imapLastUid: res.lastUid, imapCheckedAt: now, imapError: null }).where(eq(mailboxes.id, id));
    return { fetched: res.messages.length, processed };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db.update(mailboxes).set({ imapCheckedAt: now, imapError: message.slice(0, 500) }).where(eq(mailboxes.id, id));
    throw error;
  }
}

/** Опрос всех ящиков, кроме сожжённых (ответы на паузе тоже нужны). */
export async function pollAll(now = new Date(), log: (m: string) => void = () => {}): Promise<void> {
  for (const m of await db.select({ id: mailboxes.id, email: mailboxes.email, status: mailboxes.status }).from(mailboxes)) {
    if (m.status === "burned") continue;
    try {
      const r = await pollMailbox(m.id, now);
      if (r.fetched) log(`Рассылка: ${m.email} — входящих ${r.fetched}`);
    } catch (error) {
      log(`Рассылка: ${m.email} — IMAP: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
