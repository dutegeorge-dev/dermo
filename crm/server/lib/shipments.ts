/** Сделки (отгрузки): создание, ключевые даты, пересчёт этапа, история. */

import { and, eq, sql } from "drizzle-orm";

import {
  addDays,
  daysBetween,
  FLAG_KEYS,
  type FlagKey,
  MILESTONE_KEYS,
  MILESTONES,
  type MilestoneKey,
  type Milestones,
  stageOf,
  TRANSPORTS,
} from "../../shared/shipments.ts";
import type { DbOrTx } from "../db/client.ts";
import { counterparties, deals, documents, shipmentEvents, shipmentMilestones, shipments } from "../db/schema.ts";
import { HttpError } from "./http.ts";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function parseDate(value: unknown, name: string): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || !DATE_RE.test(value) || Number.isNaN(Date.parse(value))) {
    throw new HttpError(400, `Некорректная дата: ${name}`);
  }
  return value;
}

export function parseShipmentNumber(raw: unknown): number {
  const m = /^(?:[сc]-?)?0*(\d{1,9})$/i.exec(String(raw ?? "").trim());
  if (!m) throw new HttpError(400, "Некорректный номер сделки");
  return Number(m[1]);
}

const s = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) || null : null);

const optId = (v: unknown, name: string): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n <= 0) throw new HttpError(400, `Некорректное поле ${name}`);
  return n;
};

/** Поля сделки, которые можно задать при создании и правке. */
export const SHIPMENT_FIELDS = {
  clientId: "Клиент",
  supplierId: "Поставщик",
  carrierId: "Перевозчик",
  carrierInvoiceId: "Инвойс перевозчика",
  dealId: "Лид из воронки",
  containerNo: "Номер контейнера",
  cargo: "Груз",
  transport: "Транспорт",
  route: "Маршрут",
  depositDate: "Депозит оплачен",
  notes: "Заметки",
} as const;
export type ShipmentField = keyof typeof SHIPMENT_FIELDS;

export function parseShipmentFields(input: Record<string, unknown>): Partial<typeof shipments.$inferInsert> {
  const v: Partial<typeof shipments.$inferInsert> = {};
  for (const f of ["clientId", "supplierId", "carrierId", "carrierInvoiceId", "dealId"] as const) {
    if (f in input) v[f] = optId(input[f], f);
  }
  if ("containerNo" in input) v.containerNo = s(input.containerNo, 50)?.toUpperCase().replace(/\s+/g, "") ?? null;
  if ("cargo" in input) v.cargo = s(input.cargo, 1000) ?? "";
  if ("transport" in input) {
    const t = s(input.transport, 20);
    if (t && !(t in TRANSPORTS)) throw new HttpError(400, "Некорректный вид транспорта");
    v.transport = t;
  }
  if ("route" in input) v.route = s(input.route, 300);
  if ("depositDate" in input) v.depositDate = parseDate(input.depositDate, "депозит");
  if ("notes" in input) v.notes = typeof input.notes === "string" ? input.notes.slice(0, 10000) : "";
  return v;
}

export async function addShipmentEvent(
  tx: DbOrTx,
  shipmentId: number,
  userId: number | null,
  kind: string,
  field: string | null = null,
  oldValue: unknown = null,
  newValue: unknown = null,
): Promise<void> {
  await tx.insert(shipmentEvents).values({ shipmentId, userId, kind, field, oldValue, newValue });
}

export async function loadMilestones(tx: DbOrTx, shipmentId: number): Promise<Milestones> {
  const rows = await tx.select().from(shipmentMilestones).where(eq(shipmentMilestones.shipmentId, shipmentId));
  const result: Milestones = {};
  for (const key of MILESTONE_KEYS) result[key] = { plan: null, fact: null };
  for (const r of rows) {
    if ((MILESTONE_KEYS as string[]).includes(r.key)) result[r.key as MilestoneKey] = { plan: r.plan, fact: r.fact };
  }
  return result;
}

