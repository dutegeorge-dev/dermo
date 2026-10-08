/** CRM: клиенты (компании) и их контакты. */

import { and, asc, count, desc, eq, ilike, or, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";

import { COMPANY_KINDS, MESSENGERS } from "../../shared/deal-fields.ts";
import { db } from "../db/client.ts";
import { clients, contacts, deals } from "../db/schema.ts";
import { audit } from "../lib/audit.ts";
import { dealQuery } from "../lib/deals.ts";
import { body, currentUser, HttpError, intParam, requireAdmin } from "../lib/http.ts";

type Kind = keyof typeof COMPANY_KINDS;
type Messenger = keyof typeof MESSENGERS;

function str(value: unknown, max: number): string | null {
  return typeof value === "string" ? value.trim().slice(0, max) || null : null;
}

function clientValues(input: Record<string, unknown>) {
  const values: Partial<typeof clients.$inferInsert> = {};
  if ("name" in input) {
    const name = str(input.name, 300);
    if (!name) throw new HttpError(400, "Укажите название компании");
    values.name = name;
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

export async function clientRoutes(app: FastifyInstance): Promise<void> {
  app.get("/clients", async (request) => {
    const q = String((request.query as { q?: string }).q ?? "").trim().slice(0, 100);
    const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const rows = await db
      .select({
        id: clients.id,
        kind: clients.kind,
        name: clients.name,
        inn: clients.inn,
        updatedAt: clients.updatedAt,
        dealCount: sql<number>`(select count(*)::int from deals d where d.client_id = ${clients.id})`,
        contactName: sql<string | null>`(select c.name from contacts c where c.client_id = ${clients.id} order by c.is_primary desc, c.id limit 1)`,
        contactPhone: sql<string | null>`(select c.phone from contacts c where c.client_id = ${clients.id} order by c.is_primary desc, c.id limit 1)`,
      })
      .from(clients)
      .where(
        q
          ? or(
              ilike(clients.name, like),
              ilike(clients.inn, like),
              sql`exists (select 1 from contacts c where c.client_id = ${clients.id} and (c.name ilike ${like} or c.phone ilike ${like} or c.email ilike ${like}))`,
            )
          : undefined,
      )
      .orderBy(asc(clients.name))
      .limit(q ? 30 : 500);
    return { clients: rows };
  });

  app.post("/clients", async (request) => {
    const user = currentUser(request);
    const input = body<Record<string, unknown>>(request);
    const values = clientValues({ kind: "ooo", ...input });
    if (!values.name) throw new HttpError(400, "Укажите название компании");
    const client = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(clients)
        .values({ ...values, name: values.name!, createdBy: user.id })
        .returning();
      if (input.contact && typeof input.contact === "object") {
        const c = contactValues(input.contact as Record<string, unknown>);
        if (c.name) await tx.insert(contacts).values({ ...c, name: c.name, clientId: created.id, isPrimary: true });
      }
      await audit(tx, {
        userId: user.id,
        action: "create",
        entityType: "client",
        entityId: created.id,
        summary: `Создал клиента «${created.name}»`,
        ip: request.ip,
      });
      return created;
    });
    return { client };
  });

  app.get("/clients/:id", async (request) => {
    const id = intParam((request.params as { id: string }).id);
    const [client] = await db.select().from(clients).where(eq(clients.id, id));
    if (!client) throw new HttpError(404, "Клиент не найден");
    const [contactList, dealList] = await Promise.all([
      db.select().from(contacts).where(eq(contacts.clientId, id)).orderBy(desc(contacts.isPrimary), asc(contacts.id)),
      dealQuery(db).where(eq(deals.clientId, id)).orderBy(desc(deals.createdAt)),
    ]);
    return { client, contacts: contactList, deals: dealList };
  });

  app.patch("/clients/:id", async (request) => {
    const user = currentUser(request);
    const id = intParam((request.params as { id: string }).id);
    const values = clientValues(body<Record<string, unknown>>(request));
    const [updated] = await db
      .update(clients)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(clients.id, id))
      .returning();
    if (!updated) throw new HttpError(404, "Клиент не найден");
    await audit(db, {
      userId: user.id,
      action: "update",
      entityType: "client",
      entityId: id,
      summary: `Изменил клиента «${updated.name}»`,
      ip: request.ip,
    });
    return { client: updated };
  });

  app.delete("/clients/:id", async (request) => {
    const admin = requireAdmin(request);
    const id = intParam((request.params as { id: string }).id);
    const [{ n }] = await db.select({ n: count() }).from(deals).where(eq(deals.clientId, id));
    if (n > 0) throw new HttpError(409, `У клиента есть сделки (${n}) — его нельзя удалить`);
    const [removed] = await db.delete(clients).where(eq(clients.id, id)).returning();
    if (!removed) throw new HttpError(404, "Клиент не найден");
    await audit(db, {
      userId: admin.id,
      action: "delete",
      entityType: "client",
      entityId: id,
      summary: `Удалил клиента «${removed.name}»`,
      data: removed,
      ip: request.ip,
    });
    return { ok: true };
  });

  // ── Контакты ─────────────────────────────────────────────────────────────

  app.post("/clients/:id/contacts", async (request) => {
    const user = currentUser(request);
    const clientId = intParam((request.params as { id: string }).id);
    const values = contactValues(body<Record<string, unknown>>(request));
    if (!values.name) throw new HttpError(400, "Укажите имя контакта");
    const [client] = await db.select({ name: clients.name }).from(clients).where(eq(clients.id, clientId));
    if (!client) throw new HttpError(404, "Клиент не найден");
    const [contact] = await db.insert(contacts).values({ ...values, name: values.name, clientId }).returning();
    await audit(db, {
      userId: user.id,
      action: "create",
      entityType: "contact",
      entityId: contact.id,
      summary: `Добавил контакт ${contact.name} клиенту «${client.name}»`,
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
    const [contact] = await db.delete(contacts).where(and(eq(contacts.id, id))).returning();
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
