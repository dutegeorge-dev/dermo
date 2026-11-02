/**
 * Заявка текстом (из бота Telegram) → лид в воронке. Модель только переписывает письмо в поля (компания, контакт,
 * что хочет клиент, тип заявки); клиента и контакт ищет и заводит код: ИНН → почта → телефон → домен почты →
 * название. Новый лид — в первом этапе воронки, исходный текст целиком — в описании.
 */

import type Anthropic from "@anthropic-ai/sdk";
import { and, asc, count, eq, gt, inArray, isNotNull, or, sql } from "drizzle-orm";

import { REQUEST_TYPES, type RequestType } from "../../shared/deal-fields.ts";
import type { DbOrTx } from "../db/client.ts";
import { contacts, counterparties, deals, documents, shipments } from "../db/schema.ts";
import { deleteAttachmentRows } from "../routes/files.ts";
import { type AiUsage, aiBase, aiClient, aiError, usageOf } from "./ai.ts";
import { matchCounterparty, normName } from "./ai-parse.ts";
import { audit } from "./audit.ts";
import { createDeal } from "./deals.ts";
import { HttpError } from "./http.ts";

const STR = { type: "string" } as const;
const TYPE_KEYS = Object.keys(REQUEST_TYPES) as RequestType[];

const LEAD_FIELDS = [
  "title",
  "product",
  "type",
  "summary",
  "companyName",
  "companyFullName",
  "companyKind",
  "inn",
  "country",
  "companyPhone",
  "companyEmail",
  "website",
  "contactName",
  "position",
  "phone",
  "email",
  "messenger",
  "messengerHandle",
] as const;

export const LEAD_REQUEST_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [...LEAD_FIELDS],
  properties: Object.fromEntries(
    LEAD_FIELDS.map((k) => [
      k,
      k === "type"
        ? { type: "string", enum: TYPE_KEYS }
        : k === "companyKind"
          ? { type: "string", enum: ["ooo", "ip", "foreign", "other", ""] }
          : k === "messenger"
            ? { type: "string", enum: ["telegram", "whatsapp", "max", "wechat", ""] }
            : STR,
    ]),
  ),
} as const;

const LEAD_PROMPT = `Ты разбираешь входящую заявку клиента (письмо, сообщение из мессенджера, пересланный текст) для CRM компании ООО «ТЛК БАРС»: закупка товаров в Китае и доставка в Россию «под ключ» — поиск фабрики, закупка, перевозка, таможня. Перепиши заявку в поля. Только то, что написано; ничего не придумывай; нет значения — пустая строка.
- title — короткое название лида по-русски, до 80 символов: что нужно клиенту («Выкуп товара в КНР через китайскую компанию, CIP Москва», «Искусственная трава 35 мм, 2 контейнера»). Без названия клиента.
- product — что хочет клиент одной строкой: товар и услуга («Китайская компания-посредник: выкуп у производителя в КНР, экспорт, оплата в ВТБ Шанхай»).
- type — тип заявки:
  turnkey — купить товар в Китае и привезти «под ключ» (мы ищем / выкупаем, везём, растаможиваем); обычная заявка на товар;
  supply — клиент хочет купить у нас товар с доставкой (мы продаём ему по договору поставки, в рублях);
  teu — товар клиент покупает сам, от нас — только перевозка, таможенное оформление, ТЭУ;
  agent — нужен посредник / платёжный агент в Китае: выкупить у китайского производителя внутри КНР, оплатить поставщику, выступить экспортёром или продавцом по контракту;
  search — найти товар или фабрику, подобрать производителя, узнать цены;
  certification — сертификаты / декларации соответствия, испытания образцов, разрешительные документы (без закупки партии);
  other — не про закупку и доставку (сотрудничество, реклама, вакансии, спам).
- summary — суть для менеджера по-русски, 2–5 коротких строк через перевод строки: что просят, условия (Incoterms, валюта, банк, сроки, объёмы), на какие вопросы клиент ждёт ответа.
- Компания клиента: companyName — коротко, как пишут в документах («ООО «Пример»», «ИП Иванова И.И.»); companyFullName — полное, если есть; companyKind — ooo (ООО, АО и др. юрлица РФ), ip (ИП), foreign (иностранная), other; inn — ИНН, если указан; country — страна, если не Россия; companyPhone — общий телефон компании (многоканальный, 8 800), companyEmail — общий ящик (info@, sales@), website — сайт.
- Контактное лицо (кто пишет, обычно в подписи): contactName — ФИО как в подписи («Иванов Иван»); position — должность; phone — его телефон (мобильный или прямой; если телефон в подписи один — сюда); email — его почта (адрес из подписи или mailto:); messenger и messengerHandle — если указан мессенджер (@ник или номер).
- Наша компания (ООО «ТЛК БАРС», BARS TRADING) — никогда не клиент.`;

