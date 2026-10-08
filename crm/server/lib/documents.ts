/** Документы: проверка полей, позиции (с пополнением справочника товаров), нумерация, связи со сделкой. */

import { and, asc, eq, isNull, max, ne, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { DOC_STATUSES, docSpec, type DocTypeSpec, PAYMENT_STATUSES } from "../../shared/documents.ts";
import type { DbOrTx } from "../db/client.ts";
import { counterparties, dealParties, deals, documentItems, documents, products } from "../db/schema.ts";
import { addEvent, findActiveContract } from "./deals.ts";
import { HttpError } from "./http.ts";

type DocInsert = typeof documents.$inferInsert;

const cp = alias(counterparties, "cp");
const cl = alias(counterparties, "cl");
const parent = alias(documents, "parent");

/** Список документов с именами сторон, ключом сделки и номером договора. */
export function documentListQuery(tx: DbOrTx) {
  return tx
    .select({
      id: documents.id,
      type: documents.type,
      number: documents.number,
      date: documents.date,
      seqNo: documents.seqNo,
      counterpartyId: documents.counterpartyId,
      counterpartyName: cp.name,
      counterpartyRole: cp.role,
      clientId: documents.clientId,
      clientName: cl.name,
      dealId: documents.dealId,
      dealKey: deals.key,
      parentId: documents.parentId,
      parentNumber: parent.number,
      parentType: parent.type,
      currency: documents.currency,
      amount: sql<number | null>`${documents.amount}::float8`,
      status: documents.status,
      paymentStatus: documents.paymentStatus,
      paidAmount: sql<number | null>`${documents.paidAmount}::float8`,
      paidAt: documents.paidAt,
      validUntil: documents.validUntil,
      createdAt: documents.createdAt,
      updatedAt: documents.updatedAt,
      fileCount: sql<number>`(select count(*)::int from attachments a where a.owner_type = 'document' and a.owner_id = ${documents.id})`,
    })
    .from(documents)
    .leftJoin(cp, eq(cp.id, documents.counterpartyId))
    .leftJoin(cl, eq(cl.id, documents.clientId))
    .leftJoin(deals, eq(deals.id, documents.dealId))
    .leftJoin(parent, eq(parent.id, documents.parentId))
    .$dynamic();
}

export const documentListAliases = { cp, cl };

function str(value: unknown, max: number): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" && typeof value !== "number") throw new HttpError(400, "Ожидается текст");
  return String(value).trim().slice(0, max) || null;
}

function dateOrNull(value: unknown, label: string): string | null {
  if (value === null || value === undefined || value === "") return null;
  const s = String(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s))) throw new HttpError(400, `${label}: неверная дата`);
  return s;
}

export function numberOrNull(value: unknown, label: string): string | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(String(value).replace(/\s/g, "").replace(",", "."));
  if (!Number.isFinite(n) || Math.abs(n) > 1e13) throw new HttpError(400, `${label}: введите число`);
  return String(n);
}

async function existing(tx: DbOrTx, table: typeof counterparties | typeof documents | typeof deals, value: unknown, label: string) {
  if (value === null || value === undefined || value === "") return null;
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw new HttpError(400, `${label}: неверное значение`);
  const [row] = await tx.select({ id: table.id }).from(table).where(eq(table.id, id));
  if (!row) throw new HttpError(400, `${label}: не найден`);
  return id;
}

