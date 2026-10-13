/** Документы: реестр, карточка, создание (в т.ч. «новая сделка из инвойса»), правка, удаление. */

import { and, asc, desc, eq, ilike, inArray, isNotNull, ne, or, sql, type SQL } from "drizzle-orm";
import type { FastifyInstance } from "fastify";

import { DOC_GROUPS, DOC_TYPES, type DocGroup, docSpec, PAYMENT_STATUSES } from "../../shared/documents.ts";
import { db } from "../db/client.ts";
import { attachments, documents, users } from "../db/schema.ts";
import { audit } from "../lib/audit.ts";
import { documentLabel } from "../lib/deals.ts";
import { addShipmentEvent, createShipment } from "../lib/shipments.ts";
import {
  assertSingleOrder,
  documentItemsOf,
  documentListAliases,
  documentListQuery,
  linkToShipment,
  nextSeqNo,
  pad2,
  parseDocumentFields,
  replaceItems,
} from "../lib/documents.ts";
import { body, currentUser, HttpError, intParam } from "../lib/http.ts";
import { deleteAttachmentRows, unlinkStoredFiles } from "./files.ts";

async function getDocument(id: number) {
  const [doc] = await db.select().from(documents).where(eq(documents.id, id));
  if (!doc) throw new HttpError(404, "Документ не найден");
  return doc;
}

