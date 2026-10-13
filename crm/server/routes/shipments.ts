/** Сделки (отгрузки): список, карточка, ключевые даты, флажки, календарь. */

import { and, desc, eq, type SQL, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";

import {
  FLAG_KEYS,
  FLAGS,
  type FlagKey,
  MILESTONE_KEYS,
  MILESTONES,
  type MilestoneKey,
  type Milestones,
  shipmentLabel,
  stageSpec,
} from "../../shared/shipments.ts";
import { db, type DbOrTx } from "../db/client.ts";
import { shipmentEvents, shipments, users } from "../db/schema.ts";
import { audit } from "../lib/audit.ts";
import { body, currentUser, HttpError, requireAdmin } from "../lib/http.ts";
import {
  addShipmentEvent,
  checkLinks,
  createShipment,
  loadMilestones,
  parseShipmentFields,
  parseShipmentNumber,
  setFlag,
  setMilestone,
  SHIPMENT_FIELDS,
  type ShipmentField,
  shipmentDisplay,
} from "../lib/shipments.ts";

type Row = {
  id: number;
  number: number;
  status: string;
  stage: number;
  client_id: number | null;
  client_name: string | null;
  supplier_id: number | null;
  supplier_name: string | null;
  carrier_id: number | null;
  carrier_name: string | null;
  carrier_invoice_id: number | null;
  carrier_invoice_number: string | null;
  carrier_invoice_date: string | null;
  carrier_invoice_amount: number | null;
  carrier_invoice_currency: string | null;
  carrier_invoice_payment: string | null;
  deal_id: number | null;
  deal_key: string | null;
  deal_title: string | null;
  container_no: string | null;
  cargo: string;
  transport: string | null;
  route: string | null;
  deposit_date: string | null;
  flags: Record<string, string>;
  notes: string;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  milestones: Record<string, { plan: string | null; fact: string | null }> | null;
};

function listSql(where: SQL) {
  return sql`
    SELECT s.id, s.number, s.status, s.stage,
           s.client_id, cl.name AS client_name, s.supplier_id, sp.name AS supplier_name,
           s.carrier_id, cr.name AS carrier_name,
           s.carrier_invoice_id, inv.number AS carrier_invoice_number, inv.date::text AS carrier_invoice_date,
           inv.amount::float8 AS carrier_invoice_amount, inv.currency AS carrier_invoice_currency,
           inv.payment_status::text AS carrier_invoice_payment,
           s.deal_id, d.key AS deal_key, d.title AS deal_title,
           s.container_no, s.cargo, s.transport, s.route, s.deposit_date::text, s.flags, s.notes,
           s.created_at, s.updated_at, s.closed_at,
           (SELECT json_object_agg(m.key, json_build_object('plan', m.plan::text, 'fact', m.fact::text))
              FROM shipment_milestones m WHERE m.shipment_id = s.id) AS milestones
    FROM shipments s
    LEFT JOIN counterparties cl ON cl.id = s.client_id
    LEFT JOIN counterparties sp ON sp.id = s.supplier_id
    LEFT JOIN counterparties cr ON cr.id = s.carrier_id
    LEFT JOIN documents inv ON inv.id = s.carrier_invoice_id
    LEFT JOIN deals d ON d.id = s.deal_id
    WHERE ${where}
    ORDER BY s.number DESC`;
}

function toShipment(r: Row) {
  const milestones: Milestones = {};
  for (const key of MILESTONE_KEYS) milestones[key] = r.milestones?.[key] ?? { plan: null, fact: null };
  const stage = stageSpec(r.stage);
  const keyMilestone = stage.milestone ? milestones[stage.milestone]! : null;
  return {
    id: Number(r.id),
    number: Number(r.number),
    label: shipmentLabel(Number(r.number)),
    status: r.status,
    stage: Number(r.stage),
    client: r.client_id ? { id: Number(r.client_id), name: r.client_name! } : null,
    supplier: r.supplier_id ? { id: Number(r.supplier_id), name: r.supplier_name! } : null,
    carrier: r.carrier_id ? { id: Number(r.carrier_id), name: r.carrier_name! } : null,
    carrierInvoice: r.carrier_invoice_id
      ? {
          id: Number(r.carrier_invoice_id),
          number: r.carrier_invoice_number,
          date: r.carrier_invoice_date,
          amount: r.carrier_invoice_amount,
          currency: r.carrier_invoice_currency,
          paymentStatus: r.carrier_invoice_payment,
        }
      : null,
    deal: r.deal_id ? { id: Number(r.deal_id), key: r.deal_key!, title: r.deal_title! } : null,
    containerNo: r.container_no,
    cargo: r.cargo,
    transport: r.transport,
    route: r.route,
    depositDate: r.deposit_date,
    flags: r.flags ?? {},
    notes: r.notes,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    closedAt: r.closed_at,
    milestones,
    /** Плановая дата текущего этапа — «когда следующий шаг». */
    nextDate: keyMilestone?.plan ?? null,
    /** Неотмеченные флажки текущего и пройденных этапов. */
    pendingFlags: FLAG_KEYS.filter((k) => !r.flags?.[k] && FLAGS[k].stage <= Number(r.stage)),
  };
}
export type ShipmentDto = ReturnType<typeof toShipment>;

async function listShipments(tx: DbOrTx, where: SQL): Promise<ShipmentDto[]> {
  const result = await tx.execute<Row>(listSql(where));
  return result.rows.map(toShipment);
}

async function findShipment(tx: DbOrTx, raw: unknown) {
  const number = parseShipmentNumber(raw);
  const [row] = await tx.select().from(shipments).where(eq(shipments.number, number));
  if (!row) throw new HttpError(404, "Сделка не найдена");
  return row;
}

async function getShipmentDto(tx: DbOrTx, id: number): Promise<ShipmentDto> {
  const [dto] = await listShipments(tx, sql`s.id = ${id}`);
  return dto;
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
  shipment: { number: number; label: string; stage: number; containerNo: string | null; cargo: string; client: string | null; carrier: string | null };
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
      stage: sh.stage,
      containerNo: sh.containerNo,
      cargo: sh.cargo,
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

export async function shipmentRoutes(app: FastifyInstance): Promise<void> {
  app.get("/shipments", async (request) => {
    const q = request.query as Record<string, string | undefined>;
    const conds: SQL[] = [];
    const status = q.status ?? "active";
    if (status !== "all") conds.push(sql`s.status = ${status}`);
    if (q.stage && /^\d$/.test(q.stage)) conds.push(sql`s.stage = ${Number(q.stage)}`);
    for (const [param, column] of [["clientId", sql`s.client_id`], ["supplierId", sql`s.supplier_id`], ["carrierId", sql`s.carrier_id`], ["dealId", sql`s.deal_id`]] as const) {
      const v = Number(q[param]);
      if (q[param] && Number.isSafeInteger(v)) conds.push(sql`${column} = ${v}`);
    }
    const text = String(q.q ?? "").trim().slice(0, 100);
    if (text) {
      const like = `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      const num = /^(?:[сc]-?)?0*(\d{1,9})$/i.exec(text);
      conds.push(sql`(s.container_no ILIKE ${like} OR s.cargo ILIKE ${like} OR s.route ILIKE ${like} OR cl.name ILIKE ${like}
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
      const row = await createShipment(tx, body(request), user.id);
      await audit(tx, { userId: user.id, action: "create", entityType: "shipment", entityId: row.number, summary: `Создал сделку ${shipmentLabel(row.number)}`, ip: request.ip });
      return { shipment: await getShipmentDto(tx, row.id) };
    });
  });

  app.get("/shipments/:number", async (request) => {
    const row = await findShipment(db, (request.params as { number: string }).number);
    const events = await db
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
      .limit(300);
    return { shipment: await getShipmentDto(db, row.id), events };
  });

  app.patch("/shipments/:number", async (request) => {
    const user = currentUser(request);
    return db.transaction(async (tx) => {
      const row = await findShipment(tx, (request.params as { number: string }).number);
      const v = parseShipmentFields(body(request));
      await checkLinks(tx, v);
      if ("containerNo" in v && !v.containerNo) {
        const ms = await loadMilestones(tx, row.id);
        if (ms.loading?.fact) throw new HttpError(400, "Груз уже погружен — номер контейнера обязателен");
      }
      const changed: ShipmentField[] = [];
      for (const field of Object.keys(v) as ShipmentField[]) {
        const before = row[field] ?? null;
        const after = v[field] ?? null;
        if (before === after) continue;
        changed.push(field);
        if (field === "notes") {
          await addShipmentEvent(tx, row.id, user.id, "field", field);
        } else {
          await addShipmentEvent(tx, row.id, user.id, "field", field, await shipmentDisplay(tx, field, before), await shipmentDisplay(tx, field, after));
        }
      }
      if (changed.length) {
        await tx.update(shipments).set({ ...v, updatedAt: new Date() }).where(eq(shipments.id, row.id));
        await audit(tx, {
          userId: user.id,
          action: "update",
          entityType: "shipment",
          entityId: row.number,
          summary: `Изменил сделку ${shipmentLabel(row.number)}: ${changed.map((f) => SHIPMENT_FIELDS[f]).join(", ")}`,
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
        summary: `${shipmentLabel(row.number)}: ${label} — ${"fact" in input ? `факт ${input.fact ?? "снят"}` : `план ${input.plan ?? "снят"}`}${shifted ? `, сдвинуто ещё ${shifted}` : ""}`,
        ip: request.ip,
      });
      return { shipment: await getShipmentDto(tx, row.id), shifted };
    });
  });

  app.put("/shipments/:number/flags/:key", async (request) => {
    const user = currentUser(request);
    const { number, key } = request.params as { number: string; key: string };
    if (!(FLAG_KEYS as string[]).includes(key)) throw new HttpError(400, "Неизвестный флажок");
    return db.transaction(async (tx) => {
      const row = await findShipment(tx, number);
      const done = body<{ done: boolean }>(request).done === true;
      await setFlag(tx, row, key as FlagKey, done, user.id);
      await audit(tx, {
        userId: user.id,
        action: "update",
        entityType: "shipment",
        entityId: row.number,
        summary: `${shipmentLabel(row.number)}: ${FLAGS[key as FlagKey].label} — ${done ? "выполнено" : "снята отметка"}`,
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
        await audit(tx, { userId: user.id, action: "update", entityType: "shipment", entityId: row.number, summary: `${verb} сделку ${shipmentLabel(row.number)}`, ip: request.ip });
      }
      return { shipment: await getShipmentDto(tx, row.id) };
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
    await db.delete(shipments).where(and(eq(shipments.id, row.id)));
    await audit(db, { userId: admin.id, action: "delete", entityType: "shipment", entityId: row.number, summary: `Удалил сделку ${shipmentLabel(row.number)}`, ip: request.ip });
    return { ok: true };
  });

  /** Календарь: события всех сделок в работе. Группировку по неделям делает интерфейс. */
  app.get("/calendar", async () => {
    const list = await listShipments(db, sql`s.status = 'active'`);
    return { events: calendarEvents(list), today: new Date().toISOString().slice(0, 10) };
  });
}