export type LeadDraft = Record<(typeof LEAD_FIELDS)[number], string> & { type: RequestType };

/** Ответ модели → черновик: строки обрезаны, тип — из списка (иначе «Другое»). */
export function leadDraft(raw: unknown): LeadDraft {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out = {} as Record<string, string>;
  for (const k of LEAD_FIELDS) out[k] = typeof r[k] === "string" ? (r[k] as string).trim().slice(0, k === "summary" ? 3000 : 500) : "";
  if (!TYPE_KEYS.includes(out.type as RequestType)) out.type = "other";
  out.inn = out.inn.replace(/\D/g, "");
  if (out.inn.length !== 10 && out.inn.length !== 12) out.inn = "";
  for (const k of ["email", "companyEmail"] as const) {
    const m = /[\w.+-]+@[\w-]+(\.[\w-]+)+/.exec(out[k]);
    out[k] = m ? m[0].toLowerCase() : "";
  }
  // Мы — не клиент (модель иногда путает подпись нашего менеджера в пересланной переписке).
  if (/тлк\s*барс|bars\s*trading/i.test(out.companyName)) {
    out.companyName = "";
    out.companyFullName = "";
    out.inn = "";
  }
  return out as LeadDraft;
}

export async function parseLeadRequest(text: string): Promise<{ draft: LeadDraft; usage: AiUsage }> {
  const content: Anthropic.Beta.BetaContentBlockParam[] = [{ type: "text", text: text.slice(0, 15000) }];
  let response: Anthropic.Beta.BetaMessage;
  try {
    response = await aiClient().beta.messages.create({
      ...aiBase(),
      max_tokens: 1500,
      thinking: { type: "disabled" },
      output_config: { effort: "low", format: { type: "json_schema", schema: LEAD_REQUEST_SCHEMA as unknown as Record<string, unknown> } },
      system: LEAD_PROMPT,
      messages: [{ role: "user", content }],
    });
  } catch (error) {
    throw aiError(error);
  }
  try {
    const raw = JSON.parse(response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join(""));
    return { draft: leadDraft(raw), usage: usageOf(response) };
  } catch {
    throw new HttpError(502, "ИИ вернул неразборчивый ответ — попробуйте ещё раз");
  }
}

// ── Клиент и контакт: поиск кодом ─────────────────────────────────────────

/** Почтовые сервисы: по их домену компанию не ищем. */
const PUBLIC_MAIL =
  /^(gmail\.com|googlemail\.com|mail\.ru|bk\.ru|list\.ru|inbox\.ru|internet\.ru|yandex\.(ru|com|by|kz|ua)|ya\.ru|rambler\.ru|lenta\.ru|outlook\.com|hotmail\.com|live\.com|icloud\.com|me\.com|yahoo\.com|proton\.me|protonmail\.com|qq\.com|163\.com|126\.com|foxmail\.com|aol\.com|gmx\.\w+|ukr\.net)$/i;

/** Последние 10 цифр телефона: «+7 (495) 000-11-22» и «8 495 0001122» — одно и то же. */
export const phoneKey = (s: string | null | undefined) => {
  const d = (s ?? "").replace(/\D/g, "");
  return d.length >= 10 ? d.slice(-10) : "";
};

const domainOf = (email: string) => {
  const d = email.split("@")[1]?.toLowerCase() ?? "";
  return d && !PUBLIC_MAIL.test(d) ? d : "";
};

/** ФИО без порядка слов: «Петров Пётр» = «Пётр Петров». */
const personKey = (s: string | null | undefined) => normName(s).split(" ").filter(Boolean).sort().join(" ");

const digitsSql = (col: unknown) => sql`regexp_replace(coalesce(${col}, ''), '\\D', '', 'g')`;

export type MatchedBy = "inn" | "email" | "phone" | "domain" | "name";
export const MATCHED_BY: Record<MatchedBy, string> = { inn: "по ИНН", email: "по почте", phone: "по телефону", domain: "по домену почты", name: "по названию" };

