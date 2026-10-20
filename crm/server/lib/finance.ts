/** Документы сделки и сводка «план / факт»: смета поручения против инвойсов, счетов подрядчиков и ДТ. */

import { eq, inArray, or, sql } from "drizzle-orm";

import {
  CONTRACTOR_COST,
  COST_CATEGORIES,
  type CostCategory,
  type CostLine,
} from "../../shared/documents.ts";
import type { ShipmentCalc } from "../../shared/customs.ts";
import type { DbOrTx } from "../db/client.ts";
import { counterparties, documents, shipments } from "../db/schema.ts";

export type DealDocument = Awaited<ReturnType<typeof shipmentDocuments>>[number];

/** Документы сделки + договор клиента и контракт поставщика, выбранные в сделке. */
export async function shipmentDocuments(db: DbOrTx, shipmentId: number) {
  const [deal] = await db
    .select({ clientContractId: shipments.clientContractId, supplierContractId: shipments.supplierContractId })
    .from(shipments)
    .where(eq(shipments.id, shipmentId));
  const contractIds = [deal?.clientContractId, deal?.supplierContractId].filter((x): x is number => !!x);
  return db
    .select({
      id: documents.id,
      type: documents.type,
      number: documents.number,
      date: documents.date,
      seqNo: documents.seqNo,
      parentId: documents.parentId,
      shipmentId: documents.shipmentId,
      counterpartyId: documents.counterpartyId,
      counterpartyName: counterparties.name,
      contractorType: counterparties.contractorType,
      currency: documents.currency,
      amount: sql<number | null>`${documents.amount}::float8`,
      status: documents.status,
      paymentStatus: documents.paymentStatus,
      paidAmount: sql<number | null>`${documents.paidAmount}::float8`,
      paidAt: documents.paidAt,
      validUntil: documents.validUntil,
      data: documents.data,
      fileCount: sql<number>`(select count(*)::int from attachments a where a.owner_type = 'document' and a.owner_id = ${documents.id} and a.label is distinct from 'payment')`,
      paymentFileCount: sql<number>`(select count(*)::int from attachments a where a.owner_type = 'document' and a.owner_id = ${documents.id} and a.label = 'payment')`,
      // Файлы документа — чтобы в сделке было видно каждый: оригинал, подписанный скан, каждую платёжку.
      files: sql<{ id: string; filename: string; label: string | null; createdAt: string }[]>`coalesce((select json_agg(json_build_object(
        'id', a.id, 'filename', a.filename, 'label', a.label, 'createdAt', a.created_at) order by a.created_at)
        from attachments a where a.owner_type = 'document' and a.owner_id = ${documents.id}), '[]'::json)`,
    })
    .from(documents)
    .leftJoin(counterparties, eq(counterparties.id, documents.counterpartyId))
    .where(contractIds.length ? or(eq(documents.shipmentId, shipmentId), inArray(documents.id, contractIds)) : eq(documents.shipmentId, shipmentId))
    .orderBy(documents.date, documents.id);
}

type Money = { currency: string; amount: number; paid: number };

export type FinanceRow = {
  category: CostCategory;
  label: string;
  /** План из поручения: сумма, «подтверждаемый расход» (amount null) или нет строки. */
  plan: { amount: number | null; currency: string } | null;
  /** Факт по валютам: выставлено и оплачено. */
  fact: Money[];
};

function paidOf(doc: DealDocument): number {
  if (doc.paymentStatus === "paid") return doc.amount ?? 0;
  if (doc.paymentStatus === "partial") return doc.paidAmount ?? 0;
  return 0;
}

function addMoney(list: Money[], currency: string, amount: number, paid: number) {
  const row = list.find((m) => m.currency === currency);
  if (row) {
    row.amount += amount;
    row.paid += paid;
  } else list.push({ currency, amount, paid });
}

