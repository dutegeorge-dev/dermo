/**
 * Сделки (отгрузки): поля, создание, ключевые даты, пересчёт этапа, история,
 * автоподбор договоров. Всё, что относится к исполнению заказа (документы,
 * поручение, план/факт), привязано к сделке, а не к лиду воронки.
 */

import { and, desc, eq, isNull, ne, or, sql } from "drizzle-orm";

import { CLIENT_CONTRACT_BY_SCHEME, type Scheme } from "../../shared/documents.ts";
import {
  addDays,
  daysBetween,
  FLAG_KEYS,
  type FlagKey,
  MILESTONE_KEYS,
  MILESTONES,
  type MilestoneKey,
  type Milestones,
  SHIPMENT_FIELDS,
  type ShipmentField,
  type ShipmentFieldSpec,
  stageOf,
} from "../../shared/shipments.ts";
import type { DbOrTx } from "../db/client.ts";
import { contacts, counterparties, deals, documents, shipmentEvents, shipmentMilestones, shipments, users } from "../db/schema.ts";
import { documentLabel } from "./deals.ts";
import { HttpError } from "./http.ts";

type ShipmentInsert = typeof shipments.$inferInsert;
export type ShipmentRow = typeof shipments.$inferSelect;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function parseDate(value: unknown, name: string): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || !DATE_RE.test(value) || Number.isNaN(Date.parse(value))) {
    throw new HttpError(400, `Некорректная дата: ${name}`);
  }
  return value;
}

/** Номер из адреса: «12», «№12», «С-012» → 12. */
export function parseShipmentNumber(raw: unknown): number {
  const m = /^(?:[сc]-?|№\s*)?0*(\d{1,9})$/i.exec(String(raw ?? "").trim());
  if (!m) throw new HttpError(400, "Некорректный номер сделки");
  return Number(m[1]);
}

const ROLE_OF = { client: "client", supplier: "supplier", carrier: "contractor" } as const;

async function idOf(tx: DbOrTx, value: unknown, spec: ShipmentFieldSpec): Promise<number | null> {
  if (value === null || value === undefined || value === "") return null;
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw new HttpError(400, `${spec.label}: неверное значение`);
  switch (spec.kind) {
    case "client":
    case "supplier":
    case "carrier": {
      const [c] = await tx.select({ role: counterparties.role }).from(counterparties).where(eq(counterparties.id, id));
      if (!c) throw new HttpError(400, `${spec.label}: контрагент не найден`);
      if (c.role !== ROLE_OF[spec.kind]) throw new HttpError(400, `${spec.label}: выбран контрагент другого типа`);
      return id;
    }
    case "contact": {
      const [c] = await tx.select({ id: contacts.id }).from(contacts).where(eq(contacts.id, id));
      if (!c) throw new HttpError(400, `${spec.label}: не найден`);
      return id;
    }
    case "document": {
      const [d] = await tx.select({ id: documents.id }).from(documents).where(eq(documents.id, id));
      if (!d) throw new HttpError(400, `${spec.label}: документ не найден`);
      return id;
    }
    case "deal": {
      const [d] = await tx.select({ id: deals.id }).from(deals).where(eq(deals.id, id));
      if (!d) throw new HttpError(400, `${spec.label}: не найден`);
      return id;
    }
    case "user": {
      const [u] = await tx.select({ id: users.id }).from(users).where(and(eq(users.id, id), eq(users.isActive, true)));
      if (!u) throw new HttpError(400, "Менеджер не найден или отключён");
      return id;
    }
    default:
      return id;
  }
}

async function parseField(tx: DbOrTx, field: ShipmentField, value: unknown): Promise<unknown> {
  const spec: ShipmentFieldSpec = SHIPMENT_FIELDS[field];
  switch (spec.kind) {
    case "text": {
      if (value !== null && value !== undefined && typeof value !== "string" && typeof value !== "number") {
        throw new HttpError(400, `${spec.label}: ожидается текст`);
      }
      let text = String(value ?? "").trim().replace(/\s+/g, " ").slice(0, spec.max ?? 1000);
      if (field === "containerNo") text = text.toUpperCase().replace(/\s+/g, "");
      if (spec.required && !text) throw new HttpError(400, `Укажите поле «${spec.label}»`);
      return field === "title" ? text : text || null;
    }
    case "longtext":
      return typeof value === "string" ? value.replace(/\r\n/g, "\n").slice(0, spec.max ?? 20_000) : "";
    case "number": {
      if (value === null || value === undefined || value === "") return null;
      const n = Number(String(value).replace(",", ".").replace(/\s/g, ""));
      if (!Number.isFinite(n) || n < 0 || n > 1e9) throw new HttpError(400, `${spec.label}: введите число`);
      return String(n);
    }
    case "date":
      return parseDate(value, spec.label);
    case "enum": {
      if (value === null || value === undefined || value === "") return field === "scheme" ? "commission" : null;
      if (!spec.values || !(String(value) in spec.values)) throw new HttpError(400, `${spec.label}: неизвестное значение`);
      return String(value);
    }
    default:
      return idOf(tx, value, spec);
  }
}

