/** Товары: справочник, история цен у поставщиков, кому продавали. */

import { and, asc, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";

import { db } from "../db/client.ts";
import { counterparties, documentItems, documents, productOffers, products, shipments, tnved } from "../db/schema.ts";
import { audit } from "../lib/audit.ts";
import { body, currentUser, HttpError, intParam, requireAdmin } from "../lib/http.ts";
import { productBaseKey, productBaseName } from "../lib/product-match.ts";

const s = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) || null : null);

function productValues(input: Record<string, unknown>) {
  const v: Partial<typeof products.$inferInsert> = {};
  if ("name" in input) {
    const name = s(input.name, 500);
    if (!name) throw new HttpError(400, "Укажите наименование");
    v.name = name;
  }
  if ("nameRu" in input) v.nameRu = s(input.nameRu, 500);
  if ("hsCode" in input) {
    const code = typeof input.hsCode === "string" ? input.hsCode.replace(/\D/g, "") : "";
    if (code && code.length !== 10) throw new HttpError(400, "Код ТН ВЭД — 10 цифр");
    v.hsCode = code || null;
  }
  if ("vat10" in input) v.vat10 = Boolean(input.vat10);
  if ("unit" in input) v.unit = s(input.unit, 30);
  if ("notes" in input) v.notes = typeof input.notes === "string" ? input.notes.slice(0, 5000) : "";
  return v;
}

