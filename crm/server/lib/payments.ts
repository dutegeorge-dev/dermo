/**
 * Галочки оплат в «Ходе сделки» и статусы оплаты документов — одно и то же, держим их согласованными:
 *   «Остаток поставщику» — инвойсы поставщика сделки,
 *   «Фрахт»              — счета перевозчика (инвойс перевозчика сделки / счета подрядчиков-перевозчиков),
 *   «Таможенные платежи» — ДТ сделки.
 * Отметили галочку — документы становятся «Оплачен»; сняли — «Не оплачен». Изменили оплату документа —
 * галочка ставится, когда оплачены все такие документы, и снимается, если какой-то не оплачен.
 */

import { and, eq, inArray, or, sql, type SQL } from "drizzle-orm";

import { PAYMENT_STATUSES } from "../../shared/documents.ts";
import type { FlagKey } from "../../shared/shipments.ts";
import type { DbOrTx } from "../db/client.ts";
import { counterparties, documents, shipments } from "../db/schema.ts";
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
