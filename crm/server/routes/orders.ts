/** Поручение на закупку: создание из сделки и выгрузка DOCX. */

import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";

import { config } from "../config.ts";
import { db } from "../db/client.ts";
import { counterparties, documents, shipments } from "../db/schema.ts";
import { audit } from "../lib/audit.ts";
import { assertSingleOrder, nextSeqNo, pad2, replaceItems } from "../lib/documents.ts";
import { currentUser, HttpError, intParam } from "../lib/http.ts";
import { buildOrderDraft, renderOrderDocx } from "../lib/order.ts";
import { renderContractDocx } from "../lib/contract.ts";
import { getCompany } from "../lib/settings.ts";
import { addShipmentEvent, parseShipmentNumber } from "../lib/shipments.ts";

export async function orderRoutes(app: FastifyInstance): Promise<void> {
  /** Сформировать поручение по сделке: номер — следующий по договору комиссии клиента. */
  app.post("/shipments/:number/order", async (request) => {
    const user = currentUser(request);
    const number = parseShipmentNumber((request.params as { number: string }).number);
    return db.transaction(async (tx) => {
      const [deal] = await tx.select({ id: shipments.id, title: shipments.title }).from(shipments).where(eq(shipments.number, number));
      if (!deal) throw new HttpError(404, "Сделка не найдена");
      await assertSingleOrder(tx, deal.id);
      const draft = await buildOrderDraft(tx, deal.id);
      const seqNo = await nextSeqNo(tx, draft.contract.id, "commission_order");
      const [doc] = await tx
        .insert(documents)
        .values({
          type: "commission_order",
          number: pad2(seqNo),
          seqNo,
          date: new Date().toISOString().slice(0, 10),
          counterpartyId: draft.shipment.clientId,
          shipmentId: deal.id,
          parentId: draft.contract.id,
          currency: draft.currency,
          amount: draft.amount === null ? null : String(draft.amount),
          status: "draft",
          data: draft.data,
          createdBy: user.id,
        })
        .returning({ id: documents.id, number: documents.number });
      await replaceItems(tx, user.id, doc.id, draft.items);
      await addShipmentEvent(tx, deal.id, user.id, "document_added", null, null, `Поручение № ${doc.number}`);
      await audit(tx, {
        userId: user.id,
        action: "create",
        entityType: "document",
        entityId: doc.id,
        summary: `Сформировал поручение № ${doc.number} по сделке «${deal.title}»`,
        ip: request.ip,
      });
      return { document: doc };
    });
  });

  /** DOCX документа по шаблону (пока — поручение). */
  app.get("/documents/:id/docx", async (request, reply) => {
    const id = intParam((request.params as { id: string }).id);
    const [doc] = await db.select().from(documents).where(eq(documents.id, id));
    if (!doc) throw new HttpError(404, "Документ не найден");
    if (doc.type === "commission_contract") {
      // Договор — заново по шаблону и текущим реквизитам клиента.
      const [client] = doc.counterpartyId ? await db.select().from(counterparties).where(eq(counterparties.id, doc.counterpartyId)) : [];
      if (!client) throw new HttpError(400, "В договоре не указан клиент");
      const today = new Date().toISOString().slice(0, 10);
      const buffer = await renderContractDocx(
        client,
        { number: doc.number ?? "___", date: doc.date ?? today, validUntil: doc.validUntil ?? today, city: (doc.data as { city?: string } | null)?.city ?? ((await getCompany(db)).city || "Красногорск") },
        config.uploadDir,
      );
      const filename = `Договор комиссии ${doc.number ?? id} — ${client.name}.docx`.replace(/[\\/:*?"<>|]/g, " ");
      return reply
        .header("content-type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
        .header("content-disposition", `attachment; filename="contract-${id}.docx"; filename*=UTF-8''${encodeURIComponent(filename)}`)
        .send(buffer);
    }
    if (doc.type !== "commission_order") throw new HttpError(400, "Для этого типа документа шаблона нет");
    const buffer = await renderOrderDocx(db, id, config.uploadDir);
    const filename = `Поручение ${doc.number ?? id}.docx`;
    return reply
      .header("content-type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
      .header(
        "content-disposition",
        `attachment; filename="order-${doc.number ?? id}.docx"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      )
      .send(buffer);
  });
}