/** Поля документа из запроса (только переданные). type — для проверки договора-родителя. */
export async function parseDocumentFields(tx: DbOrTx, input: Record<string, unknown>, type: string): Promise<Partial<DocInsert>> {
  const spec = docSpec(type);
  if (!spec) throw new HttpError(400, "Неизвестный тип документа");
  const v: Partial<DocInsert> = {};
  if ("number" in input) v.number = str(input.number, 100);
  if ("date" in input) v.date = dateOrNull(input.date, "Дата");
  if ("counterpartyId" in input) v.counterpartyId = await existing(tx, counterparties, input.counterpartyId, "Контрагент");
  if ("clientId" in input) v.clientId = await existing(tx, counterparties, input.clientId, "Клиент");
  if ("dealId" in input) v.dealId = await existing(tx, deals, input.dealId, "Сделка");
  if ("parentId" in input) {
    v.parentId = await existing(tx, documents, input.parentId, "Договор");
    if (v.parentId) {
      const [p] = await tx.select({ type: documents.type }).from(documents).where(eq(documents.id, v.parentId));
      const allowed = (spec as DocTypeSpec).parentTypes;
      if (allowed && !allowed.includes(p.type)) throw new HttpError(400, "Этот документ нельзя привязать к выбранному договору");
    }
  }
  if ("seqNo" in input) {
    const n = input.seqNo === null || input.seqNo === "" ? null : Number(input.seqNo);
    if (n !== null && (!Number.isSafeInteger(n) || n <= 0)) throw new HttpError(400, "Номер приложения — целое число");
    v.seqNo = n;
  }
  if ("currency" in input) {
    const c = str(input.currency, 3)?.toUpperCase() ?? null;
    if (c && !/^[A-Z]{3}$/.test(c)) throw new HttpError(400, "Валюта — трёхбуквенный код (CNY, USD, RUB…)");
    v.currency = c;
  }
  if ("amount" in input) v.amount = numberOrNull(input.amount, "Сумма");
  if ("status" in input) {
    const s = input.status || null;
    if (s && !(String(s) in DOC_STATUSES)) throw new HttpError(400, "Неизвестный статус");
    v.status = s ? String(s) : null;
  }
  if ("paymentStatus" in input) {
    const s = input.paymentStatus || null;
    if (s && !(String(s) in PAYMENT_STATUSES)) throw new HttpError(400, "Неизвестный статус оплаты");
    v.paymentStatus = s ? (s as keyof typeof PAYMENT_STATUSES) : null;
  }
  if ("paidAmount" in input) v.paidAmount = numberOrNull(input.paidAmount, "Оплачено");
  if ("paidAt" in input) v.paidAt = dateOrNull(input.paidAt, "Дата оплаты");
  if ("validUntil" in input) v.validUntil = dateOrNull(input.validUntil, "Действует до");
  if ("data" in input) {
    const data = input.data && typeof input.data === "object" && !Array.isArray(input.data) ? input.data : {};
    if (JSON.stringify(data).length > 100_000) throw new HttpError(413, "Слишком много данных в документе");
    v.data = data as Record<string, unknown>;
  }
  if ("notes" in input) v.notes = typeof input.notes === "string" ? input.notes.slice(0, 10_000) : "";
  return v;
}

export type ItemInput = {
  productId?: unknown;
  name?: unknown;
  batchNo?: unknown;
  hsCode?: unknown;
  quantity?: unknown;
  unit?: unknown;
  price?: unknown;
  amount?: unknown;
};

/** Ищет товар по названию (без учёта регистра) или создаёт — справочник пополняется сам. */
async function resolveProduct(tx: DbOrTx, userId: number, item: { productId: number | null; name: string; hsCode: string | null; unit: string | null }) {
  if (item.productId) {
    const [p] = await tx.select({ id: products.id }).from(products).where(eq(products.id, item.productId));
    if (p) return p.id;
  }
  const [found] = await tx
    .select({ id: products.id })
    .from(products)
    .where(sql`lower(${products.name}) = lower(${item.name})`)
    .limit(1);
  if (found) return found.id;
  const [created] = await tx
    .insert(products)
    .values({ name: item.name, hsCode: item.hsCode, unit: item.unit, createdBy: userId })
    .returning({ id: products.id });
  return created.id;
}

/** Заменяет позиции документа. Возвращает сумму позиций (для суммы документа). */
export async function replaceItems(tx: DbOrTx, userId: number, documentId: number, raw: unknown): Promise<number | null> {
  if (!Array.isArray(raw)) throw new HttpError(400, "Позиции — список");
  if (raw.length > 500) throw new HttpError(400, "Слишком много позиций");
  await tx.delete(documentItems).where(eq(documentItems.documentId, documentId));
  let total: number | null = null;
  for (const [i, r] of (raw as ItemInput[]).entries()) {
    const name = str(r?.name, 500);
    if (!name) continue;
    const quantity = numberOrNull(r.quantity, `Позиция ${i + 1}: количество`);
    const price = numberOrNull(r.price, `Позиция ${i + 1}: цена`);
    let amount = numberOrNull(r.amount, `Позиция ${i + 1}: сумма`);
    if (amount === null && quantity !== null && price !== null) amount = String(Math.round(Number(quantity) * Number(price) * 100) / 100);
    const hsCode = str(r.hsCode, 20);
    const unit = str(r.unit, 30);
    const productId = await resolveProduct(tx, userId, {
      productId: r.productId ? Number(r.productId) : null,
      name,
      hsCode,
      unit,
    });
    await tx.insert(documentItems).values({
      documentId,
      position: i,
      productId,
      name,
      batchNo: str(r.batchNo, 50),
      hsCode,
      quantity,
      unit,
      price,
      amount,
    });
    if (amount !== null) total = (total ?? 0) + Number(amount);
  }
  return total === null ? null : Math.round(total * 100) / 100;
}