async function findClient(tx: DbOrTx, d: LeadDraft): Promise<{ id: number; by: MatchedBy } | null> {
  if (d.inn) {
    const [row] = await tx.select({ id: counterparties.id }).from(counterparties).where(eq(counterparties.inn, d.inn)).orderBy(asc(counterparties.id)).limit(1);
    if (row) return { id: row.id, by: "inn" };
  }
  const emails = [d.email, d.companyEmail].filter(Boolean);
  for (const email of emails) {
    const [c] = await tx
      .select({ id: contacts.counterpartyId })
      .from(contacts)
      .where(and(isNotNull(contacts.counterpartyId), sql`lower(${contacts.email}) = ${email}`))
      .limit(1);
    if (c?.id) return { id: c.id, by: "email" };
    const [cp] = await tx.select({ id: counterparties.id }).from(counterparties).where(sql`lower(${counterparties.email}) = ${email}`).limit(1);
    if (cp) return { id: cp.id, by: "email" };
  }
  for (const phone of [d.phone, d.companyPhone].map(phoneKey).filter(Boolean)) {
    const like = `%${phone}%`;
    const [c] = await tx
      .select({ id: contacts.counterpartyId })
      .from(contacts)
      .where(and(isNotNull(contacts.counterpartyId), sql`${digitsSql(contacts.phone)} like ${like}`))
      .limit(1);
    if (c?.id) return { id: c.id, by: "phone" };
    const [cp] = await tx.select({ id: counterparties.id }).from(counterparties).where(sql`${digitsSql(counterparties.phone)} like ${like}`).limit(1);
    if (cp) return { id: cp.id, by: "phone" };
  }
  for (const domain of [...new Set(emails.map(domainOf).filter(Boolean))]) {
    const at = `%@${domain}`;
    const [c] = await tx
      .select({ id: contacts.counterpartyId })
      .from(contacts)
      .where(and(isNotNull(contacts.counterpartyId), sql`lower(${contacts.email}) like ${at}`))
      .limit(1);
    if (c?.id) return { id: c.id, by: "domain" };
    const [cp] = await tx
      .select({ id: counterparties.id })
      .from(counterparties)
      .where(or(sql`lower(${counterparties.email}) like ${at}`, sql`lower(${counterparties.website}) like ${`%${domain}%`}`))
      .limit(1);
    if (cp) return { id: cp.id, by: "domain" };
  }
  if (d.companyName || d.companyFullName) {
    const rows = await tx
      .select({ id: counterparties.id, role: counterparties.role, name: counterparties.name, fullName: counterparties.fullName, inn: counterparties.inn, regNumber: counterparties.regNumber })
      .from(counterparties);
    const hit = matchCounterparty(rows, "client", { name: d.companyName, fullName: d.companyFullName });
    if (hit) return { id: hit.id, by: "name" };
  }
  return null;
}

async function findContact(tx: DbOrTx, clientId: number, d: LeadDraft) {
  const list = await tx.select().from(contacts).where(eq(contacts.counterpartyId, clientId)).orderBy(asc(contacts.id));
  const email = d.email;
  const phone = phoneKey(d.phone);
  const person = personKey(d.contactName);
  return (
    (email && list.find((c) => c.email?.toLowerCase() === email)) ||
    (phone && list.find((c) => c.phone && c.phone.replace(/\D/g, "").includes(phone))) ||
    (person && list.find((c) => personKey(c.name) === person)) ||
    null
  );
}

const MESSENGER_KEYS = ["telegram", "whatsapp", "max", "wechat"] as const;
type Messenger = (typeof MESSENGER_KEYS)[number];
const messengerOf = (s: string) => ((MESSENGER_KEYS as readonly string[]).includes(s) ? (s as Messenger) : null);

export type LeadResult = {
  deal: { id: number; key: string; title: string; stage: string };
  type: RequestType;
  client: { id: number; name: string; isNew: boolean; by: MatchedBy | null } | null;
  contact: { id: number; name: string; phone: string | null; email: string | null; isNew: boolean } | null;
};

/** Черновик заявки → клиент (найденный или новый), контакт, лид. Всё — в одной транзакции. */
/** Откуда заявка: бот (Telegram) или импорт (POST /intake/leads) — для источника, заметок и описания. */
export type LeadOrigin = { source: "telegram" | "intake"; by: string; statusKey?: string };

