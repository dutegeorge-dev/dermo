/**
 * Работа с базой продавцов: «Сегодня» (первые письма по плану + повторы), смена статусов с историей и повторами,
 * «Итоги» по категориям, список «База» с фильтрами, экспорт XLSX / CSV, настройки модуля.
 */

import { and, asc, desc, eq, inArray, lte, type SQL, sql } from "drizzle-orm";
import JSZip from "jszip";

import {
  addDaysIso,
  CONTACT_SOURCES,
  type ContactSource,
  DEFAULT_LEADGEN_SETTINGS,
  isoDay,
  type LeadgenSettings,
  nextWorkday,
  normalizeSettings,
  pct,
  type ProductSample,
  SELLER_STATUSES,
  type SellerStatus,
} from "../../../shared/leadgen.ts";
import type { DbOrTx } from "../../db/client.ts";
import { leadCategories, leadContacts, leadEvents, leadQueue, leadSellers, settings as settingsTable } from "../../db/schema.ts";
import { HttpError } from "../http.ts";

export const SETTINGS_KEY = "leadgen";

export async function getLeadgenSettings(tx: DbOrTx): Promise<LeadgenSettings> {
  const [row] = await tx.select().from(settingsTable).where(eq(settingsTable.key, SETTINGS_KEY));
  return row ? normalizeSettings(row.value) : { ...DEFAULT_LEADGEN_SETTINGS };
}

export async function setLeadgenSettings(tx: DbOrTx, value: unknown, userId: number): Promise<LeadgenSettings> {
  const next = normalizeSettings(value);
  await tx
    .insert(settingsTable)
    .values({ key: SETTINGS_KEY, value: next, updatedBy: userId })
    .onConflictDoUpdate({ target: settingsTable.key, set: { value: next, updatedBy: userId, updatedAt: new Date() } });
  return next;
}

export type LeadContact = { id: number; type: string; value: string; source: ContactSource; valid: boolean; note: string | null; receivedAt: string };

export type LeadSellerDto = {
  inn: string;
  legalName: string;
  kind: string;
  ogrn: string | null;
  brands: string[];
  wbSupplierIds: number[];
  managerName: string | null;
  managerPost: string | null;
  regDate: string | null;
  okved: string | null;
  region: string | null;
  address: string | null;
  egrStatus: string | null;
  skuCount: number | null;
  feedbacksTotal: number | null;
  chinaShare: number | null;
  products: ProductSample[];
  categoryId: number | null;
  categoryName: string | null;
  batchMonth: string;
  status: SellerStatus;
  firstLine: string;
  firstSentAt: string | null;
  createdAt: string;
  contacts: LeadContact[];
};

const sellerColumns = {
  inn: leadSellers.inn,
  legalName: leadSellers.legalName,
  kind: leadSellers.kind,
  ogrn: leadSellers.ogrn,
  brands: leadSellers.brands,
  wbSupplierIds: leadSellers.wbSupplierIds,
  managerName: leadSellers.managerName,
  managerPost: leadSellers.managerPost,
  regDate: sql<string | null>`${leadSellers.regDate}::text`,
  okved: leadSellers.okved,
  region: leadSellers.region,
  address: leadSellers.address,
  egrStatus: leadSellers.egrStatus,
  skuCount: leadSellers.skuCount,
  feedbacksTotal: leadSellers.feedbacksTotal,
  chinaShare: leadSellers.chinaShare,
  products: leadSellers.products,
  categoryId: leadSellers.categoryId,
  categoryName: leadCategories.name,
  batchMonth: leadSellers.batchMonth,
  status: leadSellers.status,
  firstLine: leadSellers.firstLine,
  firstSentAt: sql<string | null>`${leadSellers.firstSentAt}::text`,
  createdAt: sql<string>`${leadSellers.createdAt}::text`,
};

