/** Товары: справочник, история цен у поставщиков, кому продавали. */

import { and, asc, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";

import { db } from "../db/client.ts";
import { counterparties, deals, documentItems, documents, products } from "../db/schema.ts";
import { audit } from "../lib/audit.ts";
import { body, currentUser, HttpError, intParam, requireAdmin } from "../lib/http.ts";

const s = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) || null : null);

function productValues(input: Record<string, unknown>) {
  const v: Partial<typeof products.$inferInsert> = {};
  if ("name" in input) {
    const name = s(input.name, 500);
    if (!name) throw new HttpError(400, "Укажите наименование");
    v.name = name;
  }
  if ("nameRu" in input) v.nameRu = s(input.nameRu, 500);
  if ("hsCode" in input) v.hsCode = s(input.hsCode, 20);
  if ("unit" in input) v.unit = s(input.unit, 30);
  if ("notes" in input) v.notes = typeof input.notes === "string" ? input.notes.slice(0, 5000) : "";
  return v;
}

export async function productRoutes(app: FastifyInstance): Promise<void> {
  app.get("/products", async (request) => {
    const q = String((request.query as { q?: string }).q ?? "").trim().slice(0, 100);
    const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const rows = await db
      .select({
        id: products.id,
        name: products.name,
        nameRu: products.nameRu,
        hsCode: products.hsCode,
        unit: products.unit,
        updatedAt: products.updatedAt,
        // Последняя закупочная цена — из самого свежего инвойса поставщика.
        lastPrice: sql<number | null>`(select i.price::float8 from document_items i join documents d on d.id = i.document_id
          where i.product_id = "products"."id" and d.type = 'supplier_invoice' order by d.date desc nulls last, d.id desc limit 1)`,
        lastCurrency: sql<string | null>`(select d.currency from document_items i join documents d on d.id = i.document_id
          where i.product_id = "products"."id" and d.type = 'supplier_invoice' order by d.date desc nulls last, d.id desc limit 1)`,
        supplierCount: sql<number>`(select count(distinct d.counterparty_id)::int from document_items i join documents d on d.id = i.document_id
          where i.product_id = "products"."id" and d.type = 'supplier_invoice')`,
        clientCount: sql<number>`(select count(distinct coalesce(d.client_id, dl.client_id))::int from document_items i
          join documents d on d.id = i.document_id left join deals dl on dl.id = d.deal_id
          where i.product_id = "products"."id")`,
      })
      .from(products)
      .where(q ? or(ilike(products.name, like), ilike(products.nameRu, like), ilike(products.hsCode, like)) : undefined)
      .orderBy(asc(products.name))
      .limit(q ? 30 : 1000);
    return { products: rows };
  });

  app.post("/products", async (request) => {
    const user = currentUser(request);
    const v = productValues(body<Record<string, unknown>>(request));
    if (!v.name) throw new HttpError(400, "Укажите наименование");
    const [product] = await db.insert(products).values({ ...v, name: v.name, createdBy: user.id }).returning();
    await audit(db, { userId: user.id, action: "create", entityType: "product", entityId: product.id, summary: `Добавил товар «${product.name}»`, ip: request.ip });
    return { product };
  });

  /** Карточка: закупки (поставщик, цена, дата), продажи/поручения (клиент, цена), сертификаты. */
  app.get("/products/:id", async (request) => {
    const id = intParam((request.params as { id: string }).id);
    const [product] = await db.select().from(products).where(eq(products.id, id));
    if (!product) throw new HttpError(404, "Товар не найден");
    const lines = await db
      .select({
        documentId: documents.id,
        type: documents.type,
        number: documents.number,
        date: documents.date,
        currency: documents.currency,
        counterpartyId: documents.counterpartyId,
        counterpartyName: counterparties.name,
        clientId: sql<number | null>`coalesce(${documents.clientId}, ${deals.clientId})`,
        clientName: sql<string | null>`(select c.name from counterparties c where c.id = coalesce(${documents.clientId}, ${deals.clientId}))`,
        dealKey: deals.key,
        quantity: sql<number | null>`${documentItems.quantity}::float8`,
        unit: documentItems.unit,
        price: sql<number | null>`${documentItems.price}::float8`,
        amount: sql<number | null>`${documentItems.amount}::float8`,
      })
      .from(documentItems)
      .innerJoin(documents, eq(documents.id, documentItems.documentId))
      .leftJoin(counterparties, eq(counterparties.id, documents.counterpartyId))
      .leftJoin(deals, eq(deals.id, documents.dealId))
      .where(eq(documentItems.productId, id))
      .orderBy(desc(documents.date), desc(documents.id))
      .limit(500);
    return {
      product,
      purchases: lines.filter((l) => l.type === "supplier_invoice"),
      sales: lines.filter((l) => l.type === "commission_order" || l.type === "specification"),
      certificates: lines.filter((l) => l.type === "conformity"),
    };
  });

  app.patch("/products/:id", async (request) => {
    const user = currentUser(request);
    const id = intParam((request.params as { id: string }).id);
    const [product] = await db
      .update(products)
      .set({ ...productValues(body<Record<string, unknown>>(request)), updatedAt: new Date() })
      .where(eq(products.id, id))
      .returning();
    if (!product) throw new HttpError(404, "Товар не найден");
    await audit(db, { userId: user.id, action: "update", entityType: "product", entityId: id, summary: `Изменил товар «${product.name}»`, ip: request.ip });
    return { product };
  });

  /** Объединить дубли: позиции товара from переходят к товару id, from удаляется. */
  app.post("/products/:id/merge", async (request) => {
    const user = currentUser(request);
    const id = intParam((request.params as { id: string }).id);
    const fromId = intParam(body<{ fromId: number }>(request).fromId, "fromId");
    if (fromId === id) throw new HttpError(400, "Нельзя объединить товар сам с собой");
    return db.transaction(async (tx) => {
      const found = await tx.select().from(products).where(inArray(products.id, [id, fromId]));
      if (found.length !== 2) throw new HttpError(404, "Товар не найден");
      await tx.update(documentItems).set({ productId: id }).where(eq(documentItems.productId, fromId));
      const [removed] = await tx.delete(products).where(eq(products.id, fromId)).returning();
      await audit(tx, { userId: user.id, action: "update", entityType: "product", entityId: id, summary: `Объединил товар «${removed.name}» с «${found.find((p) => p.id === id)!.name}»`, ip: request.ip });
      return { ok: true };
    });
  });

  app.delete("/products/:id", async (request) => {
    const admin = requireAdmin(request);
    const id = intParam((request.params as { id: string }).id);
    const [used] = await db.select({ id: documentItems.id }).from(documentItems).where(and(eq(documentItems.productId, id))).limit(1);
    if (used) throw new HttpError(409, "Товар есть в документах — удалить нельзя (можно объединить с другим)");
    const [removed] = await db.delete(products).where(eq(products.id, id)).returning();
    if (!removed) throw new HttpError(404, "Товар не найден");
    await audit(db, { userId: admin.id, action: "delete", entityType: "product", entityId: id, summary: `Удалил товар «${removed.name}»`, ip: request.ip });
    return { ok: true };
  });
}