const originLabel = (o: LeadOrigin) => (o.source === "telegram" ? `Telegram, ${o.by}` : `импорт заявок, ${o.by}`);

export async function createLeadFromDraft(tx: DbOrTx, userId: number, d: LeadDraft, text: string, origin: LeadOrigin): Promise<LeadResult> {
  let client: LeadResult["client"] = null;
  const found = await findClient(tx, d);
  if (found) {
    const [cp] = await tx.select().from(counterparties).where(eq(counterparties.id, found.id));
    // Найденному — только пустые поля.
    const fill: Partial<typeof counterparties.$inferInsert> = {};
    if (!cp.inn && d.inn) fill.inn = d.inn;
    if (!cp.phone && d.companyPhone) fill.phone = d.companyPhone.slice(0, 60);
    if (!cp.email && d.companyEmail) fill.email = d.companyEmail;
    if (!cp.website && d.website) fill.website = d.website.slice(0, 200);
    if (Object.keys(fill).length) await tx.update(counterparties).set({ ...fill, updatedAt: new Date() }).where(eq(counterparties.id, cp.id));
    client = { id: cp.id, name: cp.name, isNew: false, by: found.by };
  } else if (d.companyName || d.companyFullName || d.contactName) {
    // Компании нет (частное лицо) — клиент по имени человека.
    const name = (d.companyName || d.companyFullName || d.contactName).slice(0, 300);
    const kind = d.companyName || d.companyFullName ? (d.companyKind as "ooo" | "ip" | "foreign" | "other") || (d.country && !/росси/i.test(d.country) ? "foreign" : "ooo") : "other";
    const [created] = await tx
      .insert(counterparties)
      .values({
        role: "client",
        kind,
        name,
        fullName: d.companyFullName || null,
        country: d.country || "Россия",
        inn: d.inn || null,
        phone: d.companyPhone.slice(0, 60) || null,
        email: d.companyEmail || null,
        website: d.website.slice(0, 200) || null,
        notes: `Создан из заявки (${originLabel(origin)})`,
        createdBy: userId,
      })
      .returning({ id: counterparties.id, name: counterparties.name });
    await audit(tx, { userId, action: "create", entityType: "counterparty", entityId: created.id, summary: `Бот заявок: создал клиента «${created.name}»` });
    client = { id: created.id, name: created.name, isNew: true, by: null };
  }

  let contact: LeadResult["contact"] = null;
  if (client && (d.contactName || d.email || d.phone)) {
    const existing = await findContact(tx, client.id, d);
    if (existing) {
      const fill: Partial<typeof contacts.$inferInsert> = {};
      if (!existing.phone && d.phone) fill.phone = d.phone.slice(0, 50);
      if (!existing.email && d.email) fill.email = d.email;
      if (!existing.position && d.position) fill.position = d.position.slice(0, 200);
      if (!existing.messenger && messengerOf(d.messenger)) {
        fill.messenger = messengerOf(d.messenger);
        fill.messengerHandle = d.messengerHandle.slice(0, 100) || null;
      }
      if (Object.keys(fill).length) await tx.update(contacts).set({ ...fill, updatedAt: new Date() }).where(eq(contacts.id, existing.id));
      contact = { id: existing.id, name: existing.name, phone: fill.phone ?? existing.phone, email: fill.email ?? existing.email, isNew: false };
    } else {
      const [{ n }] = await tx.select({ n: count() }).from(contacts).where(eq(contacts.counterpartyId, client.id));
      const [created] = await tx
        .insert(contacts)
        .values({
          counterpartyId: client.id,
          name: (d.contactName || d.email || d.phone).slice(0, 200),
          phone: d.phone.slice(0, 50) || null,
          email: d.email || null,
          position: d.position.slice(0, 200) || null,
          messenger: messengerOf(d.messenger),
          messengerHandle: d.messengerHandle.slice(0, 100) || null,
          isPrimary: n === 0,
        })
        .returning();
      contact = { id: created.id, name: created.name, phone: created.phone, email: created.email, isNew: true };
    }
  }

  const title = (d.title || text.split("\n").find((l) => l.trim())?.trim() || "Заявка").slice(0, 300);
  const description = [d.summary, `———\nТекст заявки (${originLabel(origin)}):\n${text}`].filter(Boolean).join("\n\n").slice(0, 20_000);
  const deal = await createDeal(
    tx,
    userId,
    {
      title,
      clientId: client?.id ?? null,
      contactId: contact?.id ?? null,
      product: d.product.slice(0, 500) || null,
      labels: [REQUEST_TYPES[d.type]],
      description,
      source: origin.source,
    },
    { statusKey: origin.statusKey },
  );
  const [stage] = await tx.execute<{ name: string }>(sql`select s.name from deal_statuses s join deals d on d.status_key = s.key where d.id = ${deal.id}`).then((r) => r.rows);
  return { deal: { id: deal.id, key: deal.key, title: deal.title, stage: stage?.name ?? "" }, type: d.type, client, contact };
}

