/** Воронка продаж: проверка полей лида, чтение с джойнами, журнал изменений, создание. */

import { and, asc, eq, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { DEAL_FIELDS, type DealField, type FieldSpec } from "../../shared/deal-fields.ts";
import { docSpec } from "../../shared/documents.ts";
import type { DbOrTx } from "../db/client.ts";
import { contacts, counterparties, dealEvents, deals, dealStatuses, documents, users } from "../db/schema.ts";
import { audit } from "./audit.ts";
import { HttpError } from "./http.ts";

type DealInsert = typeof deals.$inferInsert;

/** Ключ из адреса: «BARS-12», «bars-12» или «12» → номер. */
export function parseDealKey(raw: unknown): number {
  const m = /^(?:bars-)?(\d{1,9})$/i.exec(String(raw ?? "").trim());
  if (!m) throw new HttpError(404, "Сделка не найдена");
  return Number(m[1]);
}

function cleanText(value: unknown, spec: FieldSpec): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" && typeof value !== "number") throw new HttpError(400, `${spec.label}: ожидается текст`);
  const text = String(value).trim().slice(0, spec.max ?? 1000);
  return text || null;
}

async function existingId(tx: DbOrTx, table: typeof counterparties | typeof contacts | typeof documents, value: unknown, label: string) {
  if (value === null || value === undefined || value === "") return null;
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw new HttpError(400, `${label}: неверное значение`);
  const [row] = await tx.select({ id: table.id }).from(table).where(eq(table.id, id));
  if (!row) throw new HttpError(400, `${label}: не найден`);
  return id;
}

/** Проверяет значение поля и приводит к виду для БД. */
export async function parseField(tx: DbOrTx, field: DealField, value: unknown): Promise<unknown> {
  const spec: FieldSpec = DEAL_FIELDS[field];
  switch (spec.kind) {
    case "text": {
      const text = cleanText(value, spec);
      if (spec.required && !text) throw new HttpError(400, `Укажите поле «${spec.label}»`);
      return text;
    }
    case "longtext":
      return typeof value === "string" ? value.replace(/\r\n/g, "\n").slice(0, spec.max ?? 20_000) : "";
    case "number": {
      if (value === null || value === undefined || value === "") return null;
      const n = Number(String(value).replace(",", ".").replace(/\s/g, ""));
      if (!Number.isFinite(n) || n < 0 || n > 1e9) throw new HttpError(400, `${spec.label}: введите число`);
      return String(n);
    }
    case "date": {
      if (value === null || value === undefined || value === "") return null;
      const s = String(value);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s))) {
        throw new HttpError(400, `${spec.label}: неверная дата`);
      }
      return s;
    }
    case "enum": {
      if (value === null || value === undefined || value === "") {
        if (field === "priority") return "medium";
        return null;
      }
      if (!spec.values || !(String(value) in spec.values)) throw new HttpError(400, `${spec.label}: неизвестное значение`);
      return String(value);
    }
    case "user": {
      if (value === null || value === undefined || value === "") return null;
      const id = Number(value);
      const [row] = await tx.select({ id: users.id }).from(users).where(and(eq(users.id, id), eq(users.isActive, true)));
      if (!row) throw new HttpError(400, "Исполнитель не найден или отключён");
      return id;
    }
    case "client":
    case "counterparty":
      return existingId(tx, counterparties, value, spec.label);
    case "contact":
      return existingId(tx, contacts, value, spec.label);
    case "document":
      return existingId(tx, documents, value, spec.label);
    case "labels": {
      if (!Array.isArray(value)) return [];
      const labels = value
        .filter((v): v is string => typeof v === "string")
        .map((v) => v.trim().replace(/\s+/g, " ").slice(0, 40))
        .filter(Boolean);
      return [...new Set(labels)].slice(0, 20);
    }
  }
}

/** Совпадают ли старое и новое значение поля. */
export function sameValue(field: DealField, before: unknown, after: unknown): boolean {
  void field;
  return JSON.stringify(before ?? null) === JSON.stringify(after ?? null);
}

/** Значения полей из тела запроса (только известные поля). */
export async function parseFields(tx: DbOrTx, input: Record<string, unknown>): Promise<Partial<DealInsert>> {
  const out: Record<string, unknown> = {};
  for (const field of Object.keys(DEAL_FIELDS) as DealField[]) {
    if (field in input) out[field] = await parseField(tx, field, input[field]);
  }
  return out as Partial<DealInsert>;
}

/** Подпись документа для журнала: «Договор комиссии № 01 от 2026-03-09». */
export async function documentLabel(tx: DbOrTx, id: number): Promise<string> {
  const [doc] = await tx
    .select({ type: documents.type, number: documents.number, date: documents.date })
    .from(documents)
    .where(eq(documents.id, id));
  if (!doc) return `#${id}`;
  const spec = docSpec(doc.type);
  return [spec?.label ?? doc.type, doc.number && `№ ${doc.number}`, doc.date && `от ${doc.date.split("-").reverse().join(".")}`]
    .filter(Boolean)
    .join(" ");
}