async function upsertMilestone(tx: DbOrTx, shipmentId: number, key: MilestoneKey, plan: string | null, fact: string | null) {
  await tx
    .insert(shipmentMilestones)
    .values({ shipmentId, key, plan, fact })
    .onConflictDoUpdate({ target: [shipmentMilestones.shipmentId, shipmentMilestones.key], set: { plan, fact } });
}

/** Пересчитать этап по фактам; при смене — запись в историю. */
export async function refreshStage(tx: DbOrTx, shipmentId: number, userId: number | null): Promise<number> {
  const [row] = await tx.select({ stage: shipments.stage }).from(shipments).where(eq(shipments.id, shipmentId));
  const stage = stageOf(await loadMilestones(tx, shipmentId));
  if (row && row.stage !== stage) {
    await tx.update(shipments).set({ stage, updatedAt: new Date() }).where(eq(shipments.id, shipmentId));
    await addShipmentEvent(tx, shipmentId, userId, "stage", null, row.stage, stage);
  }
  return stage;
}

/** Проверки ссылок: роли контрагентов, инвойс перевозчика. */
export async function checkLinks(tx: DbOrTx, v: Partial<typeof shipments.$inferInsert>): Promise<void> {
  const roles = { clientId: "client", supplierId: "supplier", carrierId: "contractor" } as const;
  for (const [field, role] of Object.entries(roles) as [keyof typeof roles, string][]) {
    const id = v[field];
    if (!id) continue;
    const [c] = await tx.select({ role: counterparties.role }).from(counterparties).where(eq(counterparties.id, id));
    if (!c) throw new HttpError(400, `${SHIPMENT_FIELDS[field]}: контрагент не найден`);
    if (c.role !== role) throw new HttpError(400, `${SHIPMENT_FIELDS[field]}: выбран контрагент другого типа`);
  }
  if (v.carrierInvoiceId) {
    const [d] = await tx.select({ id: documents.id }).from(documents).where(eq(documents.id, v.carrierInvoiceId));
    if (!d) throw new HttpError(400, "Инвойс перевозчика не найден");
  }
  if (v.dealId) {
    const [d] = await tx.select({ id: deals.id }).from(deals).where(eq(deals.id, v.dealId));
    if (!d) throw new HttpError(400, "Лид из воронки не найден");
  }
}

export type MilestoneInput = Partial<Record<MilestoneKey, { plan?: unknown; fact?: unknown }>>;

export async function createShipment(
  tx: DbOrTx,
  input: Record<string, unknown>,
  userId: number | null,
): Promise<typeof shipments.$inferSelect> {
  const v = parseShipmentFields(input);
  await checkLinks(tx, v);
  const flags: Record<string, string> = {};
  if (input.flags && typeof input.flags === "object") {
    for (const [k, d] of Object.entries(input.flags as Record<string, unknown>)) {
      if ((FLAG_KEYS as string[]).includes(k) && d) flags[k] = parseDate(d, k) ?? new Date().toISOString().slice(0, 10);
    }
  }
  const [row] = await tx
    .insert(shipments)
    .values({ ...v, flags, createdBy: userId, ...(input.status === "closed" ? { status: "closed", closedAt: new Date() } : {}) })
    .returning();
  const ms = (input.milestones ?? {}) as MilestoneInput;
  for (const m of MILESTONES) {
    const plan = parseDate(ms[m.key]?.plan, m.label);
    const fact = parseDate(ms[m.key]?.fact, m.label);
    await upsertMilestone(tx, row.id, m.key, plan, fact);
  }
  const milestones = await loadMilestones(tx, row.id);
  if (milestones.loading?.fact && !row.containerNo) throw new HttpError(400, "Груз погружен — укажите номер контейнера");
  const stage = stageOf(milestones);
  await tx.update(shipments).set({ stage }).where(eq(shipments.id, row.id));
  await addShipmentEvent(tx, row.id, userId, "created");
  return { ...row, stage };
}

