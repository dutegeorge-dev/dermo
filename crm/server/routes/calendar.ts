/**
 * Свои события календаря: встречи, поездки, оплаты счетов, звонки, задачи. В GET /calendar они идут вместе с датами
 * сделок (calendarCustomEvents); здесь — создание, правка, «выполнено», удаление.
 */

import { and, desc, eq, gte, or, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { alias } from "drizzle-orm/pg-core";

import { CUSTOM_EVENT_TYPES, type CustomEvent, type CustomEventType } from "../../shared/calendar.ts";
import { CURRENCIES } from "../../shared/documents.ts";
import { addDays } from "../../shared/shipments.ts";
import { db, type DbOrTx } from "../db/client.ts";
import { calendarEvents, counterparties, shipments, users } from "../db/schema.ts";
import { audit } from "../lib/audit.ts";
import { body, currentUser, HttpError, intParam } from "../lib/http.ts";

const assignee = alias(users, "assignee");

/** События: невыполненные — все, выполненные — за последние 90 дней (для вида «Месяц»). */
export async function calendarCustomEvents(tx: DbOrTx, where = or(eq(calendarEvents.done, false), gte(calendarEvents.date, addDays(new Date().toISOString().slice(0, 10), -90)))): Promise<CustomEvent[]> {
  const rows = await tx
    .select({
      id: calendarEvents.id,
      type: calendarEvents.type,
      title: calendarEvents.title,
      date: sql<string>`${calendarEvents.date}::text`,
      time: calendarEvents.time,
      endDate: sql<string | null>`${calendarEvents.endDate}::text`,
      notes: calendarEvents.notes,
      amount: sql<number | null>`${calendarEvents.amount}::float8`,
      currency: calendarEvents.currency,
      shipmentId: calendarEvents.shipmentId,
      shipmentNumber: shipments.number,
      shipmentTitle: shipments.title,
      counterpartyId: calendarEvents.counterpartyId,
      counterpartyName: counterparties.name,
      assigneeId: calendarEvents.assigneeId,
      assigneeName: assignee.name,
      done: calendarEvents.done,
      createdBy: calendarEvents.createdBy,
      createdByName: users.name,
    })
    .from(calendarEvents)
    .leftJoin(shipments, eq(shipments.id, calendarEvents.shipmentId))
    .leftJoin(counterparties, eq(counterparties.id, calendarEvents.counterpartyId))
    .leftJoin(assignee, eq(assignee.id, calendarEvents.assigneeId))
    .leftJoin(users, eq(users.id, calendarEvents.createdBy))
    .where(where)
    .orderBy(calendarEvents.date, calendarEvents.time, desc(calendarEvents.id))
    .limit(2000);
  return rows.map((r) => ({ ...r, type: (r.type in CUSTOM_EVENT_TYPES ? r.type : "other") as CustomEventType }));
}

const dateOf = (v: unknown, label: string, required: boolean): string | null => {
  if ((v === null || v === undefined || v === "") && !required) return null;
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  throw new HttpError(400, `Укажите ${label}`);
};

/** Поля события из запроса; partial — только переданные (правка). */
function eventValues(input: Record<string, unknown>, partial: boolean) {
  const v: Partial<typeof calendarEvents.$inferInsert> = {};
  const has = (k: string) => !partial || k in input;
  if (has("type")) v.type = String(input.type) in CUSTOM_EVENT_TYPES ? String(input.type) : "other";
  if (has("title")) {
    const title = String(input.title ?? "").trim().slice(0, 300);
    if (!title) throw new HttpError(400, "Напишите, что за событие");
    v.title = title;
  }
  if (has("date")) v.date = dateOf(input.date, "дату", true)!;
  if (has("time")) {
    const t = String(input.time ?? "").trim();
    if (t && !/^([01]\d|2[0-3]):[0-5]\d$/.test(t)) throw new HttpError(400, "Время — ЧЧ:ММ");
    v.time = t || null;
  }
  if (has("endDate")) v.endDate = dateOf(input.endDate, "дату окончания", false);
  if (has("notes")) v.notes = String(input.notes ?? "").slice(0, 5000);
  if (has("amount")) {
    const n = input.amount === null || input.amount === "" || input.amount === undefined ? null : Number(String(input.amount).replace(/\s/g, "").replace(",", "."));
    if (n !== null && (!Number.isFinite(n) || n < 0)) throw new HttpError(400, "Сумма — число");
    v.amount = n === null ? null : String(Math.round(n * 100) / 100);
  }
  if (has("currency")) v.currency = (CURRENCIES as readonly string[]).includes(String(input.currency)) ? String(input.currency) : null;
  for (const k of ["shipmentId", "counterpartyId", "assigneeId"] as const) {
    if (has(k)) v[k] = typeof input[k] === "number" && (input[k] as number) > 0 ? (input[k] as number) : null;
  }
  if ("done" in input) {
    v.done = input.done === true;
    v.doneAt = v.done ? new Date() : null;
  }
  if (v.endDate && v.date && v.endDate < v.date) throw new HttpError(400, "Дата окончания раньше начала");
  return v;
}

export async function calendarRoutes(app: FastifyInstance): Promise<void> {
  app.post("/calendar/events", async (request) => {
    const user = currentUser(request);
    const v = eventValues(body<Record<string, unknown>>(request), false);
    const [row] = await db
      .insert(calendarEvents)
      .values({ ...(v as typeof calendarEvents.$inferInsert), assigneeId: v.assigneeId ?? user.id, createdBy: user.id })
      .returning({ id: calendarEvents.id, title: calendarEvents.title, date: calendarEvents.date });
    await audit(db, { userId: user.id, action: "create", entityType: "calendar_event", entityId: row.id, summary: `Добавил в календарь «${row.title}» на ${row.date}`, ip: request.ip });
    return { event: (await calendarCustomEvents(db, eq(calendarEvents.id, row.id)))[0] };
  });

  app.patch("/calendar/events/:id", async (request) => {
    const user = currentUser(request);
    const id = intParam((request.params as { id: string }).id);
    const v = eventValues(body<Record<string, unknown>>(request), true);
    if ("endDate" in v || "date" in v) {
      const [cur] = await db.select({ date: calendarEvents.date, endDate: calendarEvents.endDate }).from(calendarEvents).where(eq(calendarEvents.id, id));
      const start = v.date ?? cur?.date;
      const end = "endDate" in v ? v.endDate : cur?.endDate;
      if (start && end && end < start) throw new HttpError(400, "Дата окончания раньше начала");
    }
    const [row] = await db.update(calendarEvents).set({ ...v, updatedAt: new Date() }).where(eq(calendarEvents.id, id)).returning({ id: calendarEvents.id, title: calendarEvents.title });
    if (!row) throw new HttpError(404, "Событие не найдено");
    await audit(db, { userId: user.id, action: "update", entityType: "calendar_event", entityId: id, summary: `Изменил событие календаря «${row.title}»${"done" in v ? (v.done ? " — выполнено" : " — снова не выполнено") : ""}`, ip: request.ip });
    return { event: (await calendarCustomEvents(db, eq(calendarEvents.id, id)))[0] };
  });

  /** Удалить: автор, ответственный или админ. */
  app.delete("/calendar/events/:id", async (request) => {
    const user = currentUser(request);
    const id = intParam((request.params as { id: string }).id);
    const [row] = await db
      .delete(calendarEvents)
      .where(and(eq(calendarEvents.id, id), user.role === "admin" ? undefined : or(eq(calendarEvents.createdBy, user.id), eq(calendarEvents.assigneeId, user.id))))
      .returning({ title: calendarEvents.title });
    if (!row) throw new HttpError(404, "Событие не найдено (удалить может автор, ответственный или админ)");
    await audit(db, { userId: user.id, action: "delete", entityType: "calendar_event", entityId: id, summary: `Удалил событие календаря «${row.title}»`, ip: request.ip });
    return { ok: true };
  });
}