/** Значения известных полей из тела запроса. */
export async function parseShipmentFields(tx: DbOrTx, input: Record<string, unknown>): Promise<Partial<ShipmentInsert>> {
  const out: Record<string, unknown> = {};
  for (const field of Object.keys(SHIPMENT_FIELDS) as ShipmentField[]) {
    if (field in input) out[field] = await parseField(tx, field, input[field]);
  }
  return out as Partial<ShipmentInsert>;
}

export function sameShipmentValue(field: ShipmentField, before: unknown, after: unknown): boolean {
  if (SHIPMENT_FIELDS[field].kind === "number" && before != null && after != null) return Number(before) === Number(after);
  return JSON.stringify(before ?? null) === JSON.stringify(after ?? null);
}

/** Человекочитаемое значение поля — для истории. */
export async function shipmentDisplay(tx: DbOrTx, field: ShipmentField, value: unknown): Promise<string | null> {
  if (value === null || value === undefined || value === "") return null;
  const spec: ShipmentFieldSpec = SHIPMENT_FIELDS[field];
  switch (spec.kind) {
    case "number":
      return String(Number(value)).replace(".", ",");
    case "enum":
      return spec.values?.[String(value)] ?? String(value);
    case "client":
    case "supplier":
    case "carrier": {
      const [c] = await tx.select({ name: counterparties.name }).from(counterparties).where(eq(counterparties.id, Number(value)));
      return c?.name ?? `#${value}`;
    }
    case "contact": {
      const [c] = await tx.select({ name: contacts.name }).from(contacts).where(eq(contacts.id, Number(value)));
      return c?.name ?? `#${value}`;
    }
    case "user": {
      const [u] = await tx.select({ name: users.name }).from(users).where(eq(users.id, Number(value)));
      return u?.name ?? `#${value}`;
    }
    case "document":
      return documentLabel(tx, Number(value));
    case "deal": {
      const [d] = await tx.select({ key: deals.key, title: deals.title }).from(deals).where(eq(deals.id, Number(value)));
      return d ? `${d.key} · ${d.title}` : `#${value}`;
    }
    case "longtext": {
      const text = String(value);
      return text.length > 200 ? `${text.slice(0, 200)}…` : text;
    }
    default:
      return String(value);
  }
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

// ── Договоры ──────────────────────────────────────────────────────────────

/** Действующий договор нужного типа с контрагентом: не аннулирован, не истёк, самый свежий. */
export async function findActiveContract(
  tx: DbOrTx,
  type: string,
  counterpartyId: number,
  opts: { clientId?: number | null } = {},
): Promise<number | null> {
  const today = new Date().toISOString().slice(0, 10);
  const rows = await tx
    .select({ id: documents.id, clientId: documents.clientId })
    .from(documents)
    .where(
      and(
        eq(documents.type, type),
        eq(documents.counterpartyId, counterpartyId),
        or(isNull(documents.status), ne(documents.status, "cancelled")),
        or(isNull(documents.validUntil), sql`${documents.validUntil} >= ${today}`),
      ),
    )
    .orderBy(desc(documents.date), desc(documents.id));
  if (opts.clientId !== undefined) {
    // Контракт клиента (ТЭУ) важнее нашего; наш — без клиента.
    const own = rows.find((r) => r.clientId === opts.clientId) ?? rows.find((r) => r.clientId === null);
    return own?.id ?? null;
  }
  return rows[0]?.id ?? null;
}

/** Подставляет договор клиента и контракт поставщика, если они не выбраны. Возвращает, что подставил. */
export async function autoContracts(tx: DbOrTx, shipmentId: number): Promise<Partial<ShipmentInsert>> {
  const [s] = await tx.select().from(shipments).where(eq(shipments.id, shipmentId));
  if (!s) return {};
  const patch: Partial<ShipmentInsert> = {};
  if (!s.clientContractId && s.clientId) {
    const id = await findActiveContract(tx, CLIENT_CONTRACT_BY_SCHEME[s.scheme as Scheme], s.clientId);
    if (id) patch.clientContractId = id;
  }
  if (!s.supplierContractId && s.supplierId) {
    const id = await findActiveContract(tx, "supplier_contract", s.supplierId, { clientId: s.scheme === "teu" ? s.clientId : null });
    if (id) patch.supplierContractId = id;
  }
  if (Object.keys(patch).length) await tx.update(shipments).set(patch).where(eq(shipments.id, shipmentId));
  return patch;
}

// ── Ключевые даты ─────────────────────────────────────────────────────────

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

export type MilestoneInput = Partial<Record<MilestoneKey, { plan?: unknown; fact?: unknown }>>;

/** Новая сделка. title обязателен; договоры подбираются сами. */
export async function createShipment(tx: DbOrTx, input: Record<string, unknown>, userId: number | null): Promise<ShipmentRow> {
  const v = await parseShipmentFields(tx, input);
  if (!v.title) throw new HttpError(400, "Укажите название груза");
  const flags: Record<string, string> = {};
  if (input.flags && typeof input.flags === "object") {
    for (const [k, d] of Object.entries(input.flags as Record<string, unknown>)) {
      if ((FLAG_KEYS as string[]).includes(k) && d) flags[k] = parseDate(d, k) ?? new Date().toISOString().slice(0, 10);
    }
  }
  const [row] = await tx
    .insert(shipments)
    .values({
      ...v,
      title: v.title,
      assigneeId: "assigneeId" in v ? v.assigneeId : userId,
      flags,
      createdBy: userId,
      ...(input.status === "closed" ? { status: "closed", closedAt: new Date() } : {}),
    })
    .returning();
  const ms = (input.milestones ?? {}) as MilestoneInput;
  for (const m of MILESTONES) {
    await upsertMilestone(tx, row.id, m.key, parseDate(ms[m.key]?.plan, m.label), parseDate(ms[m.key]?.fact, m.label));
  }
  const milestones = await loadMilestones(tx, row.id);
  if (milestones.loading?.fact && !row.containerNo) throw new HttpError(400, "Груз погружен — укажите номер контейнера");
  const stage = stageOf(milestones);
  await tx.update(shipments).set({ stage }).where(eq(shipments.id, row.id));
  if (row.carrierId) await tx.execute(sql`INSERT INTO shipment_parties (shipment_id, counterparty_id) VALUES (${row.id}, ${row.carrierId}) ON CONFLICT DO NOTHING`);
  await autoContracts(tx, row.id);
  await addShipmentEvent(tx, row.id, userId, "created");
  const [fresh] = await tx.select().from(shipments).where(eq(shipments.id, row.id));
  return fresh;
}

/**
 * Изменить план / факт ключевой даты. shift — сдвинуть плановые даты всех
 * следующих (ещё не наступивших) точек на столько же дней.
 */
export async function setMilestone(
  tx: DbOrTx,
  shipment: ShipmentRow,
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

/**
 * Перенос карточки на доске на этап target: факты ключевых дат пройденных
 * этапов ставятся сегодняшним днём (если не стоят), следующих — снимаются.
 */
export async function moveToStage(tx: DbOrTx, shipment: ShipmentRow, target: number, userId: number | null): Promise<void> {
  const milestones = await loadMilestones(tx, shipment.id);
  const today = new Date().toISOString().slice(0, 10);
  for (const m of MILESTONES) {
    if (m.optional) continue;
    const d = milestones[m.key]!;
    if (m.stage < target && !d.fact) await setMilestone(tx, shipment, m.key, { fact: today }, userId);
    if (m.stage >= target && d.fact) await setMilestone(tx, shipment, m.key, { fact: null }, userId);
  }
}

export async function setFlag(tx: DbOrTx, shipment: ShipmentRow, key: FlagKey, done: boolean, userId: number | null): Promise<void> {
  const flags = { ...shipment.flags };
  if (done === Boolean(flags[key])) return;
  if (done) flags[key] = new Date().toISOString().slice(0, 10);
  else delete flags[key];
  await tx.update(shipments).set({ flags, updatedAt: new Date() }).where(eq(shipments.id, shipment.id));
  await addShipmentEvent(tx, shipment.id, userId, "flag", key, !done, done);
}