export async function documentRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Реестр. Фильтры: type (через запятую), group, counterparty, client (документы клиента —
   * и где он сторона, и где указан клиентом), shipment, parent, payment, expiring (дней), q.
   */
  app.get("/documents", async (request) => {
    const q = request.query as Record<string, string | undefined>;
    const filters: SQL[] = [];
    if (q.type) filters.push(inArray(documents.type, q.type.split(",")));
    if (q.group && q.group in DOC_GROUPS) {
      const types = Object.entries(DOC_TYPES)
        .filter(([, s]) => s.group === (q.group as DocGroup))
        .map(([k]) => k);
      filters.push(inArray(documents.type, types));
    }
    if (q.counterparty && Number(q.counterparty) > 0) filters.push(eq(documents.counterpartyId, Number(q.counterparty)));
    if (q.client && Number(q.client) > 0) {
      const id = Number(q.client);
      filters.push(or(eq(documents.clientId, id), eq(documents.counterpartyId, id))!);
    }
    if (q.shipment && Number(q.shipment) > 0) filters.push(eq(documents.shipmentId, Number(q.shipment)));
    if (q.parent && Number(q.parent) > 0) filters.push(eq(documents.parentId, Number(q.parent)));
    if (q.payment && q.payment in PAYMENT_STATUSES) filters.push(eq(documents.paymentStatus, q.payment as keyof typeof PAYMENT_STATUSES));
    if (q.payment === "debt") filters.push(inArray(documents.paymentStatus, ["unpaid", "partial"]));
    if (q.expiring) {
      const days = Math.min(365, Math.max(1, Number(q.expiring) || 30));
      filters.push(
        isNotNull(documents.validUntil),
        sql`${documents.validUntil} <= current_date + ${days}::int`,
        or(sql`${documents.status} is null`, ne(documents.status, "cancelled"))!,
      );
    }
    if (q.q?.trim()) {
      const like = `%${q.q.trim().slice(0, 100).replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      filters.push(
        or(
          ilike(documents.number, like),
          ilike(documents.notes, like),
          ilike(documentListAliases.cp.name, like),
          ilike(documentListAliases.cl.name, like),
          sql`exists (select 1 from document_items i where i.document_id = ${documents.id} and i.name ilike ${like})`,
        )!,
      );
    }
    const rows = await documentListQuery(db)
      .where(filters.length ? and(...filters) : undefined)
      .orderBy(q.expiring ? asc(documents.validUntil) : desc(documents.date), desc(documents.id))
      .limit(Math.min(Number(q.limit) || 300, 1000));
    return { documents: rows };
  });

  /** Подсказка формы: следующий номер приложения в договоре. */
  app.get("/documents/next-seq", async (request) => {
    const q = request.query as { parent?: string; type?: string };
    const parentId = intParam(q.parent, "parent");
    const seq = await nextSeqNo(db, parentId, String(q.type ?? ""));
    return { seqNo: seq, number: pad2(seq) };
  });

  app.get("/documents/:id", async (request) => {
    const id = intParam((request.params as { id: string }).id);
    const [row] = await documentListQuery(db).where(eq(documents.id, id));
    if (!row) throw new HttpError(404, "Документ не найден");
    const doc = await getDocument(id);
    const [items, files, children] = await Promise.all([
      documentItemsOf(db, id),
      db
        .select({
          id: attachments.id,
          filename: attachments.filename,
          mime: attachments.mime,
          size: attachments.size,
          label: attachments.label,
          createdAt: attachments.createdAt,
          createdByName: users.name,
        })
        .from(attachments)
        .leftJoin(users, eq(users.id, attachments.createdBy))
        .where(and(eq(attachments.ownerType, "document"), eq(attachments.ownerId, id)))
        .orderBy(asc(attachments.createdAt)),
      documentListQuery(db).where(eq(documents.parentId, id)).orderBy(asc(documents.seqNo), desc(documents.date)),
    ]);
    return {
      document: { ...row, data: doc.data, notes: doc.notes, createdBy: doc.createdBy },
      items,
      files,
      children,
      parentLabel: doc.parentId ? await documentLabel(db, doc.parentId) : null,
    };
  });

  /**
   * Новый документ. Дополнительно:
   *   items — позиции (товары находятся или создаются в справочнике);
   *   newShipment: { clientId, title, scheme? } — создать сделку и привязать документ к ней.
   */
  app.post("/documents", async (request) => {
    const user = currentUser(request);
    const input = body<Record<string, unknown>>(request);
    const type = String(input.type ?? "");
    const spec = docSpec(type);
    if (!spec) throw new HttpError(400, "Выберите тип документа");

    const result = await db.transaction(async (tx) => {
      const fields = await parseDocumentFields(tx, input, type);

      // Новая сделка из документа (обычно — из инвойса поставщика).
      let created: { number: number } | null = null;
      if (!fields.shipmentId && input.newShipment && typeof input.newShipment === "object") {
        const ns = input.newShipment as { clientId?: unknown; title?: unknown; scheme?: unknown };
        const firstItem = Array.isArray(input.items) ? (input.items[0] as { name?: string } | undefined)?.name : undefined;
        const title =
          (typeof ns.title === "string" && ns.title.trim()) || firstItem || `${spec.label}${fields.number ? ` № ${fields.number}` : ""}`;
        const sh = await createShipment(
          tx,
          {
            title: String(title).slice(0, 300),
            scheme: ns.scheme === "supply" || ns.scheme === "teu" ? ns.scheme : "commission",
            clientId: ns.clientId ?? null,
            supplierId: spec.party === "supplier" ? (fields.counterpartyId ?? null) : null,
            depositDate: new Date().toISOString().slice(0, 10),
          },
          user.id,
        );
        await audit(tx, { userId: user.id, action: "create", entityType: "shipment", entityId: sh.number, summary: `Создал сделку «${sh.title}» из документа`, ip: request.ip });
        fields.shipmentId = sh.id;
        created = { number: sh.number };
      }

      if (type === "commission_order" && fields.shipmentId) await assertSingleOrder(tx, fields.shipmentId);
      if (spec.numberedInParent && fields.parentId && !fields.seqNo) {
        fields.seqNo = await nextSeqNo(tx, fields.parentId, type);
        if (!fields.number) fields.number = pad2(fields.seqNo);
      }
      if (spec.signable && !("status" in input)) fields.status = "draft";
      if (spec.payable && !("paymentStatus" in input)) fields.paymentStatus = "unpaid";

      const [doc] = await tx
        .insert(documents)
        .values({ ...fields, type, createdBy: user.id })
        .returning();

      const patch: Partial<typeof documents.$inferInsert> = {};
      if (spec.items && Array.isArray(input.items)) {
        const total = await replaceItems(tx, user.id, doc.id, input.items);
        if (total !== null && fields.amount == null) patch.amount = String(total);
      }
      Object.assign(patch, await linkToShipment(tx, user.id, doc));
      if (Object.keys(patch).length) await tx.update(documents).set(patch).where(eq(documents.id, doc.id));

      const label = await documentLabel(tx, doc.id);
      if (doc.shipmentId) await addShipmentEvent(tx, doc.shipmentId, user.id, "document_added", null, null, label);
      await audit(tx, {
        userId: user.id,
        action: "create",
        entityType: "document",
        entityId: doc.id,
        summary: `Добавил документ: ${label}`,
        ip: request.ip,
      });
      return { id: doc.id, created };
    });
    return { document: { id: result.id }, shipment: result.created };
  });

  app.patch("/documents/:id", async (request) => {
    const user = currentUser(request);
    const id = intParam((request.params as { id: string }).id);
    const input = body<Record<string, unknown>>(request);
    return db.transaction(async (tx) => {
      const before = await getDocument(id);
      const spec = docSpec(before.type)!;
      const fields = await parseDocumentFields(tx, input, before.type);
      if (before.type === "commission_order" && (fields.shipmentId ?? before.shipmentId) && fields.status !== "cancelled") {
        await assertSingleOrder(tx, (fields.shipmentId ?? before.shipmentId)!, id);
      }
      if (fields.paymentStatus === "paid" && !("paidAt" in input) && !before.paidAt) fields.paidAt = new Date().toISOString().slice(0, 10);
      if (spec.items && Array.isArray(input.items)) {
        const total = await replaceItems(tx, user.id, id, input.items);
        if (total !== null && !("amount" in input)) fields.amount = String(total);
      }
      await tx
        .update(documents)
        .set({ ...fields, updatedAt: new Date() })
        .where(eq(documents.id, id));
      const after = await getDocument(id);
      if (after.shipmentId !== before.shipmentId || after.counterpartyId !== before.counterpartyId) {
        const patch = await linkToShipment(tx, user.id, after);
        if (Object.keys(patch).length) await tx.update(documents).set(patch).where(eq(documents.id, id));
        if (after.shipmentId && after.shipmentId !== before.shipmentId) {
          await addShipmentEvent(tx, after.shipmentId, user.id, "document_added", null, null, await documentLabel(tx, id));
        }
      }
      if (after.shipmentId && fields.paymentStatus && fields.paymentStatus !== before.paymentStatus) {
        await addShipmentEvent(
          tx,
          after.shipmentId,
          user.id,
          "payment_changed",
          null,
          await documentLabel(tx, id),
          PAYMENT_STATUSES[fields.paymentStatus],
        );
      }
      await audit(tx, {
        userId: user.id,
        action: "update",
        entityType: "document",
        entityId: id,
        summary: `Изменил документ: ${await documentLabel(tx, id)}`,
        ip: request.ip,
      });
      return { ok: true };
    });
  });

  /** Удаление: автор документа или admin. Приложения и инвойсы договора остаются (без договора). */
  app.delete("/documents/:id", async (request) => {
    const user = currentUser(request);
    const id = intParam((request.params as { id: string }).id);
    const stored = await db.transaction(async (tx) => {
      const doc = await getDocument(id);
      if (doc.createdBy !== user.id && user.role !== "admin") {
        throw new HttpError(403, "Удалить документ может его автор или администратор");
      }
      const label = await documentLabel(tx, id);
      const keys = await deleteAttachmentRows(tx, "document", [id]);
      await tx.delete(documents).where(eq(documents.id, id));
      if (doc.shipmentId) await addShipmentEvent(tx, doc.shipmentId, user.id, "document_removed", null, label, null);
      await audit(tx, {
        userId: user.id,
        action: "delete",
        entityType: "document",
        entityId: id,
        summary: `Удалил документ: ${label}`,
        data: doc,
        ip: request.ip,
      });
      return keys;
    });
    await unlinkStoredFiles(stored);
    return { ok: true };
  });
}
