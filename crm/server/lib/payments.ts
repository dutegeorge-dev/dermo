/**
 * Галочки оплат в «Ходе сделки» и статусы оплаты документов — одно и то же, держим их согласованными:
 *   «Остаток поставщику» — инвойсы поставщика сделки,
 *   «Фрахт»              — счета перевозчика (инвойс перевозчика сделки / счета подрядчиков-перевозчиков),
 *   «Таможенные платежи» — ДТ сделки.
 * Отметили галочку — документы становятся «Оплачен»; сняли — «Не оплачен». Изменили оплату документа —
 * галочка ставится, когда оплачены все такие документы, и снимается, если какой-то не оплачен.
 */

import { and, eq, inArray, or, sql, type SQL } from "drizzle-orm";

import { DOC_TYPES, PAYMENT_STATUSES } from "../../shared/documents.ts";
import type { FlagKey } from "../../shared/shipments.ts";
import type { DbOrTx } from "../db/client.ts";
import { counterparties, documents, paymentAllocations, payments, shipments } from "../db/schema.ts";
import { documentLabel } from "./deals.ts";
import { addShipmentEvent } from "./shipments.ts";

export type PaymentFlag = Extract<FlagKey, "balance" | "freight" | "customs_payment">;
export const PAYMENT_FLAGS: PaymentFlag[] = ["balance", "freight", "customs_payment"];

type ShipmentRow = typeof shipments.$inferSelect;

/** Документы, оплату которых означает галочка. */
export async function flagDocuments(tx: DbOrTx, sh: ShipmentRow, key: PaymentFlag) {
  let where: SQL;
  if (key === "balance") where = and(eq(documents.shipmentId, sh.id), eq(documents.type, "supplier_invoice"))!;
  else if (key === "customs_payment") where = and(eq(documents.shipmentId, sh.id), eq(documents.type, "customs_declaration"))!;
  else {
    const carrier: SQL[] = [sql`${counterparties.contractorType} like 'carrier%'`];
    if (sh.carrierId) carrier.push(eq(documents.counterpartyId, sh.carrierId));
    if (sh.carrierInvoiceId) carrier.push(eq(documents.id, sh.carrierInvoiceId));
    where = and(eq(documents.shipmentId, sh.id), eq(documents.type, "contractor_invoice"), or(...carrier))!;
  }
  return tx
    .select({ id: documents.id, paymentStatus: documents.paymentStatus, paidAt: documents.paidAt })
    .from(documents)
    .leftJoin(counterparties, eq(counterparties.id, documents.counterpartyId))
    .where(where);
}

/** Галочку отметили / сняли — документы следом. Возвращает id изменённых документов. */
export async function markFlagDocuments(tx: DbOrTx, sh: ShipmentRow, key: PaymentFlag, done: boolean, date: string, userId: number | null): Promise<number[]> {
  const docs = (await flagDocuments(tx, sh, key)).filter((d) => (done ? d.paymentStatus !== "paid" : d.paymentStatus === "paid"));
  if (!docs.length) return [];
  const ids = docs.map((d) => d.id);
  await tx
    .update(documents)
    .set(done ? { paymentStatus: "paid", paidAmount: null, paidAt: date, updatedAt: new Date() } : { paymentStatus: "unpaid", paidAmount: null, paidAt: null, updatedAt: new Date() })
    .where(inArray(documents.id, ids));
  for (const d of docs) {
    await addShipmentEvent(tx, sh.id, userId, "payment_changed", null, await documentLabel(tx, d.id), done ? PAYMENT_STATUSES.paid : PAYMENT_STATUSES.unpaid);
  }
  return ids;
}

/**
 * Новый документ в сделке: галочка его оплаты уже стоит, а других документов этой оплаты нет (оплатили до
 * загрузки инвойса / ДТ) — документ сразу «Оплачен» той датой; иначе — пересчитать галочки (ещё один
 * неоплаченный счёт галочку снимет).
 */
export async function paymentForNewDocument(tx: DbOrTx, documentId: number, shipmentId: number, userId: number | null): Promise<void> {
  const [sh] = await tx.select().from(shipments).where(eq(shipments.id, shipmentId));
  if (!sh) return;
  for (const key of PAYMENT_FLAGS) {
    const date = sh.flags[key];
    if (!date) continue;
    const docs = await flagDocuments(tx, sh, key);
    const doc = docs.find((d) => d.id === documentId);
    if (doc && docs.length === 1 && doc.paymentStatus !== "paid") {
      await tx.update(documents).set({ paymentStatus: "paid", paidAmount: null, paidAt: date }).where(eq(documents.id, documentId));
      return;
    }
  }
  await syncPaymentFlags(tx, shipmentId, userId);
}

