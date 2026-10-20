/**
 * Оплата на несколько счетов: одна платёжка → разнесение по инвойсам / счетам (можно и на счёт другой сделки,
 * и с не разнесённым остатком). Файл платёжки — POST /payments/:id/files. Обычная оплата одного счёта — как
 * раньше, статусом оплаты документа (сюда не пишется).
 */

import { eq, inArray } from "drizzle-orm";
import type { FastifyInstance } from "fastify";

import { CURRENCIES, docSpec } from "../../shared/documents.ts";
import { db } from "../db/client.ts";
import { documents, paymentAllocations, payments, shipments } from "../db/schema.ts";
import { audit } from "../lib/audit.ts";
import { body, currentUser, HttpError, intParam } from "../lib/http.ts";
import { applyAllocations, type PaymentAllocationInput } from "../lib/payments.ts";
import { addShipmentEvent, parseShipmentNumber } from "../lib/shipments.ts";
import { deleteAttachmentRows, unlinkStoredFiles } from "./files.ts";

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
};
const fmt = (n: number, c: string) => `${n.toLocaleString("ru-RU", { maximumFractionDigits: 2 })} ${c}`;

export async function paymentRoutes(app: FastifyInstance): Promise<void> {
  /**
   * { shipment?: номер сделки, counterpartyId?, number?, date, amount, currency, note?, allocations: [{documentId, amount}] }.
   * Сделка и получатель по умолчанию — первого счёта.
   */
  app.post("/payments", async (request) => {
    const user = currentUser(request);
    const input = body<Record<string, unknown>>(request);
    const amount = num(input.amount);
    if (!amount || amount <= 0) throw new HttpError(400, "Укажите сумму платежа");
    const currency = String(input.currency ?? "").toUpperCase();
    if (!(CURRENCIES as readonly string[]).includes(currency)) throw new HttpError(400, "Укажите валюту платежа");
    const date = typeof input.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input.date) ? input.date : null;
    if (!date) throw new HttpError(400, "Укажите дату платежа");
    const raw = Array.isArray(input.allocations) ? input.allocations : [];
    const allocations: PaymentAllocationInput[] = [];
    for (const a of raw as Record<string, unknown>[]) {
      const documentId = typeof a?.documentId === "number" ? a.documentId : null;
      const part = num(a?.amount);
      if (!documentId || !part || part <= 0) continue;
      const same = allocations.find((x) => x.documentId === documentId);
      if (same) same.amount = Math.round((same.amount + part) * 100) / 100;
      else allocations.push({ documentId, amount: part });
    }
    if (!allocations.length) throw new HttpError(400, "Укажите, какие счета оплачены");
    const allocated = allocations.reduce((s, a) => s + a.amount, 0);
    if (allocated > amount + 0.005) throw new HttpError(400, `Разнесено ${fmt(allocated, currency)} — больше суммы платежа ${fmt(amount, currency)}`);

    return db.transaction(async (tx) => {
      const docs = await tx.select().from(documents).where(inArray(documents.id, allocations.map((a) => a.documentId)));
      for (const a of allocations) {
        const d = docs.find((x) => x.id === a.documentId);
        if (!d) throw new HttpError(400, "Счёт не найден");
        if (!docSpec(d.type)?.payable) throw new HttpError(400, "Оплату можно разнести только на инвойсы, счета и ДТ");
        if (d.currency && d.currency !== currency) throw new HttpError(400, `Счёт № ${d.number ?? "б/н"} в ${d.currency}, а платёж в ${currency} — разнесите в валюте счёта`);
      }
      const first = docs.find((d) => d.id === allocations[0].documentId)!;
      let shipmentId = first.shipmentId;
      if (input.shipment !== undefined && input.shipment !== null && input.shipment !== "") {
        const [sh] = await tx.select({ id: shipments.id }).from(shipments).where(eq(shipments.number, parseShipmentNumber(input.shipment)));
        if (!sh) throw new HttpError(404, "Сделка не найдена");
        shipmentId = sh.id;
      }
      const counterpartyId = typeof input.counterpartyId === "number" ? input.counterpartyId : first.counterpartyId;
      const [payment] = await tx
        .insert(payments)
        .values({
          shipmentId,
          counterpartyId,
          number: typeof input.number === "string" && input.number.trim() ? input.number.trim().slice(0, 100) : null,
          date,
          amount: String(amount),
          currency,
          note: typeof input.note === "string" ? input.note.trim().slice(0, 1000) : "",
          createdBy: user.id,
        })
        .returning();
      await tx.insert(paymentAllocations).values(allocations.map((a) => ({ paymentId: payment.id, documentId: a.documentId, amount: String(a.amount) })));
      const label = `Оплата${payment.number ? ` № ${payment.number}` : ""} на ${fmt(amount, currency)}`;
      if (shipmentId) await addShipmentEvent(tx, shipmentId, user.id, "document_added", null, null, label);
      await applyAllocations(tx, allocations.map((a) => a.documentId), user.id);
      await audit(tx, { userId: user.id, action: "create", entityType: "payment", entityId: payment.id, summary: `Добавил ${label.toLowerCase()} (счетов: ${allocations.length})`, ip: request.ip });
      return { payment: { id: payment.id } };
    });
  });

  /** Удалить оплату: счета, оплаченные ею, — снова по оставшимся оплатам (или «Не оплачен»). */
  app.delete("/payments/:id", async (request) => {
    const user = currentUser(request);
    const id = intParam((request.params as { id: string }).id);
    const keys = await db.transaction(async (tx) => {
      const [payment] = await tx.select().from(payments).where(eq(payments.id, id));
      if (!payment) throw new HttpError(404, "Оплата не найдена");
      const docIds = (await tx.select({ id: paymentAllocations.documentId }).from(paymentAllocations).where(eq(paymentAllocations.paymentId, id))).map((r) => r.id);
      await tx.delete(payments).where(eq(payments.id, id));
      await applyAllocations(tx, docIds, user.id);
      const label = `Оплата${payment.number ? ` № ${payment.number}` : ""} на ${fmt(Number(payment.amount), payment.currency)}`;
      if (payment.shipmentId) await addShipmentEvent(tx, payment.shipmentId, user.id, "document_removed", null, label, null);
      await audit(tx, { userId: user.id, action: "delete", entityType: "payment", entityId: id, summary: `Удалил ${label.toLowerCase()}`, ip: request.ip });
      return deleteAttachmentRows(tx, "payment", [id]);
    });
    await unlinkStoredFiles(keys);
    return { ok: true };
  });
}
