/** Сделки: проверка полей, чтение с джойнами, журнал изменений. */

import { and, eq, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { DEAL_FIELDS, type DealField, type FieldSpec } from "../../shared/deal-fields.ts";
import type { DbOrTx } from "../db/client.ts";
import { clients, contacts, dealEvents, deals, dealStatuses, users } from "../db/schema.ts";
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
    case "client": {
      if (value === null || value === undefined || value === "") return null;
      const id = Number(value);
      const [row] = await tx.select({ id: clients.id }).from(clients).where(eq(clients.id, id));
      if (!row) throw new HttpError(400, "Клиент не найден");
      return id;
    }
    case "contact": {
      if (value === null || value === undefined || value === "") return null;
      const id = Number(value);
      const [row] = await tx.select({ id: contacts.id }).from(contacts).where(eq(contacts.id, id));
      if (!row) throw new HttpError(400, "Контакт не найден");
      return id;
    }
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

/** Совпадают ли старое и новое значение поля (numeric из БД приходит строкой «12.500»). */
export function sameValue(field: DealField, before: unknown, after: unknown): boolean {
  if (DEAL_FIELDS[field].kind === "number" && before != null && after != null) return Number(before) === Number(after);
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
    case "client": {
      const [row] = await tx.select({ name: clients.name }).from(clients).where(eq(clients.id, Number(value)));
      return row?.name ?? `#${value}`;
    }
    case "contact": {
      const [row] = await tx.select({ name: contacts.name }).from(contacts).where(eq(contacts.id, Number(value)));
      return row?.name ?? `#${value}`;
    }
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
  hsCode: deals.hsCode,
  weightKg: sql<number | null>`${deals.weightKg}::float8`,
  volumeM3: sql<number | null>`${deals.volumeM3}::float8`,
  pickupLocation: deals.pickupLocation,
  deliveryLocation: deals.deliveryLocation,
  goodsReadyDate: deals.goodsReadyDate,
  route: deals.route,
  contractParty: deals.contractParty,
  exportLicense: deals.exportLicense,
  certificates: deals.certificates,
  certificateHolder: deals.certificateHolder,
  chestnyZnak: deals.chestnyZnak,
  assigneeId: deals.assigneeId,
  assigneeName: assignee.name,
  dueDate: deals.dueDate,
  priority: deals.priority,
  labels: deals.labels,
  description: deals.description,
  boardPosition: deals.boardPosition,
  source: deals.source,
  clientId: deals.clientId,
  clientName: clients.name,
  clientKind: clients.kind,
  clientInn: clients.inn,
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
};

export function dealQuery(tx: DbOrTx) {
  return tx
    .select(dealSelect)
    .from(deals)
    .leftJoin(assignee, eq(assignee.id, deals.assigneeId))
    .leftJoin(author, eq(author.id, deals.createdBy))
    .leftJoin(clients, eq(clients.id, deals.clientId))
    .leftJoin(contacts, eq(contacts.id, deals.contactId))
    .$dynamic();
}

/** Позиция в конце колонки. */
export async function endOfColumn(tx: DbOrTx, statusKey: string): Promise<number> {
  const [row] = await tx
    .select({ max: sql<number | null>`max(${deals.boardPosition})` })
    .from(deals)
    .where(eq(deals.statusKey, statusKey));
  return (row?.max ?? 0) + 1024;
}
