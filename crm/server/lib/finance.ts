/** Документы сделки и сводка «план / факт»: смета поручения против инвойсов, счетов подрядчиков и ДТ. */

import { eq, inArray, or, sql } from "drizzle-orm";

import {
  CONTRACTOR_COST,
  COST_CATEGORIES,
  type CostCategory,
  type CostLine,
} from "../../shared/documents.ts";
import type { DbOrTx } from "../db/client.ts";
import { counterparties, deals, documents } from "../db/schema.ts";

export type DealDocument = Awaited<ReturnType<typeof dealDocuments>>[number];

/** Документы сделки + договор клиента и контракт поставщика, выбранные в сделке. */
export async function dealDocuments(db: DbOrTx, dealId: number) {
  const [deal] = await db
    .select({ clientContractId: deals.clientContractId, supplierContractId: deals.supplierContractId })
    .from(deals)
    .where(eq(deals.id, dealId));
  const contractIds = [deal?.clientContractId, deal?.supplierContractId].filter((x): x is number => !!x);
  return db
    .select({
      id: documents.id,
      type: documents.type,
      number: documents.number,
      date: documents.date,
      seqNo: documents.seqNo,
      parentId: documents.parentId,
      dealId: documents.dealId,
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
      fileCount: sql<number>`(select count(*)::int from attachments a where a.owner_type = 'document' and a.owner_id = ${documents.id})`,
    })
    .from(documents)
    .leftJoin(counterparties, eq(counterparties.id, documents.counterpartyId))
    .where(contractIds.length ? or(eq(documents.dealId, dealId), inArray(documents.id, contractIds)) : eq(documents.dealId, dealId))
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

export async function dealFinance(_db: DbOrTx, _dealId: number, docs: DealDocument[]) {
  const order = docs.find((d) => d.type === "commission_order" && d.status !== "cancelled");
  const plan = ((order?.data as { costs?: CostLine[] })?.costs ?? []) as CostLine[];
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
    rows: [...rows.values()].sort((a, b) => order_.indexOf(a.category) - order_.indexOf(b.category)),
    clientInvoices: billed,
  };
}