/** Оплата документов изменилась — галочки сделки по ним. */
export async function syncPaymentFlags(tx: DbOrTx, shipmentId: number, userId: number | null): Promise<void> {
  const [sh] = await tx.select().from(shipments).where(eq(shipments.id, shipmentId));
  if (!sh) return;
  const flags = { ...sh.flags };
  let changed = false;
  for (const key of PAYMENT_FLAGS) {
    const docs = await flagDocuments(tx, sh, key);
    if (!docs.length) continue;
    const allPaid = docs.every((d) => d.paymentStatus === "paid");
    if (allPaid && !flags[key]) {
      flags[key] = docs.map((d) => d.paidAt ?? "").sort().pop() || new Date().toISOString().slice(0, 10);
      await addShipmentEvent(tx, sh.id, userId, "flag", key, false, true);
      changed = true;
    } else if (!allPaid && flags[key]) {
      delete flags[key];
      await addShipmentEvent(tx, sh.id, userId, "flag", key, true, false);
      changed = true;
    }
  }
  if (changed) await tx.update(shipments).set({ flags, updatedAt: new Date() }).where(eq(shipments.id, sh.id));
}

// ── Оплата на несколько счетов ─────────────────────────────────────────────
// Одна платёжка, разнесённая на инвойсы / счета (таблицы payments, payment_allocations) — например, два инвойса
// по 25 000 и одна оплата 50 000, или остаток оплаченного инвойса, уехавший следующим контейнером (инвойс в
// другой сделке). Статус оплаты разнесённых документов — из разнесения; у остальных документов всё по-старому.

export type PaymentAllocationInput = { documentId: number; amount: number };

export type ShipmentPayment = {
  id: number;
  number: string | null;
  date: string;
  amount: number;
  currency: string;
  note: string;
  shipmentId: number | null;
  shipmentNumber: number | null;
  counterpartyId: number | null;
  counterpartyName: string | null;
  files: { id: string; filename: string }[];
  allocations: {
    documentId: number;
    amount: number;
    type: string;
    number: string | null;
    date: string | null;
    docAmount: number | null;
    shipmentId: number | null;
    shipmentNumber: number | null;
  }[];
  /** Не разнесено ни на один счёт (аванс, переплата). */
  unallocated: number;
};

const money2 = (n: number) => Math.round(n * 100) / 100;

/** Статусы оплаты документов по их разнесениям (документ без разнесений — «Не оплачен»), затем галочки сделок. */
export async function applyAllocations(tx: DbOrTx, documentIds: number[], userId: number | null): Promise<void> {
  if (!documentIds.length) return;
  const docs = await tx
    .select({ id: documents.id, amount: documents.amount, paymentStatus: documents.paymentStatus, paidAmount: documents.paidAmount, paidAt: documents.paidAt, shipmentId: documents.shipmentId })
    .from(documents)
    .where(inArray(documents.id, documentIds));
  const sums = await tx
    .select({ documentId: paymentAllocations.documentId, paid: sql<number>`sum(${paymentAllocations.amount})::float8`, paidAt: sql<string>`max(${payments.date})::text` })
    .from(paymentAllocations)
    .innerJoin(payments, eq(payments.id, paymentAllocations.paymentId))
    .where(inArray(paymentAllocations.documentId, documentIds))
    .groupBy(paymentAllocations.documentId);
  const shipmentIds = new Set<number>();
  for (const d of docs) {
    const s = sums.find((x) => x.documentId === d.id);
    const paid = money2(s?.paid ?? 0);
    const total = d.amount === null ? null : Number(d.amount);
    const status = !paid ? "unpaid" : total === null || paid >= total - 0.005 ? "paid" : "partial";
    const next = { paymentStatus: status, paidAmount: status === "partial" ? String(paid) : null, paidAt: status === "unpaid" ? null : (s?.paidAt ?? null) } as const;
    if (next.paymentStatus === d.paymentStatus && Number(next.paidAmount ?? 0) === Number(d.paidAmount ?? 0) && next.paidAt === d.paidAt) continue;
    await tx.update(documents).set({ ...next, updatedAt: new Date() }).where(eq(documents.id, d.id));
    if (d.shipmentId) {
      shipmentIds.add(d.shipmentId);
      if (next.paymentStatus !== d.paymentStatus) {
        await addShipmentEvent(tx, d.shipmentId, userId, "payment_changed", null, await documentLabel(tx, d.id), PAYMENT_STATUSES[next.paymentStatus]);
      }
    }
  }
  for (const sid of shipmentIds) await syncPaymentFlags(tx, sid, userId);
}