async function withContacts<T extends { inn: string }>(tx: DbOrTx, rows: T[]): Promise<(T & { contacts: LeadContact[] })[]> {
  if (!rows.length) return [];
  const contacts = await tx
    .select({
      id: leadContacts.id,
      inn: leadContacts.sellerInn,
      type: leadContacts.type,
      value: leadContacts.value,
      source: leadContacts.source,
      valid: leadContacts.valid,
      note: leadContacts.note,
      receivedAt: sql<string>`${leadContacts.receivedAt}::text`,
    })
    .from(leadContacts)
    .where(inArray(leadContacts.sellerInn, rows.map((r) => r.inn)))
    .orderBy(asc(leadContacts.type), desc(leadContacts.valid), asc(leadContacts.id));
  return rows.map((r) => ({ ...r, contacts: contacts.filter((c) => c.inn === r.inn).map(({ inn: _inn, ...c }) => ({ ...c, source: c.source as ContactSource })) }));
}

export type SellerFilter = { categoryId?: number; month?: string; status?: string; hasPhone?: boolean; hasEmail?: boolean; q?: string };

export function parseSellerFilter(query: Record<string, unknown>): SellerFilter {
  const yes = (v: unknown) => (v === "1" || v === "true" ? true : v === "0" || v === "false" ? false : undefined);
  const id = Number(query.category);
  return {
    categoryId: Number.isSafeInteger(id) && id > 0 ? id : undefined,
    month: typeof query.month === "string" && /^\d{4}-\d{2}$/.test(query.month) ? query.month : undefined,
    status: typeof query.status === "string" && query.status in SELLER_STATUSES ? query.status : undefined,
    hasPhone: yes(query.phone),
    hasEmail: yes(query.email),
    q: typeof query.q === "string" && query.q.trim() ? query.q.trim().slice(0, 100) : undefined,
  };
}

function filterWhere(f: SellerFilter): SQL | undefined {
  const has = (type: string, valid: boolean) =>
    sql`exists (select 1 from lead_contacts c where c.seller_inn = ${leadSellers.inn} and c.type = ${type}${valid ? sql` and c.valid` : sql``})`;
  const conds: (SQL | undefined)[] = [
    f.categoryId ? eq(leadSellers.categoryId, f.categoryId) : undefined,
    f.month ? eq(leadSellers.batchMonth, f.month) : undefined,
    f.status ? eq(leadSellers.status, f.status) : undefined,
    f.hasPhone === true ? has("phone", false) : f.hasPhone === false ? sql`not ${has("phone", false)}` : undefined,
    f.hasEmail === true ? has("email", true) : f.hasEmail === false ? sql`not ${has("email", true)}` : undefined,
    f.q
      ? sql`(${leadSellers.inn} like ${`${f.q.replace(/\D/g, "") || "—"}%`} or ${leadSellers.legalName} ilike ${`%${f.q}%`} or array_to_string(${leadSellers.brands}, ' ') ilike ${`%${f.q}%`})`
      : undefined,
  ];
  return and(...conds.filter(Boolean));
}

export async function listSellers(tx: DbOrTx, f: SellerFilter, limit = 200, offset = 0): Promise<{ sellers: LeadSellerDto[]; total: number }> {
  const where = filterWhere(f);
  const [{ total }] = await tx.select({ total: sql<number>`count(*)::int` }).from(leadSellers).where(where);
  const rows = await tx
    .select(sellerColumns)
    .from(leadSellers)
    .leftJoin(leadCategories, eq(leadCategories.id, leadSellers.categoryId))
    .where(where)
    .orderBy(desc(leadSellers.batchMonth), asc(leadCategories.sort), asc(leadSellers.legalName))
    .limit(limit)
    .offset(offset);
  return { sellers: (await withContacts(tx, rows)) as LeadSellerDto[], total };
}