/** Следующий номер приложения в договоре (поручение № N). */
export async function nextSeqNo(tx: DbOrTx, parentId: number, type: string): Promise<number> {
  const [row] = await tx
    .select({ max: max(documents.seqNo) })
    .from(documents)
    .where(and(eq(documents.parentId, parentId), eq(documents.type, type)));
  return (row?.max ?? 0) + 1;
}

export const pad2 = (n: number) => String(n).padStart(2, "0");

/**
 * Документ попал в сделку — подтягиваем связи: клиента сделки, поставщика,
 * контракт поставщика, подрядчика в участники. Возвращает поля, которые надо
 * дописать в сам документ.
 */
export async function linkToDeal(
  tx: DbOrTx,
  userId: number,
  doc: { id: number; type: string; dealId: number | null; counterpartyId: number | null; clientId: number | null; parentId: number | null; number: string | null },
): Promise<Partial<DocInsert>> {
  if (!doc.dealId) return {};
  const [deal] = await tx.select().from(deals).where(eq(deals.id, doc.dealId));
  if (!deal) return {};
  const spec = docSpec(doc.type)!;
  const patch: Partial<DocInsert> = {};
  if (!doc.clientId && deal.clientId && doc.counterpartyId !== deal.clientId) patch.clientId = deal.clientId;

  if (spec.party === "supplier" && doc.counterpartyId) {
    if (!deal.supplierId) {
      await tx.update(deals).set({ supplierId: doc.counterpartyId }).where(eq(deals.id, deal.id));
      const [s] = await tx.select({ name: counterparties.name }).from(counterparties).where(eq(counterparties.id, doc.counterpartyId));
      await addEvent(tx, deal.id, userId, "field_changed", "supplierId", null, s?.name ?? null);
    }
    if (!doc.parentId && doc.type !== "supplier_contract") {
      const contractId =
        deal.supplierContractId ??
        (await findActiveContract(tx, "supplier_contract", doc.counterpartyId, {
          clientId: deal.scheme === "teu" ? deal.clientId : null,
        }));
      if (contractId) patch.parentId = contractId;
    }
  }
  if (spec.party === "contractor" && doc.counterpartyId) {
    await tx.insert(dealParties).values({ dealId: deal.id, counterpartyId: doc.counterpartyId }).onConflictDoNothing();
  }
  return patch;
}

/** В сделке может быть только одно действующее поручение. */
export async function assertSingleOrder(tx: DbOrTx, dealId: number, exceptId?: number) {
  const [other] = await tx
    .select({ id: documents.id, number: documents.number })
    .from(documents)
    .where(
      and(
        eq(documents.dealId, dealId),
        eq(documents.type, "commission_order"),
        or(isNull(documents.status), ne(documents.status, "cancelled")),
        exceptId ? ne(documents.id, exceptId) : undefined,
      ),
    )
    .limit(1);
  if (other) throw new HttpError(409, `В сделке уже есть поручение № ${other.number ?? other.id}. Одна сделка — одно поручение.`);
}

export async function documentItemsOf(tx: DbOrTx, documentId: number) {
  return tx
    .select({
      id: documentItems.id,
      position: documentItems.position,
      productId: documentItems.productId,
      productName: products.name,
      name: documentItems.name,
      batchNo: documentItems.batchNo,
      hsCode: documentItems.hsCode,
      quantity: sql<number | null>`${documentItems.quantity}::float8`,
      unit: documentItems.unit,
      price: sql<number | null>`${documentItems.price}::float8`,
      amount: sql<number | null>`${documentItems.amount}::float8`,
    })
    .from(documentItems)
    .leftJoin(products, eq(products.id, documentItems.productId))
    .where(eq(documentItems.documentId, documentId))
    .orderBy(asc(documentItems.position));
}