/** Оплаты, касающиеся сделки: сделанные по ней и разнесённые на её документы (в том числе из других сделок). */
export async function shipmentPayments(tx: DbOrTx, shipmentId: number): Promise<ShipmentPayment[]> {
  const rows = await tx
    .select({
      id: payments.id,
      number: payments.number,
      date: sql<string>`${payments.date}::text`,
      amount: sql<number>`${payments.amount}::float8`,
      currency: payments.currency,
      note: payments.note,
      shipmentId: payments.shipmentId,
      shipmentNumber: shipments.number,
      counterpartyId: payments.counterpartyId,
      counterpartyName: counterparties.name,
      files: sql<{ id: string; filename: string }[]>`coalesce((select json_agg(json_build_object('id', a.id, 'filename', a.filename) order by a.created_at)
        from attachments a where a.owner_type = 'payment' and a.owner_id = ${payments.id}), '[]'::json)`,
    })
    .from(payments)
    .leftJoin(shipments, eq(shipments.id, payments.shipmentId))
    .leftJoin(counterparties, eq(counterparties.id, payments.counterpartyId))
    .where(
      or(
        eq(payments.shipmentId, shipmentId),
        sql`exists (select 1 from payment_allocations pa join documents d on d.id = pa.document_id where pa.payment_id = ${payments.id} and d.shipment_id = ${shipmentId})`,
      ),
    )
    .orderBy(payments.date, payments.id);
  if (!rows.length) return [];
  const allocs = await tx
    .select({
      paymentId: paymentAllocations.paymentId,
      documentId: paymentAllocations.documentId,
      amount: sql<number>`${paymentAllocations.amount}::float8`,
      type: documents.type,
      number: documents.number,
      date: sql<string | null>`${documents.date}::text`,
      docAmount: sql<number | null>`${documents.amount}::float8`,
      shipmentId: documents.shipmentId,
      shipmentNumber: shipments.number,
    })
    .from(paymentAllocations)
    .innerJoin(documents, eq(documents.id, paymentAllocations.documentId))
    .leftJoin(shipments, eq(shipments.id, documents.shipmentId))
    .where(inArray(paymentAllocations.paymentId, rows.map((r) => r.id)))
    .orderBy(documents.date, documents.id);
  return rows.map((r) => {
    const allocations = allocs.filter((a) => a.paymentId === r.id).map(({ paymentId: _, ...a }) => a);
    return { ...r, allocations, unallocated: money2(r.amount - allocations.reduce((s, a) => s + a.amount, 0)) };
  });
}

const dmyDate = (d: string | null) => (d ? d.split("-").reverse().join(".") : "");
const docText = (a: { type: string; number: string | null; date: string | null }) =>
  [DOC_TYPES[a.type as keyof typeof DOC_TYPES]?.label ?? a.type, a.number ? `№ ${a.number}` : "б/н", a.date && `от ${dmyDate(a.date)}`].filter(Boolean).join(" ");
const sum = (n: number, c: string) => `${n.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${c}`;

/**
 * Пояснение для таможни — только если оплата сделки не «один счёт — одна платёжка в этой же сделке»: платёжка
 * оплачивает и счета другой сделки (остаток, уехавший следующим контейнером), или часть её не разнесена.
 */
export function paymentExplanation(list: ShipmentPayment[], shipmentId: number): string[] {
  const lines: string[] = [];
  for (const p of list) {
    const others = p.allocations.filter((a) => a.shipmentId !== shipmentId);
    if (!others.length && p.unallocated <= 0.005) continue;
    const own = p.allocations.filter((a) => a.shipmentId === shipmentId);
    const head = `Платёжное поручение ${p.number ? `№ ${p.number} ` : ""}от ${dmyDate(p.date)} на ${sum(p.amount, p.currency)}${p.counterpartyName ? ` (получатель ${p.counterpartyName})` : ""}`;
    const part = (a: ShipmentPayment["allocations"][number]) =>
      `${docText(a)}${a.docAmount !== null ? ` на ${sum(a.docAmount, p.currency)}` : ""} — оплачено ${sum(a.amount, p.currency)}${a.shipmentNumber && a.shipmentId !== shipmentId ? ` (поставка по сделке № ${a.shipmentNumber})` : ""}`;
    lines.push(`${head}:`);
    for (const a of own) lines.push(`  - ${part(a)}`);
    for (const a of others) lines.push(`  - ${part(a)}`);
    if (p.unallocated > 0.005) lines.push(`  - не отнесено к инвойсам: ${sum(p.unallocated, p.currency)}${p.note ? ` — ${p.note}` : ""}`);
    else if (p.note) lines.push(`  ${p.note}`);
  }
  return lines;
}