export async function getSeller(tx: DbOrTx, inn: string) {
  const rows = await tx.select(sellerColumns).from(leadSellers).leftJoin(leadCategories, eq(leadCategories.id, leadSellers.categoryId)).where(eq(leadSellers.inn, inn));
  if (!rows.length) throw new HttpError(404, "Продавец не найден");
  const [seller] = (await withContacts(tx, rows)) as LeadSellerDto[];
  const events = await tx
    .select({ id: leadEvents.id, type: leadEvents.type, comment: leadEvents.comment, createdAt: sql<string>`${leadEvents.createdAt}::text`, userId: leadEvents.userId })
    .from(leadEvents)
    .where(eq(leadEvents.sellerInn, inn))
    .orderBy(desc(leadEvents.createdAt), desc(leadEvents.id));
  const queue = await tx
    .select({ id: leadQueue.id, plannedDate: sql<string>`${leadQueue.plannedDate}::text`, touch: leadQueue.touch, status: leadQueue.status, sentAt: sql<string | null>`${leadQueue.sentAt}::text` })
    .from(leadQueue)
    .where(eq(leadQueue.sellerInn, inn))
    .orderBy(asc(leadQueue.plannedDate));
  return { seller, events, queue };
}

// ── «Сегодня» ────────────────────────────────────────────────────────────────

export type TodayItem = LeadSellerDto & { queueId: number; touch: "first" | "followup"; plannedDate: string };

/**
 * На день: первые письма по плану (сегодня и не сделанные раньше — по порядку раскладки, не больше perDay) и
 * повторы, срок которых подошёл (followupDays после первого письма, если нет ответа).
 */
export async function todayList(tx: DbOrTx, day: string, s: LeadgenSettings): Promise<{ day: string; first: TodayItem[]; followups: TodayItem[]; firstLeft: number }> {
  const pick = (touch: "first" | "followup", limit: number) =>
    tx
      .select({ ...sellerColumns, queueId: leadQueue.id, touch: leadQueue.touch, plannedDate: sql<string>`${leadQueue.plannedDate}::text` })
      .from(leadQueue)
      .innerJoin(leadSellers, eq(leadSellers.inn, leadQueue.sellerInn))
      .leftJoin(leadCategories, eq(leadCategories.id, leadSellers.categoryId))
      .where(and(eq(leadQueue.status, "planned"), eq(leadQueue.touch, touch), lte(leadQueue.plannedDate, day)))
      .orderBy(asc(leadQueue.plannedDate), asc(leadQueue.position), asc(leadQueue.id))
      .limit(limit);
  const first = await pick("first", s.perDay);
  const followups = await pick("followup", 500);
  const [{ n }] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(leadQueue)
    .where(and(eq(leadQueue.status, "planned"), eq(leadQueue.touch, "first"), lte(leadQueue.plannedDate, day)));
  return {
    day,
    first: (await withContacts(tx, first)) as TodayItem[],
    followups: (await withContacts(tx, followups)) as TodayItem[],
    firstLeft: n,
  };
}

/** Смена статуса: история, отметка касаний в очереди, повтор через followupDays после первого письма. */
export async function setSellerStatus(tx: DbOrTx, inn: string, status: SellerStatus, userId: number, comment: string | null, s: LeadgenSettings, now = new Date()): Promise<void> {
  if (!(status in SELLER_STATUSES)) throw new HttpError(400, "Неизвестный статус");
  const [seller] = await tx.select().from(leadSellers).where(eq(leadSellers.inn, inn));
  if (!seller) throw new HttpError(404, "Продавец не найден");
  const today = isoDay(now);
  const closeTouch = (touch: string) =>
    tx
      .update(leadQueue)
      .set({ status: "done", sentAt: now })
      .where(and(eq(leadQueue.sellerInn, inn), eq(leadQueue.touch, touch), eq(leadQueue.status, "planned")));

  const patch: Partial<typeof leadSellers.$inferInsert> = { status, updatedAt: now };
  if (status === "sent") {
    await closeTouch("first");
    if (!seller.firstSentAt) patch.firstSentAt = now;
    const [pending] = await tx.select({ id: leadQueue.id }).from(leadQueue).where(and(eq(leadQueue.sellerInn, inn), eq(leadQueue.touch, "followup")));
    if (!pending) {
      await tx.insert(leadQueue).values({ sellerInn: inn, plannedDate: nextWorkday(addDaysIso(today, s.followupDays), s), touch: "followup" });
    }
  } else if (status === "followup_sent") {
    await closeTouch("first");
    if (!seller.firstSentAt) patch.firstSentAt = now;
    const done = await tx
      .update(leadQueue)
      .set({ status: "done", sentAt: now })
      .where(and(eq(leadQueue.sellerInn, inn), eq(leadQueue.touch, "followup"), eq(leadQueue.status, "planned")))
      .returning({ id: leadQueue.id });
    if (!done.length) await tx.insert(leadQueue).values({ sellerInn: inn, plannedDate: today, touch: "followup", status: "done", sentAt: now });
  } else if (status === "new") {
    // Вернуть «не писали»: снова в план на сегодня, повтор снимается.
    await tx.update(leadQueue).set({ status: "cancelled" }).where(and(eq(leadQueue.sellerInn, inn), eq(leadQueue.status, "planned")));
    await tx.insert(leadQueue).values({ sellerInn: inn, plannedDate: today, touch: "first" });
    patch.firstSentAt = null;
  } else {
    // Ответил / возврат / «Не писать» — больше не пишем: незакрытые касания снимаются.
    await tx.update(leadQueue).set({ status: "cancelled" }).where(and(eq(leadQueue.sellerInn, inn), eq(leadQueue.status, "planned")));
  }
  await tx.update(leadSellers).set(patch).where(eq(leadSellers.inn, inn));
  await tx.insert(leadEvents).values({ sellerInn: inn, type: status, comment: comment?.trim().slice(0, 2000) || null, userId, createdAt: now });
}