/**
 * Изменить план / факт ключевой даты. shift — сдвинуть плановые даты всех
 * следующих (ещё не наступивших) точек на столько же дней.
 */
export async function setMilestone(
  tx: DbOrTx,
  shipment: typeof shipments.$inferSelect,
  key: MilestoneKey,
  input: { plan?: unknown; fact?: unknown; shift?: unknown },
  userId: number | null,
): Promise<{ shifted: number }> {
  const milestones = await loadMilestones(tx, shipment.id);
  const current = milestones[key] ?? { plan: null, fact: null };
  let shifted = 0;
  if ("plan" in input) {
    const plan = parseDate(input.plan, "план");
    if (plan !== current.plan) {
      await upsertMilestone(tx, shipment.id, key, plan, current.fact);
      await addShipmentEvent(tx, shipment.id, userId, "plan", key, current.plan, plan);
      if (input.shift === true && plan && current.plan) {
        const delta = daysBetween(current.plan, plan);
        const after = MILESTONES.slice(MILESTONES.findIndex((m) => m.key === key) + 1);
        for (const m of after) {
          const d = milestones[m.key];
          if (!d?.plan || d.fact) continue;
          const moved = addDays(d.plan, delta);
          await upsertMilestone(tx, shipment.id, m.key, moved, null);
          await addShipmentEvent(tx, shipment.id, userId, "plan", m.key, d.plan, moved);
          shifted++;
        }
      }
      current.plan = plan;
    }
  }
  if ("fact" in input) {
    const fact = parseDate(input.fact, "факт");
    if (fact !== current.fact) {
      if (fact && key === "loading" && !shipment.containerNo) {
        throw new HttpError(400, "Чтобы отметить погрузку, укажите номер контейнера");
      }
      await upsertMilestone(tx, shipment.id, key, current.plan, fact);
      await addShipmentEvent(tx, shipment.id, userId, "fact", key, current.fact, fact);
    }
  }
  await tx.update(shipments).set({ updatedAt: new Date() }).where(eq(shipments.id, shipment.id));
  await refreshStage(tx, shipment.id, userId);
  return { shifted };
}

export async function setFlag(
  tx: DbOrTx,
  shipment: typeof shipments.$inferSelect,
  key: FlagKey,
  done: boolean,
  userId: number | null,
): Promise<void> {
  const flags = { ...shipment.flags };
  if (done === Boolean(flags[key])) return;
  if (done) flags[key] = new Date().toISOString().slice(0, 10);
  else delete flags[key];
  await tx.update(shipments).set({ flags, updatedAt: new Date() }).where(and(eq(shipments.id, shipment.id)));
  await addShipmentEvent(tx, shipment.id, userId, "flag", key, !done, done);
}

/** Название контрагента / документа / лида для истории изменений. */
export async function shipmentDisplay(tx: DbOrTx, field: ShipmentField, value: unknown): Promise<unknown> {
  if (value === null || value === undefined) return null;
  if (field === "clientId" || field === "supplierId" || field === "carrierId") {
    const [c] = await tx.select({ name: counterparties.name }).from(counterparties).where(eq(counterparties.id, Number(value)));
    return c?.name ?? value;
  }
  if (field === "carrierInvoiceId") {
    const [d] = await tx
      .select({ label: sql<string>`coalesce('№ ' || ${documents.number}, 'без номера')` })
      .from(documents)
      .where(eq(documents.id, Number(value)));
    return d ? `Инвойс ${d.label}` : value;
  }
  if (field === "dealId") {
    const [d] = await tx.select({ key: deals.key, title: deals.title }).from(deals).where(eq(deals.id, Number(value)));
    return d ? `${d.key} · ${d.title}` : value;
  }
  if (field === "transport") return TRANSPORTS[value as keyof typeof TRANSPORTS] ?? value;
  return value;
}
