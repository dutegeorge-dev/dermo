/** Документы: реестр, карточка, создание (в т.ч. «новая сделка из инвойса»), правка, удаление. */

import { and, asc, desc, eq, ilike, inArray, isNotNull, ne, or, sql, type SQL } from "drizzle-orm";
import type { FastifyInstance } from "fastify";

import { DOC_GROUPS, DOC_TYPES, type DocGroup, docSpec, PAYMENT_STATUSES } from "../../shared/documents.ts";
import { db } from "../db/client.ts";
import { attachments, counterparties, deals, documents, users } from "../db/schema.ts";
import { audit } from "../lib/audit.ts";
import { addEvent, createDeal, documentLabel } from "../lib/deals.ts";
import {
  assertSingleOrder,
  documentItemsOf,
  documentListAliases,
  documentListQuery,
  linkToDeal,
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
   * и где он сторона, и где указан клиентом), deal, parent, payment, expiring (дней), q.
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
    if (q.deal && Number(q.deal) > 0) filters.push(eq(documents.dealId, Number(q.deal)));
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
   *   newDeal: { clientId, title?, scheme? } — создать сделку и привязать документ к ней.
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
      let createdDealKey: string | null = null;
      if (!fields.dealId && input.newDeal && typeof input.newDeal === "object") {
        const nd = input.newDeal as { clientId?: unknown; title?: unknown; scheme?: unknown };
        const clientId = nd.clientId ? Number(nd.clientId) : null;
        if (clientId) {
          const [c] = await tx.select({ id: counterparties.id }).from(counterparties).where(eq(counterparties.id, clientId));
          if (!c) throw new HttpError(400, "Клиент не найден");
        }
        const firstItem = Array.isArray(input.items) ? (input.items[0] as { name?: string } | undefined)?.name : undefined;
        const title =
          (typeof nd.title === "string" && nd.title.trim()) ||
          firstItem ||
          `${spec.label}${fields.number ? ` № ${fields.number}` : ""}`;
        const scheme = nd.scheme === "supply" || nd.scheme === "teu" ? nd.scheme : "commission";
        const deal = await createDeal(
          tx,
          user.id,
          {
            title: String(title).slice(0, 300),
            scheme,
            clientId,
            supplierId: spec.party === "supplier" ? (fields.counterpartyId ?? null) : null,
          },
          { ip: request.ip },
        );
        fields.dealId = deal.id;
        createdDealKey = deal.key;
      }

      if (type === "commission_order" && fields.dealId) await assertSingleOrder(tx, fields.dealId);
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
      Object.assign(patch, await linkToDeal(tx, user.id, doc));
      if (Object.keys(patch).length) await tx.update(documents).set(patch).where(eq(documents.id, doc.id));

      const label = await documentLabel(tx, doc.id);
      if (doc.dealId) await addEvent(tx, doc.dealId, user.id, "document_added", null, null, label);
      await audit(tx, {
        userId: user.id,
        action: "create",
        entityType: "document",
        entityId: doc.id,
        summary: `Добавил документ: ${label}`,
        ip: request.ip,
      });
      return { id: doc.id, dealKey: createdDealKey };
    });
    return { document: { id: result.id }, deal: result.dealKey ? { key: result.dealKey } : null };
  });

  app.patch("/documents/:id", async (request) => {
    const user = currentUser(request);
    const id = intParam((request.params as { id: string }).id);
    const input = body<Record<string, unknown>>(request);
    return db.transaction(async (tx) => {
      const before = await getDocument(id);
      const spec = docSpec(before.type)!;
      const fields = await parseDocumentFields(tx, input, before.type);
      if (before.type === "commission_order" && (fields.dealId ?? before.dealId) && fields.status !== "cancelled") {
        await assertSingleOrder(tx, (fields.dealId ?? before.dealId)!, id);
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
      if (after.dealId !== before.dealId || after.counterpartyId !== before.counterpartyId) {
        const patch = await linkToDeal(tx, user.id, after);
        if (Object.keys(patch).length) await tx.update(documents).set(patch).where(eq(documents.id, id));
        if (after.dealId && after.dealId !== before.dealId) {
          await addEvent(tx, after.dealId, user.id, "document_added", null, null, await documentLabel(tx, id));
        }
      }
      if (after.dealId && fields.paymentStatus && fields.paymentStatus !== before.paymentStatus) {
        await addEvent(
          tx,
          after.dealId,
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
      await tx.update(deals).set({ clientContractId: null }).where(eq(deals.clientContractId, id));
      await tx.update(deals).set({ supplierContractId: null }).where(eq(deals.supplierContractId, id));
      await tx.delete(documents).where(eq(documents.id, id));
      if (doc.dealId) await addEvent(tx, doc.dealId, user.id, "document_removed", null, label, null);
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