/** Тот же текст уже присылали за последнюю неделю — лид не дублируем. */
export async function findDuplicateLead(tx: DbOrTx, text: string): Promise<{ key: string; title: string } | null> {
  const [row] = await tx
    .select({ key: deals.key, title: deals.title })
    .from(deals)
    .where(and(inArray(deals.source, ["telegram", "intake"]), gt(deals.createdAt, sql`now() - interval '7 days'`), sql`position(${text} in ${deals.description}) > 0`))
    .limit(1);
  return row ? { key: row.key!, title: row.title } : null;
}

/**
 * «Отменить» под ответом бота: удаляет лид и только что созданных клиента / контакт, если на них больше ничего
 * не ссылается. Отменить может тот, кто прислал заявку, или админ.
 */
export async function undoLead(
  tx: DbOrTx,
  user: { id: number; role: string },
  ids: { dealId: number; clientId: number | null; contactId: number | null },
): Promise<{ key: string; removed: string[]; keys: string[] }> {
  const [deal] = await tx.select().from(deals).where(and(eq(deals.id, ids.dealId), eq(deals.source, "telegram")));
  if (!deal) throw new HttpError(404, "Лид уже удалён");
  if (deal.createdBy !== user.id && user.role !== "admin") throw new HttpError(403, "Отменить может только тот, кто прислал заявку");
  const keys = await deleteAttachmentRows(tx, "deal", [deal.id]);
  await tx.delete(deals).where(eq(deals.id, deal.id));
  await audit(tx, { userId: user.id, action: "delete", entityType: "deal", entityId: deal.key, summary: `Бот заявок: отменил лид ${deal.key} «${deal.title}»`, data: deal });
  const removed: string[] = [];
  const fresh = sql`now() - interval '2 days'`;
  if (ids.clientId && ids.clientId === deal.clientId) {
    const [cp] = await tx.select().from(counterparties).where(and(eq(counterparties.id, ids.clientId), gt(counterparties.createdAt, fresh)));
    if (cp) {
      const [[d], [s], [doc]] = await Promise.all([
        tx.select({ n: count() }).from(deals).where(eq(deals.clientId, cp.id)),
        tx.select({ n: count() }).from(shipments).where(or(eq(shipments.clientId, cp.id), eq(shipments.supplierId, cp.id))),
        tx.select({ n: count() }).from(documents).where(or(eq(documents.counterpartyId, cp.id), eq(documents.clientId, cp.id))),
      ]);
      if (d.n + s.n + doc.n === 0) {
        await tx.delete(counterparties).where(eq(counterparties.id, cp.id));
        await audit(tx, { userId: user.id, action: "delete", entityType: "counterparty", entityId: cp.id, summary: `Бот заявок: удалил клиента «${cp.name}» (отмена заявки)`, data: cp });
        removed.push(`клиент «${cp.name}»`);
      }
    }
  }
  if (ids.contactId && ids.contactId === deal.contactId && !removed.length) {
    const [c] = await tx.select().from(contacts).where(and(eq(contacts.id, ids.contactId), gt(contacts.createdAt, fresh)));
    if (c) {
      const [[d], [s]] = await Promise.all([
        tx.select({ n: count() }).from(deals).where(eq(deals.contactId, c.id)),
        tx.select({ n: count() }).from(shipments).where(eq(shipments.contactId, c.id)),
      ]);
      if (d.n + s.n === 0) {
        await tx.delete(contacts).where(eq(contacts.id, c.id));
        removed.push(`контакт «${c.name}»`);
      }
    }
  }
  return { key: deal.key!, removed, keys };
}
