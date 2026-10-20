/**
 * Сделки (отгрузки): список и доска, полная карточка (поля, документы, товары,
 * сертификаты, деньги, подрядчики, ключевые даты), флажки, календарь.
 */

import { and, asc, desc, eq, inArray, or, type SQL, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";

import {
  FLAG_KEYS,
  FLAGS,
  type FlagKey,
  LAST_STAGE,
  MILESTONE_KEYS,
  MILESTONES,
  type MilestoneKey,
  SHIPMENT_FIELDS,
  type ShipmentField,
  shipmentLabel,
  stageSpec,
} from "../../shared/shipments.ts";
import { db, type DbOrTx } from "../db/client.ts";
import { counterparties, documentItems, documents, products, shipmentEvents, shipmentParties, shipments, users } from "../db/schema.ts";
import { audit } from "../lib/audit.ts";
import { shipmentDocuments, shipmentFinance } from "../lib/finance.ts";
import { body, currentUser, HttpError, intParam, requireAdmin } from "../lib/http.ts";
import { markFlagDocuments, PAYMENT_FLAGS, type PaymentFlag } from "../lib/payments.ts";
import { getShipmentDto, listShipments, type ShipmentDto } from "../lib/shipment-query.ts";
import {
  addShipmentEvent,
  autoContracts,
  createShipment,
  requireCargo,
  loadMilestones,
  moveToStage,
  parseShipmentFields,
  parseShipmentNumber,
  sameShipmentValue,
  setFlag,
  setMilestone,
  shipmentDisplay,
} from "../lib/shipments.ts";

async function findShipment(tx: DbOrTx, raw: unknown) {
  const number = parseShipmentNumber(raw);
  const [row] = await tx.select().from(shipments).where(eq(shipments.number, number));
  if (!row) throw new HttpError(404, "Сделка не найдена");
  return row;
}

export type CalendarEvent = {
  id: string;
  kind: "milestone" | "flag";
  key: string;
  title: string;
  date: string | null;
  done: boolean;
  payment: boolean;
  /** Ключевая дата, к которой привязан флажок (её и двигаем). */
  milestone: MilestoneKey | null;
  shipment: { number: number; label: string; title: string; stage: number; containerNo: string | null; client: string | null; carrier: string | null };
};

/**
 * События календаря по сделкам в работе: плановые даты точек без факта
 * (и с фактом — как выполненные), неотмеченные флажки — на дату ключевой
 * точки их этапа. У ключевой даты текущего этапа без плана — событие без даты.
 */
export function calendarEvents(list: ShipmentDto[]): CalendarEvent[] {
  const events: CalendarEvent[] = [];
  for (const sh of list) {
    const ref = {
      number: sh.number,
      label: sh.label,
      title: sh.title,
      stage: sh.stage,
      containerNo: sh.containerNo,
      client: sh.client?.name ?? null,
      carrier: sh.carrier?.name ?? null,
    };
    const current = stageSpec(sh.stage).milestone;
    for (const m of MILESTONES) {
      const d = sh.milestones[m.key]!;
      // Необязательная отметка уже пройденного этапа (граница без факта) — не напоминаем.
      if (!d.fact && m.optional && m.stage < sh.stage) continue;
      if (d.fact) {
        events.push({ id: `${sh.number}:m:${m.key}`, kind: "milestone", key: m.key, title: m.event, date: d.fact, done: true, payment: false, milestone: m.key, shipment: ref });
      } else if (d.plan || m.key === current) {
        events.push({ id: `${sh.number}:m:${m.key}`, kind: "milestone", key: m.key, title: m.event, date: d.plan, done: false, payment: false, milestone: m.key, shipment: ref });
      }
    }
    for (const key of FLAG_KEYS) {
      const flag = FLAGS[key];
      const anchor = stageSpec(flag.stage).milestone!;
      const done = Boolean(sh.flags[key]);
      // Флажки будущих этапов показываем, только если у их этапа уже есть план.
      const date = done ? sh.flags[key] : (sh.milestones[anchor]?.plan ?? null);
      if (!done && flag.stage > sh.stage && !date) continue;
      events.push({ id: `${sh.number}:f:${key}`, kind: "flag", key, title: flag.todo, date, done, payment: flag.payment, milestone: anchor, shipment: ref });
    }
  }
  return events;
}

/** Товары сделки: позиции инвойсов поставщика (если их нет — поручения/спецификации). */
async function shipmentItems(shipmentId: number) {
  const rows = await db
    .select({
      documentId: documents.id,
      type: documents.type,
      currency: documents.currency,
      productId: documentItems.productId,
      productName: products.name,
      name: documentItems.name,
      hsCode: sql<string | null>`coalesce(${documentItems.hsCode}, ${products.hsCode})`,
      quantity: sql<number | null>`${documentItems.quantity}::float8`,
      unit: documentItems.unit,
      price: sql<number | null>`${documentItems.price}::float8`,
      amount: sql<number | null>`${documentItems.amount}::float8`,
    })
    .from(documentItems)
    .innerJoin(documents, eq(documents.id, documentItems.documentId))
    .leftJoin(products, eq(products.id, documentItems.productId))
    .where(
      and(
        eq(documents.shipmentId, shipmentId),
        inArray(documents.type, ["supplier_invoice", "commission_order", "specification"]),
        sql`coalesce(${documents.status}, '') <> 'cancelled'`,
      ),
    )
    .orderBy(asc(documents.date), asc(documents.id), asc(documentItems.position));
  const invoices = rows.filter((r) => r.type === "supplier_invoice");
  return invoices.length ? invoices : rows.filter((r) => r.type === (rows.some((x) => x.type === "commission_order") ? "commission_order" : "specification"));
}

/** Декларации соответствия / сертификаты: привязанные к сделке и выданные на её товары. */
async function shipmentCertificates(shipmentId: number, productIds: number[]) {
  const rows = await db
    .select({
      id: documents.id,
      number: documents.number,
      date: documents.date,
      validUntil: documents.validUntil,
      status: documents.status,
      holder: counterparties.name,
      products: sql<string[]>`coalesce((select array_agg(distinct coalesce(p.name, i.name)) from document_items i
        left join products p on p.id = i.product_id where i.document_id = ${documents.id}), '{}')`,
      fileCount: sql<number>`(select count(*)::int from attachments a where a.owner_type = 'document' and a.owner_id = ${documents.id})`,
    })
    .from(documents)
    .leftJoin(counterparties, eq(counterparties.id, documents.counterpartyId))
    .where(
      and(
        eq(documents.type, "conformity"),
        or(
          eq(documents.shipmentId, shipmentId),
          productIds.length
            ? sql`exists (select 1 from document_items i where i.document_id = ${documents.id} and i.product_id in (${sql.join(productIds.map((id) => sql`${id}`), sql`, `)}))`
            : sql`false`,
        ),
      ),
    )
    .orderBy(desc(documents.validUntil), desc(documents.id));
  return rows;
}

export async function shipmentRoutes(app: FastifyInstance): Promise<void> {
  app.get("/shipments", async (request) => {
    const q = request.query as Record<string, string | undefined>;
    const conds: SQL[] = [];
    const status = q.status ?? "active";
    if (status !== "all") conds.push(sql`s.status = ${status}`);
    if (q.stage && /^\d$/.test(q.stage)) conds.push(sql`s.stage = ${Number(q.stage)}`);
    for (const [param, column] of [
      ["clientId", sql`s.client_id`],
      ["supplierId", sql`s.supplier_id`],
      ["carrierId", sql`s.carrier_id`],
      ["dealId", sql`s.deal_id`],
      ["assigneeId", sql`s.assignee_id`],
    ] as const) {
      const v = Number(q[param]);
      if (q[param] && Number.isSafeInteger(v)) conds.push(sql`${column} = ${v}`);
    }
    if (q.assignee === "me") conds.push(sql`s.assignee_id = ${currentUser(request).id}`);
    const text = String(q.q ?? "").trim().slice(0, 100);
    if (text) {
      const like = `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      const num = /^(?:[сc]-?|№\s*)?0*(\d{1,9})$/i.exec(text);
      conds.push(sql`(s.title ILIKE ${like} OR s.container_no ILIKE ${like} OR s.hs_code ILIKE ${like} OR cl.name ILIKE ${like}
        OR sp.name ILIKE ${like} OR cr.name ILIKE ${like} ${num ? sql`OR s.number = ${Number(num[1])}` : sql``})`);
    }
    const list = await listShipments(db, conds.length ? sql.join(conds, sql` AND `) : sql`true`);
    const counts = await db.execute<{ status: string; stage: number; n: number }>(
      sql`SELECT status, stage, count(*)::int AS n FROM shipments GROUP BY status, stage`,
    );
    return { shipments: list, counts: counts.rows };
  });

  app.post("/shipments", async (request) => {
    const user = currentUser(request);
    return db.transaction(async (tx) => {
      const input = body(request);
      requireCargo(input);
      const row = await createShipment(tx, input, user.id);
      await audit(tx, { userId: user.id, action: "create", entityType: "shipment", entityId: row.number, summary: `Создал сделку «${row.title}»`, ip: request.ip });
      return { shipment: await getShipmentDto(tx, row.id) };
    });
  });

  /** Карточка: вся информация по сделке. */
  app.get("/shipments/:number", async (request) => {
    const row = await findShipment(db, (request.params as { number: string }).number);
    const [events, parties, docs, items] = await Promise.all([
      db
        .select({
          id: shipmentEvents.id,
          kind: shipmentEvents.kind,
          field: shipmentEvents.field,
          oldValue: shipmentEvents.oldValue,
          newValue: shipmentEvents.newValue,
          createdAt: shipmentEvents.createdAt,
          userName: users.name,
        })
        .from(shipmentEvents)
        .leftJoin(users, eq(users.id, shipmentEvents.userId))
        .where(eq(shipmentEvents.shipmentId, row.id))
        .orderBy(desc(shipmentEvents.createdAt), desc(shipmentEvents.id))
        .limit(300),
      db
        .select({ id: counterparties.id, name: counterparties.name, role: counterparties.role, contractorType: counterparties.contractorType })
        .from(shipmentParties)
        .innerJoin(counterparties, eq(counterparties.id, shipmentParties.counterpartyId))
        .where(eq(shipmentParties.shipmentId, row.id))
        .orderBy(asc(counterparties.name)),
      shipmentDocuments(db, row.id),
      shipmentItems(row.id),
    ]);
    const productIds = [...new Set(items.map((i) => i.productId).filter((x): x is number => !!x))];
    return {
      shipment: await getShipmentDto(db, row.id),
      events,
      parties,
      documents: docs,
      finance: shipmentFinance(docs, row.calc ?? null),
      items,
      certificates: await shipmentCertificates(row.id, productIds),
    };
  });

  /** Правка полей; каждое изменение — в историю. Сменили клиента/схему/поставщика — договоры подбираются заново. */
  app.patch("/shipments/:number", async (request) => {
    const user = currentUser(request);
    return db.transaction(async (tx) => {
      const row = await findShipment(tx, (request.params as { number: string }).number);
      const v = await parseShipmentFields(tx, body(request));
      if ("containerNo" in v && !v.containerNo) {
        const ms = await loadMilestones(tx, row.id);
        if (ms.loading?.fact) throw new HttpError(400, "Груз уже погружен — номер контейнера обязателен");
      }
      const changed: Record<string, unknown> = {};
      for (const field of Object.keys(v) as ShipmentField[]) {
        const before = (row as Record<string, unknown>)[field] ?? null;
        const after = (v as Record<string, unknown>)[field] ?? null;
        if (sameShipmentValue(field, before, after)) continue;
        changed[field] = after;
        if (field === "notes") await addShipmentEvent(tx, row.id, user.id, "field", field);
        else await addShipmentEvent(tx, row.id, user.id, "field", field, await shipmentDisplay(tx, field, before), await shipmentDisplay(tx, field, after));
      }
      if (Object.keys(changed).length) {
        if (("clientId" in changed || "scheme" in changed) && !("clientContractId" in changed)) changed.clientContractId = null;
        if (("supplierId" in changed || "scheme" in changed) && !("supplierContractId" in changed)) changed.supplierContractId = null;
        if ("clientId" in changed && !("contactId" in changed)) changed.contactId = null;
        if ("carrierId" in changed && !("carrierInvoiceId" in changed)) changed.carrierInvoiceId = null;
        await tx.update(shipments).set({ ...changed, updatedAt: new Date() }).where(eq(shipments.id, row.id));
        if (changed.carrierId) {
          await tx.insert(shipmentParties).values({ shipmentId: row.id, counterpartyId: changed.carrierId as number }).onConflictDoNothing();
        }
        const picked = await autoContracts(tx, row.id);
        for (const [field, value] of Object.entries(picked) as [ShipmentField, unknown][]) {
          await addShipmentEvent(tx, row.id, user.id, "field", field, null, await shipmentDisplay(tx, field, value));
        }
        await audit(tx, {
          userId: user.id,
          action: "update",
          entityType: "shipment",
          entityId: row.number,
          summary: `Изменил сделку «${row.title}»: ${Object.keys(changed)
            .filter((f) => f in SHIPMENT_FIELDS)
            .map((f) => SHIPMENT_FIELDS[f as ShipmentField].label)
            .join(", ")}`,
          ip: request.ip,
        });
      }
      return { shipment: await getShipmentDto(tx, row.id) };
    });
  });

  /** План / факт ключевой даты; shift: true — сдвинуть следующие даты. */
  app.put("/shipments/:number/milestones/:key", async (request) => {
    const user = currentUser(request);
    const { number, key } = request.params as { number: string; key: string };
    if (!(MILESTONE_KEYS as string[]).includes(key)) throw new HttpError(400, "Неизвестная точка");
    return db.transaction(async (tx) => {
      const row = await findShipment(tx, number);
      const input = body<{ plan: unknown; fact: unknown; shift: unknown }>(request);
      const { shifted } = await setMilestone(tx, row, key as MilestoneKey, input, user.id);
      const label = MILESTONES.find((m) => m.key === key)!.label;
      await audit(tx, {
        userId: user.id,
        action: "update",
        entityType: "shipment",
        entityId: row.number,
        summary: `«${row.title}»: ${label} — ${"fact" in input ? `факт ${input.fact ?? "снят"}` : `план ${input.plan ?? "снят"}`}${shifted ? `, сдвинуто ещё ${shifted}` : ""}`,
        ip: request.ip,
      });
      return { shipment: await getShipmentDto(tx, row.id), shifted };
    });
  });

  /** Перенос карточки на доске на другой этап (факты ключевых дат ставятся / снимаются). */
  app.post("/shipments/:number/stage", async (request) => {
    const user = currentUser(request);
    const stage = Number(body<{ stage: number }>(request).stage);
    if (!Number.isInteger(stage) || stage < 1 || stage > LAST_STAGE) throw new HttpError(400, "Некорректный этап");
    return db.transaction(async (tx) => {
      const row = await findShipment(tx, (request.params as { number: string }).number);
      if (row.status !== "active") throw new HttpError(400, "Сделка закрыта — сначала верните её в работу");
      await moveToStage(tx, row, stage, user.id);
      await audit(tx, {
        userId: user.id,
        action: "update",
        entityType: "shipment",
        entityId: row.number,
        summary: `«${row.title}»: перенёс на этап «${stageSpec(stage).name}»`,
        ip: request.ip,
      });
      return { shipment: await getShipmentDto(tx, row.id) };
    });
  });

  app.put("/shipments/:number/flags/:key", async (request) => {
    const user = currentUser(request);
    const { number, key } = request.params as { number: string; key: string };
    if (!(FLAG_KEYS as string[]).includes(key)) throw new HttpError(400, "Неизвестный флажок");
    return db.transaction(async (tx) => {
      const row = await findShipment(tx, number);
      const input = body<{ done: boolean; date: string }>(request);
      const done = input.done === true;
      const date = typeof input.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input.date) ? input.date : new Date().toISOString().slice(0, 10);
      await setFlag(tx, row, key as FlagKey, done, user.id, date);
      // Галочка оплаты — те же инвойсы / счета / ДТ сделки становятся «Оплачен» / «Не оплачен».
      if ((PAYMENT_FLAGS as string[]).includes(key)) await markFlagDocuments(tx, row, key as PaymentFlag, done, date, user.id);
      await audit(tx, {
        userId: user.id,
        action: "update",
        entityType: "shipment",
        entityId: row.number,
        summary: `«${row.title}»: ${FLAGS[key as FlagKey].label} — ${done ? "выполнено" : "снята отметка"}`,
        ip: request.ip,
      });
      return { shipment: await getShipmentDto(tx, row.id) };
    });
  });

  /** Закрыть / отменить / вернуть в работу — вручную. */
  app.post("/shipments/:number/status", async (request) => {
    const user = currentUser(request);
    const status = body<{ status: string }>(request).status;
    if (status !== "active" && status !== "closed" && status !== "cancelled") throw new HttpError(400, "Некорректный статус");
    return db.transaction(async (tx) => {
      const row = await findShipment(tx, (request.params as { number: string }).number);
      if (row.status !== status) {
        await tx
          .update(shipments)
          .set({ status, closedAt: status === "active" ? null : new Date(), updatedAt: new Date() })
          .where(eq(shipments.id, row.id));
        await addShipmentEvent(tx, row.id, user.id, "status", null, row.status, status);
        const verb = { active: "Вернул в работу", closed: "Закрыл", cancelled: "Отменил" }[status];
        await audit(tx, { userId: user.id, action: "update", entityType: "shipment", entityId: row.number, summary: `${verb} сделку «${row.title}»`, ip: request.ip });
      }
      return { shipment: await getShipmentDto(tx, row.id) };
    });
  });

  // ── Подрядчики ───────────────────────────────────────────────────────────

  app.post("/shipments/:number/parties", async (request) => {
    const user = currentUser(request);
    const counterpartyId = intParam(body<{ counterpartyId: number }>(request).counterpartyId, "counterpartyId");
    return db.transaction(async (tx) => {
      const row = await findShipment(tx, (request.params as { number: string }).number);
      const [cp] = await tx.select().from(counterparties).where(eq(counterparties.id, counterpartyId));
      if (!cp) throw new HttpError(404, "Контрагент не найден");
      await tx.insert(shipmentParties).values({ shipmentId: row.id, counterpartyId }).onConflictDoNothing();
      await addShipmentEvent(tx, row.id, user.id, "party_added", null, null, cp.name);
      return { ok: true };
    });
  });

  app.delete("/shipments/:number/parties/:id", async (request) => {
    const user = currentUser(request);
    const counterpartyId = intParam((request.params as { id: string }).id);
    return db.transaction(async (tx) => {
      const row = await findShipment(tx, (request.params as { number: string }).number);
      const [removed] = await tx
        .delete(shipmentParties)
        .where(and(eq(shipmentParties.shipmentId, row.id), eq(shipmentParties.counterpartyId, counterpartyId)))
        .returning();
      if (removed) {
        const [cp] = await tx.select({ name: counterparties.name }).from(counterparties).where(eq(counterparties.id, counterpartyId));
        await addShipmentEvent(tx, row.id, user.id, "party_removed", null, cp?.name ?? null, null);
      }
      return { ok: true };
    });
  });

  app.post("/shipments/:number/comments", async (request) => {
    const user = currentUser(request);
    const text = String(body<{ body: string }>(request).body ?? "").trim().slice(0, 5000);
    if (!text) throw new HttpError(400, "Пустой комментарий");
    const row = await findShipment(db, (request.params as { number: string }).number);
    await addShipmentEvent(db, row.id, user.id, "comment", null, null, text);
    return { ok: true };
  });

  app.delete("/shipments/:number", async (request) => {
    const admin = requireAdmin(request);
    const row = await findShipment(db, (request.params as { number: string }).number);
    await db.delete(shipments).where(eq(shipments.id, row.id));
    await audit(db, { userId: admin.id, action: "delete", entityType: "shipment", entityId: row.number, summary: `Удалил сделку «${row.title}» (${shipmentLabel(row.number)})`, ip: request.ip });
    return { ok: true };
  });

  /** Календарь: события всех сделок в работе. Группировку по неделям делает интерфейс. */
  app.get("/calendar", async () => {
    const list = await listShipments(db, sql`s.status = 'active'`);
    return { events: calendarEvents(list) };
  });
}
