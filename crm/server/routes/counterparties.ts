/** Контрагенты: клиенты, поставщики, подрядчики; их контакты; карточка со связями. */

import { and, asc, count, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";

import { COMPANY_KINDS, MESSENGERS } from "../../shared/deal-fields.ts";
import { CONTRACTOR_TYPES, COUNTERPARTY_ROLES, type CounterpartyRole } from "../../shared/documents.ts";
import { db } from "../db/client.ts";
import { contacts, counterparties, deals, documentItems, documents, products, shipments } from "../db/schema.ts";
import { audit } from "../lib/audit.ts";
import { dealQuery } from "../lib/deals.ts";
import { listShipments } from "../lib/shipment-query.ts";
import { documentListQuery } from "../lib/documents.ts";
import { config } from "../config.ts";
import { contractMissing, nextContractNumber, renderContractDocx } from "../lib/contract.ts";
import { body, currentUser, HttpError, intParam, requireAdmin } from "../lib/http.ts";
import { getCompany } from "../lib/settings.ts";
import { storeBuffer } from "./files.ts";

type Kind = keyof typeof COMPANY_KINDS;
type Messenger = keyof typeof MESSENGERS;

function str(value: unknown, max: number): string | null {
  return typeof value === "string" ? value.trim().slice(0, max) || null : null;
}

const TEXT_FIELDS = {
  fullName: 500,
  country: 60,
  kpp: 20,
  ogrn: 20,
  regNumber: 60,
  legalAddress: 500,
  postalAddress: 500,
  bankAccount: 40,
  bankName: 300,
  bankBik: 20,
  bankCorrAccount: 40,
  bankInn: 20,
  bankAddress: 500,
  bankSwift: 20,
  signatoryTitle: 100,
  signatoryName: 200,
  signatoryBasis: 200,
  email: 200,
  phone: 60,
  website: 200,
} as const;

/** Поля контрагента из запроса (только переданные). */
export function counterpartyValues(input: Record<string, unknown>) {
  const values: Partial<typeof counterparties.$inferInsert> = {};
  if ("name" in input) {
    const name = str(input.name, 300);
    if (!name) throw new HttpError(400, "Укажите название");
    values.name = name;
  }
  if ("role" in input) {
    if (!(String(input.role) in COUNTERPARTY_ROLES)) throw new HttpError(400, "Неизвестная роль контрагента");
    values.role = input.role as CounterpartyRole;
  }
  if ("contractorType" in input) {
    const t = input.contractorType;
    if (t !== null && t !== "" && !(String(t) in CONTRACTOR_TYPES)) throw new HttpError(400, "Неизвестный вид подрядчика");
    values.contractorType = t ? String(t) : null;
  }
  if ("kind" in input) {
    if (!(String(input.kind) in COMPANY_KINDS)) throw new HttpError(400, "Неизвестная форма компании");
    values.kind = input.kind as Kind;
  }
  if ("inn" in input) {
    const inn = typeof input.inn === "string" ? input.inn.replace(/\D/g, "") : "";
    if (inn && inn.length !== 10 && inn.length !== 12) throw new HttpError(400, "ИНН — 10 цифр (ООО) или 12 (ИП)");
    values.inn = inn || null;
  }
  for (const [field, max] of Object.entries(TEXT_FIELDS) as [keyof typeof TEXT_FIELDS, number][]) {
    if (field in input) (values as Record<string, unknown>)[field] = str(input[field], max);
  }
  if ("country" in input) values.country = str(input.country, 60) ?? "RU";
  if ("notes" in input) values.notes = typeof input.notes === "string" ? input.notes.slice(0, 5000) : "";
  return values;
}

function contactValues(input: Record<string, unknown>) {
  const values: Partial<typeof contacts.$inferInsert> = {};
  if ("name" in input) {
    const name = str(input.name, 200);
    if (!name) throw new HttpError(400, "Укажите имя контакта");
    values.name = name;
  }
  if ("phone" in input) values.phone = str(input.phone, 50);
  if ("messenger" in input) {
    const m = input.messenger;
    if (m !== null && m !== "" && !(String(m) in MESSENGERS)) throw new HttpError(400, "Неизвестный мессенджер");
    values.messenger = m ? (m as Messenger) : null;
  }
  if ("messengerHandle" in input) values.messengerHandle = str(input.messengerHandle, 100);
  if ("email" in input) values.email = str(input.email, 200);
  if ("position" in input) values.position = str(input.position, 200);
  if ("isPrimary" in input) values.isPrimary = Boolean(input.isPrimary);
  return values;
}

export async function counterpartyRoutes(app: FastifyInstance): Promise<void> {
  app.get("/counterparties", async (request) => {
    const query = request.query as { q?: string; role?: string; type?: string; limit?: string };
    const q = String(query.q ?? "").trim().slice(0, 100);
    const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const filters = [];
    if (query.role && query.role in COUNTERPARTY_ROLES) filters.push(eq(counterparties.role, query.role as CounterpartyRole));
    if (query.type) filters.push(eq(counterparties.contractorType, query.type));
    if (q) {
      filters.push(
        or(
          ilike(counterparties.name, like),
          ilike(counterparties.fullName, like),
          ilike(counterparties.inn, like),
          ilike(counterparties.regNumber, like),
          sql`exists (select 1 from contacts c where c.counterparty_id = "counterparties"."id" and (c.name ilike ${like} or c.phone ilike ${like} or c.email ilike ${like}))`,
        )!,
      );
    }
    const rows = await db
      .select({
        id: counterparties.id,
        role: counterparties.role,
        contractorType: counterparties.contractorType,
        kind: counterparties.kind,
        name: counterparties.name,
        inn: counterparties.inn,
        country: counterparties.country,
        email: counterparties.email,
        updatedAt: counterparties.updatedAt,
        dealCount: sql<number>`(select count(*)::int from shipments s where s.client_id = "counterparties"."id" or s.supplier_id = "counterparties"."id"
          or exists (select 1 from shipment_parties p where p.shipment_id = s.id and p.counterparty_id = "counterparties"."id"))`,
        documentCount: sql<number>`(select count(*)::int from documents x where x.counterparty_id = "counterparties"."id" or x.client_id = "counterparties"."id")`,
        contactName: sql<string | null>`(select c.name from contacts c where c.counterparty_id = "counterparties"."id" order by c.is_primary desc, c.id limit 1)`,
        contactPhone: sql<string | null>`(select c.phone from contacts c where c.counterparty_id = "counterparties"."id" order by c.is_primary desc, c.id limit 1)`,
        contactEmail: sql<string | null>`(select coalesce(c.email, "counterparties"."email") from contacts c where c.counterparty_id = "counterparties"."id" order by c.is_primary desc, c.id limit 1)`,
      })
      .from(counterparties)
      .where(filters.length ? and(...filters) : undefined)
      .orderBy(asc(counterparties.name))
      .limit(Math.min(Number(query.limit) || (q ? 30 : 1000), 1000));
    return { counterparties: rows };
  });

  app.post("/counterparties", async (request) => {
    const user = currentUser(request);
    const input = body<Record<string, unknown>>(request);
    const isClientish = input.role === "client" || input.role === "contractor" || !input.role;
    const values = counterpartyValues({
      role: "client",
      kind: isClientish ? "ooo" : "foreign",
      country: input.role === "supplier" ? "Китай" : "Россия",
      ...input,
    });
    if (!values.name) throw new HttpError(400, "Укажите название");
    const counterparty = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(counterparties)
        .values({ ...values, name: values.name!, createdBy: user.id })
        .returning();
      if (input.contact && typeof input.contact === "object") {
        const c = contactValues(input.contact as Record<string, unknown>);
        if (c.name) await tx.insert(contacts).values({ ...c, name: c.name, counterpartyId: created.id, isPrimary: true });
      }
      await audit(tx, {
        userId: user.id,
        action: "create",
        entityType: "counterparty",
        entityId: created.id,
        summary: `Создал контрагента «${created.name}» (${COUNTERPARTY_ROLES[created.role].one.toLowerCase()})`,
        ip: request.ip,
      });
      return created;
    });
    return { counterparty };
  });

  /** Карточка: реквизиты, контакты, сделки, документы, товары с ценами, связанные контрагенты. */
  app.get("/counterparties/:id", async (request) => {
    const id = intParam((request.params as { id: string }).id);
    const [counterparty] = await db.select().from(counterparties).where(eq(counterparties.id, id));
    if (!counterparty) throw new HttpError(404, "Контрагент не найден");

    const [contactList, dealList, shipmentList, docList] = await Promise.all([
      db.select().from(contacts).where(eq(contacts.counterpartyId, id)).orderBy(desc(contacts.isPrimary), asc(contacts.id)),
      dealQuery(db).where(eq(deals.clientId, id)).orderBy(desc(deals.createdAt)),
      listShipments(
        db,
        sql`(s.client_id = ${id} OR s.supplier_id = ${id} OR s.carrier_id = ${id}
          OR EXISTS (SELECT 1 FROM shipment_parties p WHERE p.shipment_id = s.id AND p.counterparty_id = ${id}))`,
      ),
      documentListQuery(db)
        .where(or(eq(documents.counterpartyId, id), eq(documents.clientId, id)))
        .orderBy(desc(documents.date), desc(documents.id))
        .limit(500),
    ]);

    // Товары: для поставщика — его инвойсы; для клиента — инвойсы и поручения по его сделкам/документам.
    const docFilter =
      counterparty.role === "supplier"
        ? and(eq(documents.counterpartyId, id), eq(documents.type, "supplier_invoice"))
        : and(
            or(eq(documents.clientId, id), sql`${documents.shipmentId} in (select s.id from shipments s where s.client_id = ${id})`),
            inArray(documents.type, ["supplier_invoice", "commission_order", "specification"]),
          );
    const productRows = await db
      .select({
        productId: documentItems.productId,
        productName: sql<string>`coalesce(${products.name}, ${documentItems.name})`,
        documentId: documents.id,
        documentType: documents.type,
        documentNumber: documents.number,
        date: documents.date,
        currency: documents.currency,
        quantity: sql<number | null>`${documentItems.quantity}::float8`,
        unit: documentItems.unit,
        price: sql<number | null>`${documentItems.price}::float8`,
        counterpartyName: sql<string | null>`(select c.name from counterparties c where c.id = ${documents.counterpartyId})`,
      })
      .from(documentItems)
      .innerJoin(documents, eq(documents.id, documentItems.documentId))
      .leftJoin(products, eq(products.id, documentItems.productId))
      .where(docFilter)
      .orderBy(desc(documents.date), desc(documents.id))
      .limit(500);

    // Связанные контрагенты по сделкам: клиенту — его поставщики и подрядчики, поставщику — клиенты.
    const shipmentIds = shipmentList.map((d) => d.id);
    const related = shipmentIds.length
      ? await db
          .select({
            id: counterparties.id,
            name: counterparties.name,
            role: counterparties.role,
            contractorType: counterparties.contractorType,
            deals: count(),
          })
          .from(counterparties)
          .innerJoin(
            shipments,
            or(
              eq(shipments.clientId, counterparties.id),
              eq(shipments.supplierId, counterparties.id),
              sql`exists (select 1 from shipment_parties p where p.shipment_id = ${shipments.id} and p.counterparty_id = "counterparties"."id")`,
            ),
          )
          .where(and(inArray(shipments.id, shipmentIds), sql`"counterparties"."id" <> ${id}`))
          .groupBy(counterparties.id)
          .orderBy(asc(counterparties.name))
      : [];

    return { counterparty, contacts: contactList, deals: dealList, shipments: shipmentList, documents: docList, products: productRows, related };
  });

  app.patch("/counterparties/:id", async (request) => {
    const user = currentUser(request);
    const id = intParam((request.params as { id: string }).id);
    const values = counterpartyValues(body<Record<string, unknown>>(request));
    const [updated] = await db
      .update(counterparties)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(counterparties.id, id))
      .returning();
    if (!updated) throw new HttpError(404, "Контрагент не найден");
    await audit(db, {
      userId: user.id,
      action: "update",
      entityType: "counterparty",
      entityId: id,
      summary: `Изменил контрагента «${updated.name}»`,
      ip: request.ip,
    });
    return { counterparty: updated };
  });

  app.delete("/counterparties/:id", async (request) => {
    const admin = requireAdmin(request);
    const id = intParam((request.params as { id: string }).id);
    const [{ n }] = await db
      .select({ n: count() })
      .from(shipments)
      .where(or(eq(shipments.clientId, id), eq(shipments.supplierId, id), eq(shipments.carrierId, id)));
    if (n > 0) throw new HttpError(409, `Есть сделки с этим контрагентом (${n}) — удалить нельзя`);
    const [{ l }] = await db.select({ l: count() }).from(deals).where(eq(deals.clientId, id));
    if (l > 0) throw new HttpError(409, `Есть лиды в воронке с этим клиентом (${l}) — удалить нельзя`);
    const [{ d }] = await db
      .select({ d: count() })
      .from(documents)
      .where(or(eq(documents.counterpartyId, id), eq(documents.clientId, id)));
    if (d > 0) throw new HttpError(409, `Есть документы с этим контрагентом (${d}) — удалить нельзя`);
    const [removed] = await db.delete(counterparties).where(eq(counterparties.id, id)).returning();
    if (!removed) throw new HttpError(404, "Контрагент не найден");
    await audit(db, {
      userId: admin.id,
      action: "delete",
      entityType: "counterparty",
      entityId: id,
      summary: `Удалил контрагента «${removed.name}»`,
      data: removed,
      ip: request.ip,
    });
    return { ok: true };
  });

  // ── Договор комиссии из карточки клиента ─────────────────────────────────

  /** Подсказки для формы: следующий номер, город, чего не хватает в реквизитах. */
  app.get("/counterparties/:id/commission-contract", async (request) => {
    const id = intParam((request.params as { id: string }).id);
    const [client] = await db.select().from(counterparties).where(eq(counterparties.id, id));
    if (!client) throw new HttpError(404, "Контрагент не найден");
    const company = await getCompany(db);
    return { number: await nextContractNumber(db), city: (company.city || "Красногорск").replace(/^г\.?\s*/i, ""), missing: contractMissing(client) };
  });

  /** Создать договор комиссии: документ (черновик) + DOCX по шаблону в его файлах. */
  app.post("/counterparties/:id/commission-contract", async (request) => {
    const user = currentUser(request);
    const id = intParam((request.params as { id: string }).id);
    const input = body<{ number: unknown; date: unknown; city: unknown; validUntil: unknown }>(request);
    const [client] = await db.select().from(counterparties).where(eq(counterparties.id, id));
    if (!client) throw new HttpError(404, "Контрагент не найден");
    if (client.role !== "client") throw new HttpError(400, "Договор комиссии заключается с клиентом");
    const isDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
    const number = str(input.number, 50) ?? (await nextContractNumber(db));
    if (!isDate(input.date) || !isDate(input.validUntil)) throw new HttpError(400, "Укажите дату договора и срок действия");
    const contract = { number, date: input.date, city: str(input.city, 100) ?? "Красногорск", validUntil: input.validUntil };
    const buffer = await renderContractDocx(client, contract, config.uploadDir);
    const document = await db.transaction(async (tx) => {
      const [doc] = await tx
        .insert(documents)
        .values({ type: "commission_contract", number, date: contract.date, validUntil: contract.validUntil, counterpartyId: client.id, status: "draft", data: { city: contract.city }, createdBy: user.id })
        .returning();
      await storeBuffer(tx, { type: "document", id: doc.id }, { filename: `Договор комиссии № ${number} — ${client.name}.docx`.replace(/[\\/:*?"<>|]/g, " "), mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", buffer, label: "generated" }, user.id);
      await audit(tx, { userId: user.id, action: "create", entityType: "document", entityId: doc.id, summary: `Сформировал договор комиссии № ${number} с «${client.name}»`, ip: request.ip });
      return doc;
    });
    return { document };
  });

  // ── Контакты ─────────────────────────────────────────────────────────────

  app.post("/counterparties/:id/contacts", async (request) => {
    const user = currentUser(request);
    const counterpartyId = intParam((request.params as { id: string }).id);
    const values = contactValues(body<Record<string, unknown>>(request));
    if (!values.name) throw new HttpError(400, "Укажите имя контакта");
    const [cp] = await db.select({ name: counterparties.name }).from(counterparties).where(eq(counterparties.id, counterpartyId));
    if (!cp) throw new HttpError(404, "Контрагент не найден");
    const [contact] = await db.insert(contacts).values({ ...values, name: values.name, counterpartyId }).returning();
    await audit(db, {
      userId: user.id,
      action: "create",
      entityType: "contact",
      entityId: contact.id,
      summary: `Добавил контакт ${contact.name} — «${cp.name}»`,
      ip: request.ip,
    });
    return { contact };
  });

  app.patch("/contacts/:id", async (request) => {
    const user = currentUser(request);
    const id = intParam((request.params as { id: string }).id);
    const values = contactValues(body<Record<string, unknown>>(request));
    const [contact] = await db
      .update(contacts)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(contacts.id, id))
      .returning();
    if (!contact) throw new HttpError(404, "Контакт не найден");
    await audit(db, {
      userId: user.id,
      action: "update",
      entityType: "contact",
      entityId: id,
      summary: `Изменил контакт ${contact.name}`,
      ip: request.ip,
    });
    return { contact };
  });

  app.delete("/contacts/:id", async (request) => {
    const user = currentUser(request);
    const id = intParam((request.params as { id: string }).id);
    const [contact] = await db.delete(contacts).where(eq(contacts.id, id)).returning();
    if (!contact) throw new HttpError(404, "Контакт не найден");
    await audit(db, {
      userId: user.id,
      action: "delete",
      entityType: "contact",
      entityId: id,
      summary: `Удалил контакт ${contact.name}`,
      data: contact,
      ip: request.ip,
    });
    return { ok: true };
  });
}
