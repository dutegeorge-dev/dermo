/** База фабрик: список, дубли по WeChat, карточка с анкетой, ценами и файлами, «сделать поставщиком». */

import { and, asc, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";

import { FACTORY_STATUSES } from "../../shared/factories.ts";
import { db } from "../db/client.ts";
import { attachments, contacts, counterparties, factories, productOffers, products, users } from "../db/schema.ts";
import { audit } from "../lib/audit.ts";
import { factoryAccess, factoryValues, getFactory, normWechat, offerValues, replaceOffers } from "../lib/factories.ts";
import { body, currentUser, HttpError, intParam } from "../lib/http.ts";
import { deleteAttachmentRows, unlinkStoredFiles } from "./files.ts";

const like = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

const offerColumns = {
  id: productOffers.id,
  productId: productOffers.productId,
  productName: products.name,
  name: productOffers.name,
  price: sql<number | null>`${productOffers.price}::float8`,
  currency: productOffers.currency,
  unit: productOffers.unit,
  moq: sql<number | null>`${productOffers.moq}::float8`,
  perContainer: sql<number | null>`${productOffers.perContainer}::float8`,
  kgPerUnit: sql<number | null>`${productOffers.kgPerUnit}::float8`,
  m3PerUnit: sql<number | null>`${productOffers.m3PerUnit}::float8`,
  conditions: productOffers.conditions,
  quotedAt: productOffers.quotedAt,
};

export async function factoryRoutes(app: FastifyInstance): Promise<void> {
  app.get("/factories", async (request) => {
    const user = currentUser(request);
    const query = request.query as { q?: string; status?: string; category?: string; flag?: string; mine?: string };
    const q = String(query.q ?? "").trim().slice(0, 100);
    const filters = [factoryAccess(user)];
    if (q) {
      const l = like(q);
      filters.push(
        or(
          ilike(factories.name, l),
          ilike(factories.nameRu, l),
          ilike(factories.wechatId, l),
          ilike(factories.contactName, l),
          ilike(factories.phone, l),
          ilike(factories.location, l),
          sql`exists (select 1 from unnest(${factories.categories}) c where c ilike ${l})`,
          sql`exists (select 1 from product_offers o left join products p on p.id = o.product_id
            where o.factory_id = ${factories.id} and (o.name ilike ${l} or p.name ilike ${l} or p.name_ru ilike ${l}))`,
          sql`exists (select 1 from catalogs k where k.factory_id = ${factories.id} and k.text ilike ${l})`,
        ),
      );
    }
    if (query.status === "supplier") filters.push(sql`${factories.counterpartyId} is not null`);
    else if (query.status && query.status in FACTORY_STATUSES) filters.push(eq(factories.status, query.status));
    if (query.category) filters.push(sql`${query.category.toLowerCase()} = any(${factories.categories})`);
    if (query.flag === "export") filters.push(sql`${factories.profile} ->> 'exportLicense' = 'yes'`);
    if (query.flag === "vtb") filters.push(sql`${factories.profile} ->> 'vtbShanghai' = 'yes'`);
    if (query.flag === "russia") filters.push(sql`coalesce(${factories.profile} ->> 'russianClients', '') !~* '^\\s*(нет|no)?\\s*$'`);
    if (query.mine) filters.push(eq(factories.foundBy, user.id));
    const rows = await db
      .select({
        id: factories.id,
        name: factories.name,
        nameRu: factories.nameRu,
        wechatId: factories.wechatId,
        contactName: factories.contactName,
        location: factories.location,
        categories: factories.categories,
        status: factories.status,
        counterpartyId: factories.counterpartyId,
        foundByName: users.name,
        updatedAt: factories.updatedAt,
        exportLicense: sql<string>`coalesce(${factories.profile} ->> 'exportLicense', '')`,
        photoId: sql<string | null>`(select a.id from attachments a where a.owner_type = 'factory' and a.owner_id = ${factories.id}
          and a.mime like 'image/%' order by (a.label = 'photo') desc, a.created_at limit 1)`,
        offers: sql<{ name: string; price: number | null; currency: string; unit: string | null }[]>`coalesce((select json_agg(x) from (
          select coalesce(p.name, o.name) as name, o.price::float8 as price, o.currency, o.unit from product_offers o
          left join products p on p.id = o.product_id where o.factory_id = ${factories.id} order by o.position limit 4) x), '[]'::json)`,
      })
      .from(factories)
      .leftJoin(users, eq(users.id, factories.foundBy))
      .where(and(...filters))
      .orderBy(desc(factories.updatedAt))
      .limit(q ? 100 : 500);
    const categories = await db.execute<{ c: string; n: number }>(
      sql`select c, count(*)::int n from factories, unnest(categories) c where ${and(factoryAccess(user)) ?? sql`true`} group by c order by n desc, c limit 60`,
    );
    return { factories: rows, categories: categories.rows };
  });

  /** Есть ли уже такая фабрика (WeChat ID, телефон, название). Чужого кандидата не раскрываем — только кто нашёл. */
  app.get("/factories/duplicates", async (request) => {
    const user = currentUser(request);
    const query = request.query as { wechatId?: string; phone?: string; name?: string; except?: string };
    const conds = [];
    const wechat = normWechat(query.wechatId);
    if (wechat.length >= 3) conds.push(sql`lower(regexp_replace(${factories.wechatId}, '\\s', '', 'g')) = ${wechat}`);
    const phone = String(query.phone ?? "").replace(/\D/g, "");
    if (phone.length >= 7) conds.push(sql`regexp_replace(coalesce(${factories.phone}, ''), '\\D', '', 'g') like ${`%${phone.slice(-9)}`}`);
    const name = String(query.name ?? "").trim();
    if (name.length >= 4) conds.push(sql`lower(${factories.name}) = ${name.toLowerCase()}`);
    if (!conds.length) return { duplicates: [] };
    const rows = await db
      .select({ id: factories.id, name: factories.name, foundByName: users.name, foundBy: factories.foundBy, counterpartyId: factories.counterpartyId })
      .from(factories)
      .leftJoin(users, eq(users.id, factories.foundBy))
      .where(and(or(...conds), query.except ? sql`${factories.id} <> ${Number(query.except) || 0}` : undefined))
      .limit(5);
    return {
      duplicates: rows.map((r) => {
        const visible = user.role === "admin" || r.counterpartyId !== null || r.foundBy === user.id;
        return { id: visible ? r.id : null, name: visible ? r.name : null, foundByName: r.foundByName };
      }),
    };
  });

  app.post("/factories", async (request) => {
    const user = currentUser(request);
    const input = body<Record<string, unknown>>(request);
    const values = factoryValues(input, user);
    if (!values.name) throw new HttpError(400, "Укажите название фабрики (как в WeChat)");
    const offers = (Array.isArray(input.offers) ? input.offers : []).map(offerValues).filter((o) => o !== null);
    const factory = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(factories)
        .values({ ...values, name: values.name!, foundBy: values.foundBy ?? user.id, createdBy: user.id })
        .returning();
      await replaceOffers(tx, created.id, offers, user.id);
      await audit(tx, { userId: user.id, action: "create", entityType: "factory", entityId: created.id, summary: `Добавил фабрику «${created.name}»`, ip: request.ip });
      return created;
    });
    return { factory };
  });

  app.get("/factories/:id", async (request) => {
    const user = currentUser(request);
    const factory = await getFactory(db, user, intParam((request.params as { id: string }).id));
    const [offers, files, [foundBy], [supplier]] = await Promise.all([
      db.select(offerColumns).from(productOffers).leftJoin(products, eq(products.id, productOffers.productId)).where(eq(productOffers.factoryId, factory.id)).orderBy(asc(productOffers.position)),
      db
        .select({ id: attachments.id, filename: attachments.filename, mime: attachments.mime, size: attachments.size, label: attachments.label, createdAt: attachments.createdAt })
        .from(attachments)
        .where(and(eq(attachments.ownerType, "factory"), eq(attachments.ownerId, factory.id)))
        .orderBy(asc(attachments.createdAt)),
      factory.foundBy ? db.select({ id: users.id, name: users.name }).from(users).where(eq(users.id, factory.foundBy)) : [],
      factory.counterpartyId ? db.select({ id: counterparties.id, name: counterparties.name }).from(counterparties).where(eq(counterparties.id, factory.counterpartyId)) : [],
    ]);
    return { factory, offers, files, foundBy: foundBy ?? null, supplier: supplier ?? null };
  });

  app.patch("/factories/:id", async (request) => {
    const user = currentUser(request);
    const id = intParam((request.params as { id: string }).id);
    await getFactory(db, user, id);
    const input = body<Record<string, unknown>>(request);
    const values = factoryValues(input, user);
    const factory = await db.transaction(async (tx) => {
      const [updated] = await tx.update(factories).set({ ...values, updatedAt: new Date() }).where(eq(factories.id, id)).returning();
      if (Array.isArray(input.offers)) await replaceOffers(tx, id, input.offers.map(offerValues).filter((o) => o !== null), user.id);
      await audit(tx, { userId: user.id, action: "update", entityType: "factory", entityId: id, summary: `Изменил фабрику «${updated.name}»`, ip: request.ip });
      return updated;
    });
    return { factory };
  });

  /** Кандидата удаляет тот, кто нашёл, или админ; фабрику-поставщика — только админ. */
  app.delete("/factories/:id", async (request) => {
    const user = currentUser(request);
    const factory = await getFactory(db, user, intParam((request.params as { id: string }).id));
    if (user.role !== "admin" && (factory.counterpartyId || factory.foundBy !== user.id)) throw new HttpError(403, "Удалить может админ или тот, кто нашёл фабрику");
    const keys = await db.transaction(async (tx) => {
      const k = await deleteAttachmentRows(tx, "factory", [factory.id]);
      await tx.delete(factories).where(eq(factories.id, factory.id));
      await audit(tx, { userId: user.id, action: "delete", entityType: "factory", entityId: factory.id, summary: `Удалил фабрику «${factory.name}»`, data: factory, ip: request.ip });
      return k;
    });
    await unlinkStoredFiles(keys);
    return { ok: true };
  });

  /** Договорились — фабрика становится поставщиком (контрагент), её видят все. */
  app.post("/factories/:id/supplier", async (request) => {
    const user = currentUser(request);
    const factory = await getFactory(db, user, intParam((request.params as { id: string }).id));
    if (factory.counterpartyId) throw new HttpError(409, "Фабрика уже поставщик");
    const counterpartyId = await db.transaction(async (tx) => {
      const [cp] = await tx
        .insert(counterparties)
        .values({
          role: "supplier",
          kind: "foreign",
          country: "Китай",
          name: factory.nameRu || factory.name,
          email: factory.email,
          phone: factory.phone,
          website: factory.website,
          legalAddress: factory.location,
          notes: factory.notes,
          createdBy: user.id,
        })
        .returning({ id: counterparties.id, name: counterparties.name });
      if (factory.contactName || factory.wechatId) {
        await tx.insert(contacts).values({
          counterpartyId: cp.id,
          name: factory.contactName || factory.name,
          phone: factory.phone,
          messenger: factory.wechatId ? "wechat" : null,
          messengerHandle: factory.wechatId,
          email: factory.email,
          isPrimary: true,
        });
      }
      await tx.update(factories).set({ counterpartyId: cp.id, status: "approved", updatedAt: new Date() }).where(eq(factories.id, factory.id));
      await audit(tx, { userId: user.id, action: "update", entityType: "factory", entityId: factory.id, summary: `Фабрика «${factory.name}» стала поставщиком «${cp.name}»`, ip: request.ip });
      return cp.id;
    });
    return { counterpartyId };
  });

  /** Фабрики, которые делают товар — для карточки товара и расчёта. */
  app.get("/products/:id/offers", async (request) => {
    const user = currentUser(request);
    const productId = intParam((request.params as { id: string }).id);
    const rows = await db
      .select({ ...offerColumns, factoryId: factories.id, factoryName: factories.name, factoryNameRu: factories.nameRu, factoryLocation: factories.location, supplierId: factories.counterpartyId })
      .from(productOffers)
      .innerJoin(factories, eq(factories.id, productOffers.factoryId))
      .leftJoin(products, eq(products.id, productOffers.productId))
      .where(and(eq(productOffers.productId, productId), factoryAccess(user)))
      .orderBy(asc(sql`${productOffers.price} is null`), desc(productOffers.quotedAt), asc(factories.name));
    const photos = rows.length
      ? await db
          .select({ id: attachments.id, factoryId: attachments.ownerId, filename: attachments.filename })
          .from(attachments)
          .where(and(eq(attachments.ownerType, "factory"), inArray(attachments.ownerId, [...new Set(rows.map((r) => r.factoryId))]), sql`${attachments.mime} like 'image/%'`, sql`coalesce(${attachments.label}, '') <> 'screenshot'`))
          .orderBy(asc(attachments.createdAt))
          .limit(40)
      : [];
    return { offers: rows, photos };
  });
}