/** Человекочитаемое значение поля — для журнала изменений. */
export async function displayValue(tx: DbOrTx, field: DealField, value: unknown): Promise<string | null> {
  if (value === null || value === undefined || value === "") return null;
  const spec: FieldSpec = DEAL_FIELDS[field];
  switch (spec.kind) {
    case "number":
      return String(Number(value)).replace(".", ",");
    case "enum":
      return spec.values?.[String(value)] ?? String(value);
    case "user": {
      const [row] = await tx.select({ name: users.name }).from(users).where(eq(users.id, Number(value)));
      return row?.name ?? `#${value}`;
    }
    case "client":
    case "counterparty": {
      const [row] = await tx.select({ name: counterparties.name }).from(counterparties).where(eq(counterparties.id, Number(value)));
      return row?.name ?? `#${value}`;
    }
    case "contact": {
      const [row] = await tx.select({ name: contacts.name }).from(contacts).where(eq(contacts.id, Number(value)));
      return row?.name ?? `#${value}`;
    }
    case "document":
      return documentLabel(tx, Number(value));
    case "labels":
      return (value as string[]).length ? (value as string[]).join(", ") : null;
    case "longtext": {
      const text = String(value);
      return text.length > 200 ? `${text.slice(0, 200)}…` : text;
    }
    default:
      return String(value);
  }
}

export async function addEvent(
  tx: DbOrTx,
  dealId: number,
  userId: number | null,
  kind: string,
  field: string | null = null,
  oldValue: unknown = null,
  newValue: unknown = null,
): Promise<void> {
  await tx.insert(dealEvents).values({ dealId, userId, kind, field, oldValue, newValue });
}

export async function getStage(tx: DbOrTx, key: string) {
  const [stage] = await tx.select().from(dealStatuses).where(eq(dealStatuses.key, key));
  if (!stage) throw new HttpError(400, "Этап не найден");
  return stage;
}

const assignee = alias(users, "assignee");
const author = alias(users, "author");
const client = alias(counterparties, "client");

/** Колонки сделки для списков и карточки. */
export const dealSelect = {
  id: deals.id,
  number: deals.number,
  key: deals.key,
  title: deals.title,
  statusKey: deals.statusKey,
  outcome: deals.outcome,
  lostReason: deals.lostReason,
  product: deals.product,
  assigneeId: deals.assigneeId,
  assigneeName: assignee.name,
  dueDate: deals.dueDate,
  priority: deals.priority,
  labels: deals.labels,
  description: deals.description,
  boardPosition: deals.boardPosition,
  source: deals.source,
  clientId: deals.clientId,
  clientName: client.name,
  clientKind: client.kind,
  clientInn: client.inn,
  contactId: deals.contactId,
  contactName: contacts.name,
  contactPhone: contacts.phone,
  contactMessenger: contacts.messenger,
  contactMessengerHandle: contacts.messengerHandle,
  contactEmail: contacts.email,
  createdAt: deals.createdAt,
  updatedAt: deals.updatedAt,
  closedAt: deals.closedAt,
  createdByName: author.name,
  /** Сделки (отгрузки), выросшие из лида. */
  shipmentCount: sql<number>`(select count(*)::int from shipments s where s.deal_id = ${deals.id})`,
};

export function dealQuery(tx: DbOrTx) {
  return tx
    .select(dealSelect)
    .from(deals)
    .leftJoin(assignee, eq(assignee.id, deals.assigneeId))
    .leftJoin(author, eq(author.id, deals.createdBy))
    .leftJoin(client, eq(client.id, deals.clientId))
    .leftJoin(contacts, eq(contacts.id, deals.contactId))
    .$dynamic();
}

/** Колонки, по которым ищутся лиды (клиент — через алиас dealQuery). */
export const dealSearchColumns = { client };

/** Позиция в конце колонки. */
export async function endOfColumn(tx: DbOrTx, statusKey: string): Promise<number> {
  const [row] = await tx
    .select({ max: sql<number | null>`max(${deals.boardPosition})` })
    .from(deals)
    .where(eq(deals.statusKey, statusKey));
  return (row?.max ?? 0) + 1024;
}

/** Итог сделки при переходе на этап: завершающий → успешно, иначе — в работе (отказ не трогаем). */
export function outcomeForStage(isFinal: boolean, current: "won" | "lost" | null) {
  if (current === "lost") return { outcome: "lost" as const };
  return isFinal ? { outcome: "won" as const, closedAt: new Date() } : { outcome: null, closedAt: null };
}

/** Создание лида в воронке. */
export async function createDeal(
  tx: DbOrTx,
  userId: number | null,
  fields: Partial<DealInsert> & { title: string },
  opts: { statusKey?: string; ip?: string | null } = {},
): Promise<{ id: number; key: string; number: number; title: string }> {
  let stage = opts.statusKey ? await getStage(tx, opts.statusKey).catch(() => null) : null;
  if (!stage) [stage] = await tx.select().from(dealStatuses).orderBy(asc(dealStatuses.position)).limit(1);
  const [created] = await tx
    .insert(deals)
    .values({
      ...fields,
      assigneeId: "assigneeId" in fields ? fields.assigneeId : userId,
      statusKey: stage.key,
      ...outcomeForStage(stage.isFinal, null),
      boardPosition: await endOfColumn(tx, stage.key),
      createdBy: userId,
    })
    .returning({ id: deals.id, key: deals.key, number: deals.number, title: deals.title });
  await addEvent(tx, created.id, userId, "created", null, null, stage.name);
  await audit(tx, {
    userId,
    action: "create",
    entityType: "deal",
    entityId: created.key,
    summary: `Создал сделку ${created.key} «${created.title}»`,
    ip: opts.ip,
  });
  return { ...created, key: created.key! };
}