// ── «Итоги» ──────────────────────────────────────────────────────────────────

export type StatsRow = { categoryId: number | null; name: string; sellers: number; sent: number; bounced: number; replies: number; positive: number; negative: number; doNotContact: number; bouncedPct: number; repliesPct: number; positivePct: number };

/** По категориям: отправлено (первое письмо), возвраты, ответы, положительные — по истории событий. */
export async function stats(tx: DbOrTx, month?: string): Promise<StatsRow[]> {
  const ev = (type: string) => sql`exists (select 1 from lead_events e where e.seller_inn = ${leadSellers.inn} and e.type = ${type})`;
  const rows = await tx
    .select({
      categoryId: leadSellers.categoryId,
      name: sql<string>`coalesce(${leadCategories.name}, 'Без категории')`,
      sort: sql<number>`coalesce(min(${leadCategories.sort}), 999)`,
      sellers: sql<number>`count(*)::int`,
      sent: sql<number>`count(*) filter (where ${leadSellers.firstSentAt} is not null)::int`,
      bounced: sql<number>`count(*) filter (where ${ev("bounced")})::int`,
      positive: sql<number>`count(*) filter (where ${ev("replied_pos")})::int`,
      negative: sql<number>`count(*) filter (where ${ev("replied_neg")} and not ${ev("replied_pos")})::int`,
      doNotContact: sql<number>`count(*) filter (where ${leadSellers.status} = 'do_not_contact')::int`,
    })
    .from(leadSellers)
    .leftJoin(leadCategories, eq(leadCategories.id, leadSellers.categoryId))
    .where(month ? eq(leadSellers.batchMonth, month) : undefined)
    .groupBy(leadSellers.categoryId, leadCategories.name);
  return rows
    .sort((a, b) => a.sort - b.sort)
    .map(({ sort: _sort, ...r }) => {
      const replies = r.positive + r.negative;
      return { ...r, replies, bouncedPct: pct(r.bounced, r.sent), repliesPct: pct(replies, r.sent), positivePct: pct(r.positive, r.sent) };
    });
}

// ── Экспорт ──────────────────────────────────────────────────────────────────

const KIND = { ul: "ООО / организация", ip: "ИП" } as Record<string, string>;