export async function productRoutes(app: FastifyInstance): Promise<void> {
  app.get("/products", async (request) => {
    const user = currentUser(request);
    const visible = user.role === "admin" ? sql`true` : sql`(f.counterparty_id is not null or f.found_by = ${user.id})`;
    const q = String((request.query as { q?: string }).q ?? "").trim().slice(0, 100);
    const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const rows = await db
      .select({
        id: products.id,
        name: products.name,
        nameRu: products.nameRu,
        hsCode: products.hsCode,
        unit: products.unit,
        vat10: products.vat10,
        tariff: sql<string | null>`(select t.tariff from tnved t where t.code = "products"."hs_code")`,
        updatedAt: products.updatedAt,
        // Последняя закупочная цена — из самого свежего инвойса поставщика.
        lastPrice: sql<number | null>`(select i.price::float8 from document_items i join documents d on d.id = i.document_id
          where i.product_id = "products"."id" and d.type = 'supplier_invoice' order by d.date desc nulls last, d.id desc limit 1)`,
        lastCurrency: sql<string | null>`(select d.currency from document_items i join documents d on d.id = i.document_id
          where i.product_id = "products"."id" and d.type = 'supplier_invoice' order by d.date desc nulls last, d.id desc limit 1)`,
        supplierCount: sql<number>`(select count(distinct d.counterparty_id)::int from document_items i join documents d on d.id = i.document_id
          where i.product_id = "products"."id" and d.type = 'supplier_invoice')`,
        clientCount: sql<number>`(select count(distinct coalesce(d.client_id, sh.client_id))::int from document_items i
          join documents d on d.id = i.document_id left join shipments sh on sh.id = d.shipment_id
          where i.product_id = "products"."id")`,
        // Варианты — разные названия позиций (размер рулона, цвет) у документов и цен фабрик.
        variantCount: sql<number>`(select count(*)::int from (select lower(i.name) from document_items i where i.product_id = "products"."id"
          union select lower(o.name) from product_offers o where o.product_id = "products"."id") v)`,
        factoryCount: sql<number>`(select count(distinct o.factory_id)::int from product_offers o join factories f on f.id = o.factory_id
          where o.product_id = "products"."id" and ${visible})`,
        bestOffer: sql<{ price: number; currency: string; unit: string | null } | null>`(select json_build_object('price', o.price::float8, 'currency', o.currency, 'unit', o.unit)
          from product_offers o join factories f on f.id = o.factory_id
          where o.product_id = "products"."id" and o.price is not null and ${visible} order by (o.currency = 'CNY') desc, o.price limit 1)`,
      })
      .from(products)
      .where(
        q
          ? or(
              ilike(products.name, like),
              ilike(products.nameRu, like),
              ilike(products.hsCode, like),
              sql`exists (select 1 from document_items i where i.product_id = "products"."id" and i.name ilike ${like})`,
              sql`exists (select 1 from product_offers o where o.product_id = "products"."id" and o.name ilike ${like})`,
            )
          : undefined,
      )
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
    const [tn] = product.hsCode ? await db.select().from(tnved).where(eq(tnved.code, product.hsCode)) : [];
    const lines = await db
      .select({
        documentId: documents.id,
        type: documents.type,
        number: documents.number,
        date: documents.date,
        currency: documents.currency,
        counterpartyId: documents.counterpartyId,
        counterpartyName: counterparties.name,
        clientId: sql<number | null>`coalesce(${documents.clientId}, ${shipments.clientId})`,
        clientName: sql<string | null>`(select c.name from counterparties c where c.id = coalesce(${documents.clientId}, ${shipments.clientId}))`,
        shipmentNumber: shipments.number,
        shipmentTitle: shipments.title,
        quantity: sql<number | null>`${documentItems.quantity}::float8`,
        unit: documentItems.unit,
        price: sql<number | null>`${documentItems.price}::float8`,
        amount: sql<number | null>`${documentItems.amount}::float8`,
      })
      .from(documentItems)
      .innerJoin(documents, eq(documents.id, documentItems.documentId))
      .leftJoin(counterparties, eq(counterparties.id, documents.counterpartyId))
      .leftJoin(shipments, eq(shipments.id, documents.shipmentId))
      .where(eq(documentItems.productId, id))
      .orderBy(desc(documents.date), desc(documents.id))
      .limit(500);
    // Варианты: как товар называется в документах и у фабрик (размер рулона, цвет, плотность).
    const variants = await db.execute<{ name: string; documents: number; offers: number }>(sql`
      select min(name) as name, sum(d)::int as documents, sum(o)::int as offers from (
        select name, 1 as d, 0 as o from document_items where product_id = ${id}
        union all select name, 0, 1 from product_offers where product_id = ${id}) x
      group by lower(name) order by min(name) limit 200`);
    return {
      product,
      variants: variants.rows,
      tnved: tn ? { name: tn.name, tariff: tn.tariff } : null,
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

  /**
   * Дубли: товары, у которых название без варианта (размер рулона, цвет, число мест) совпадает —
   * «Трава 20 мм, 1×25 м» и «Трава 20 мм, 2×25 м» — это один товар.
   */
  app.get("/products/duplicates", async () => {
    const rows = await db
      .select({
        id: products.id,
        name: products.name,
        hsCode: products.hsCode,
        uses: sql<number>`(select count(*)::int from document_items i where i.product_id = "products"."id")
          + (select count(*)::int from product_offers o where o.product_id = "products"."id")`,
      })
      .from(products)
      .orderBy(asc(products.name));
    const groups = new Map<string, { baseName: string; products: typeof rows }>();
    for (const r of rows) {
      const key = productBaseKey(r.name);
      if (!key) continue;
      const g = groups.get(key) ?? { baseName: productBaseName(r.name), products: [] };
      g.products.push(r);
      groups.set(key, g);
    }
    return { groups: [...groups.values()].filter((g) => g.products.length > 1) };
  });

  /** Объединить товары ids в первый: позиции документов и цены фабрик переходят к нему, остальные удаляются. */
  app.post("/products/merge", async (request) => {
    const user = currentUser(request);
    const input = body<{ ids: unknown; name: unknown }>(request);
    const ids = [...new Set((Array.isArray(input.ids) ? input.ids : []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
    if (ids.length < 2) throw new HttpError(400, "Выберите хотя бы два товара");
    const name = s(input.name, 500);
    return db.transaction(async (tx) => {
      const found = await tx.select().from(products).where(inArray(products.id, ids));
      if (found.length !== ids.length) throw new HttpError(404, "Товар не найден");
      const [targetId, ...fromIds] = ids;
      const target = found.find((p) => p.id === targetId)!;
      await tx.update(documentItems).set({ productId: targetId }).where(inArray(documentItems.productId, fromIds));
      await tx.update(productOffers).set({ productId: targetId }).where(inArray(productOffers.productId, fromIds));
      const others = found.filter((p) => p.id !== targetId);
      await tx
        .update(products)
        .set({
          name: name ?? target.name,
          nameRu: target.nameRu ?? others.find((p) => p.nameRu)?.nameRu ?? null,
          hsCode: target.hsCode ?? others.find((p) => p.hsCode)?.hsCode ?? null,
          unit: target.unit ?? others.find((p) => p.unit)?.unit ?? null,
          vat10: target.vat10 || others.some((p) => p.vat10),
          updatedAt: new Date(),
        })
        .where(eq(products.id, targetId));
      await tx.delete(products).where(inArray(products.id, fromIds));
      await audit(tx, {
        userId: user.id,
        action: "update",
        entityType: "product",
        entityId: targetId,
        summary: `Объединил товары ${others.map((p) => `«${p.name}»`).join(", ")} в «${name ?? target.name}»`,
        ip: request.ip,
      });
      return { ok: true, id: targetId };
    });
  });

  /** Объединить дубли: позиции и цены товара from переходят к товару id, from удаляется. */
  app.post("/products/:id/merge", async (request) => {
    const user = currentUser(request);
    const id = intParam((request.params as { id: string }).id);
    const fromId = intParam(body<{ fromId: number }>(request).fromId, "fromId");
    if (fromId === id) throw new HttpError(400, "Нельзя объединить товар сам с собой");
    return db.transaction(async (tx) => {
      const found = await tx.select().from(products).where(inArray(products.id, [id, fromId]));
      if (found.length !== 2) throw new HttpError(404, "Товар не найден");
      await tx.update(documentItems).set({ productId: id }).where(eq(documentItems.productId, fromId));
      await tx.update(productOffers).set({ productId: id }).where(eq(productOffers.productId, fromId));
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
    const [offered] = await db.select({ id: productOffers.id }).from(productOffers).where(eq(productOffers.productId, id)).limit(1);
    if (offered) throw new HttpError(409, "На товар есть цены фабрик — удалить нельзя (можно объединить с другим)");
    const [removed] = await db.delete(products).where(eq(products.id, id)).returning();
    if (!removed) throw new HttpError(404, "Товар не найден");
    await audit(db, { userId: admin.id, action: "delete", entityType: "product", entityId: id, summary: `Удалил товар «${removed.name}»`, ip: request.ip });
    return { ok: true };
  });
}