/** Статья расходов для фактического документа. */
export function costCategoryOf(doc: Pick<DealDocument, "type" | "data" | "contractorType">): CostCategory | null {
  if (doc.type === "supplier_invoice") return "goods";
  if (doc.type === "customs_declaration") return "customs";
  if (doc.type === "contractor_invoice") {
    const explicit = (doc.data as { costCategory?: string })?.costCategory;
    if (explicit && explicit in COST_CATEGORIES) return explicit as CostCategory;
    return CONTRACTOR_COST[doc.contractorType ?? "other"] ?? "transport";
  }
  return null;
}

/**
 * План — из расчёта сделки («Рассчитать и сохранить»), если он есть: он главнее сметы поручения (готовое
 * поручение из файла часто без разобранной сметы). Статьи, которых нет в расчёте, — из поручения.
 */
export function calcPlan(calc: ShipmentCalc): CostLine[] {
  const rub = (a: number | null | undefined, c: string) => (a ? a * (c === "RUB" ? 1 : (calc.rates[c] ?? 0)) : 0);
  const fx = calc.fxPercent ? ((rub(calc.goodsAmount, calc.goodsCurrency) + rub(calc.transportAmount, calc.transportCurrency)) * calc.fxPercent) / 100 : 0;
  const line = (category: CostCategory, amount: number | null, currency: string): CostLine => ({ category, name: COST_CATEGORIES[category], amount: amount ? Math.round(amount * 100) / 100 : null, currency, term: "" });
  return [
    line("goods", calc.goodsAmount, calc.goodsCurrency),
    line("transport", calc.transportAmount, calc.transportCurrency),
    line("fx", fx, "RUB"),
    line("customs", calc.customs.duty + calc.customs.vat, "RUB"),
    line("broker", calc.broker, "RUB"),
    line("terminal", calc.terminal, "RUB"),
    line("commission", calc.commission, "RUB"),
  ].filter((l) => l.amount);
}

export function shipmentFinance(docs: DealDocument[], calc: ShipmentCalc | null = null) {
  const order = docs.find((d) => d.type === "commission_order" && d.status !== "cancelled");
  const fromOrder = ((order?.data as { costs?: CostLine[] })?.costs ?? []) as CostLine[];
  const fromCalc = calc ? calcPlan(calc) : [];
  const plan = [...fromCalc, ...fromOrder.filter((l) => !fromCalc.some((c) => c.category === l.category))];
  const rows = new Map<CostCategory, FinanceRow>();
  const row = (category: CostCategory) => {
    let r = rows.get(category);
    if (!r) {
      r = { category, label: COST_CATEGORIES[category], plan: null, fact: [] };
      rows.set(category, r);
    }
    return r;
  };

  for (const line of plan) {
    if (!(line.category in COST_CATEGORIES)) continue;
    const r = row(line.category);
    if (r.plan && r.plan.amount !== null && line.amount !== null && r.plan.currency === line.currency) r.plan.amount += line.amount;
    else if (!r.plan) r.plan = { amount: line.amount, currency: line.currency };
  }
  for (const doc of docs) {
    if (doc.status === "cancelled") continue;
    const category = costCategoryOf(doc);
    if (!category || doc.amount === null) continue;
    addMoney(row(category).fact, doc.currency ?? "RUB", doc.amount, paidOf(doc));
  }

  const billed: Money[] = [];
  for (const doc of docs) {
    if (doc.type === "client_invoice" && doc.amount !== null && doc.status !== "cancelled") {
      addMoney(billed, doc.currency ?? "RUB", doc.amount, paidOf(doc));
    }
  }

  const order_ = Object.keys(COST_CATEGORIES) as CostCategory[];
  return {
    orderId: order?.id ?? null,
    planSource: (fromCalc.length ? "calc" : order ? "order" : null) as "calc" | "order" | null,
    /** Доставка до склада клиента из расчёта (примерно) — не статья поручения, но входит в «доставку и таможню». */
    lastMile: calc?.lastMile ?? null,
    rows: [...rows.values()].sort((a, b) => order_.indexOf(a.category) - order_.indexOf(b.category)),
    clientInvoices: billed,
  };
}