function exportRows(sellers: LeadSellerDto[]) {
  const header = [
    "ИНН", "Юрназвание", "Тип", "ОГРН / ОГРНИП", "Бренды", "ID продавца WB", "Категория", "Месяц выгрузки", "Статус",
    "Руководитель", "Должность", "Дата регистрации", "ОКВЭД", "Регион", "Адрес", "Статус ЕГРЮЛ", "SKU", "Отзывов", "Доля Китая, %",
    "Телефоны", "Email", "Email невалидные", "Сайт", "Контакты с источниками", "Примеры товаров", "Первая строка письма", "Первое письмо", "Добавлен",
  ];
  const rows = sellers.map((s) => {
    const of = (type: string, valid?: boolean) => s.contacts.filter((c) => c.type === type && (valid === undefined || c.valid === valid)).map((c) => c.value).join(", ");
    return [
      s.inn, s.legalName, KIND[s.kind] ?? s.kind, s.ogrn ?? "", s.brands.join(", "), s.wbSupplierIds.join(", "), s.categoryName ?? "", s.batchMonth,
      SELLER_STATUSES[s.status]?.label ?? s.status, s.managerName ?? "", s.managerPost ?? "", s.regDate ?? "", s.okved ?? "", s.region ?? "", s.address ?? "",
      s.egrStatus ?? "", s.skuCount ?? "", s.feedbacksTotal ?? "", s.chinaShare === null ? "" : Math.round(s.chinaShare * 100),
      of("phone"), of("email", true), of("email", false), of("site"),
      s.contacts.map((c) => `${c.value} (${CONTACT_SOURCES[c.source] ?? c.source}, ${c.receivedAt.slice(0, 10)}${c.valid ? "" : `, ${c.note ?? "невалиден"}`})`).join("; "),
      s.products.map((p) => `${p.name} — ${p.url}`).join("; "),
      s.firstLine, s.firstSentAt?.slice(0, 10) ?? "", s.createdAt.slice(0, 10),
    ];
  });
  const contactHeader = ["ИНН", "Юрназвание", "Тип", "Значение", "Источник", "Валиден", "Примечание", "Получен"];
  const contactRows = sellers.flatMap((s) =>
    s.contacts.map((c) => [s.inn, s.legalName, { phone: "телефон", email: "email", site: "сайт" }[c.type] ?? c.type, c.value, CONTACT_SOURCES[c.source] ?? c.source, c.valid ? "да" : "нет", c.note ?? "", c.receivedAt.slice(0, 19)]),
  );
  return { header, rows, contactHeader, contactRows };
}

export async function exportSellers(tx: DbOrTx, f: SellerFilter) {
  const { sellers } = await listSellers(tx, f, 100_000);
  return exportRows(sellers);
}

/** CSV для Excel: «;», BOM, кавычки по необходимости. */
export function toCsv(header: unknown[], rows: unknown[][]): string {
  const cell = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return `﻿${[header, ...rows].map((r) => r.map(cell).join(";")).join("\r\n")}\r\n`;
}

const xmlEsc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");

function colName(i: number): string {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

function sheetXml(header: unknown[], rows: unknown[][]): string {
  const row = (cells: unknown[], r: number, style = 0) =>
    `<row r="${r}">${cells
      .map((v, i) => {
        const ref = `${colName(i)}${r}`;
        if (typeof v === "number" && Number.isFinite(v)) return `<c r="${ref}"${style ? ` s="${style}"` : ""}><v>${v}</v></c>`;
        const s = v === null || v === undefined ? "" : String(v);
        return s ? `<c r="${ref}" t="inlineStr"${style ? ` s="${style}"` : ""}><is><t xml:space="preserve">${xmlEsc(s.slice(0, 32000))}</t></is></c>` : "";
      })
      .join("")}</row>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetData>${row(header, 1, 1)}${rows.map((r, i) => row(r, i + 2)).join("")}</sheetData><autoFilter ref="A1:${colName(header.length - 1)}${rows.length + 1}"/></worksheet>`;
}

/** XLSX без зависимостей: два листа — «Продавцы» и «Контакты». */
export async function toXlsx(sheets: { name: string; header: unknown[]; rows: unknown[][] }[]): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`,
  );
  zip.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  zip.file(
    "xl/workbook.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${xmlEsc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`,
  );
  zip.file(
    "xl/_rels/workbook.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
  );
  zip.file(
    "xl/styles.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="2"><xf/><xf fontId="1" applyFont="1"/></cellXfs></styleSheet>`,
  );
  sheets.forEach((s, i) => zip.file(`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s.header, s.rows)));
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}
