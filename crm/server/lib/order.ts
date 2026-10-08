/**
 * Поручение на закупку: черновик из сделки и DOCX по шаблону ТЛК БАРС
 * (crm/templates/commission_order.docx, поля {{…}} — docx-templates).
 */

import fs from "node:fs";
import path from "node:path";

import { createReport } from "docx-templates";
import { and, asc, eq, inArray } from "drizzle-orm";

import { type CostLine, defaultCostLines } from "../../shared/documents.ts";
import { CRM_ROOT } from "../config.ts";
import type { DbOrTx } from "../db/client.ts";
import { counterparties, deals, documentItems, documents } from "../db/schema.ts";
import { HttpError } from "./http.ts";
import { getCompany } from "./settings.ts";

export const ORDER_TEMPLATE = path.join(CRM_ROOT, "templates", "commission_order.docx");

export type OrderData = {
  city: string;
  incoterms: string;
  paymentTerms: string;
  deliveryPoint: string;
  costs: CostLine[];
};

/** Черновик поручения по сделке: товары из инвойсов поставщика, смета — стандартная. */
export async function buildOrderDraft(tx: DbOrTx, dealId: number) {
  const [deal] = await tx.select().from(deals).where(eq(deals.id, dealId));
  if (!deal) throw new HttpError(404, "Сделка не найдена");
  if (deal.scheme !== "commission") throw new HttpError(400, "Поручение оформляется по договору комиссии — у сделки другая схема");
  if (!deal.clientId) throw new HttpError(400, "Укажите в сделке клиента");
  if (!deal.clientContractId) {
    throw new HttpError(400, "Нет договора комиссии с клиентом. Загрузите договор комиссии клиента — он подтянется в сделку сам.");
  }
  const [contract] = await tx.select().from(documents).where(eq(documents.id, deal.clientContractId));
  if (!contract || contract.type !== "commission_contract") {
    throw new HttpError(400, "В сделке выбран не договор комиссии");
  }

  const invoices = await tx
    .select()
    .from(documents)
    .where(and(eq(documents.dealId, dealId), eq(documents.type, "supplier_invoice")))
    .orderBy(asc(documents.date), asc(documents.id));
  const items = invoices.length
    ? await tx
        .select()
        .from(documentItems)
        .where(inArray(documentItems.documentId, invoices.map((i) => i.id)))
        .orderBy(asc(documentItems.documentId), asc(documentItems.position))
    : [];

  const currency = invoices[0]?.currency ?? "CNY";
  const goodsTotal = items.reduce((sum, i) => sum + Number(i.amount ?? 0), 0);
  const first = (invoices[0]?.data ?? {}) as { incoterms?: string; paymentTerms?: string };
  const company = await getCompany(tx);

  const costs = defaultCostLines(currency);
  costs[0].amount = goodsTotal ? Math.round(goodsTotal * 100) / 100 : null;
  costs[1].name = `Оплата транспорта по маршруту ${[deal.pickupLocation, deal.deliveryLocation].filter(Boolean).join(" - ")}`.trim();

  const data: OrderData = {
    city: company.city || "г. Красногорск",
    incoterms: first.incoterms ?? "",
    paymentTerms: first.paymentTerms ?? "",
    deliveryPoint: deal.deliveryLocation ?? "",
    costs,
  };
  return {
    deal,
    contract,
    currency,
    amount: goodsTotal ? Math.round(goodsTotal * 100) / 100 : null,
    data,
    items: items.map((i, idx) => ({
      productId: i.productId,
      name: i.name,
      batchNo: String(idx + 1),
      hsCode: i.hsCode,
      quantity: i.quantity,
      unit: i.unit,
      price: i.price,
      amount: i.amount,
    })),
  };
}

// ── Форматирование для документа ──────────────────────────────────────────

const MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
const CURRENCY_TEXT: Record<string, string> = {
  CNY: "CNY (китайский юань)",
  USD: "USD (доллар США)",
  EUR: "EUR (евро)",
  RUB: "RUB (российский рубль)",
};
const SIGN: Record<string, string> = { CNY: "¥", USD: "$", EUR: "€" };

function parts(date: string | null): [string, string, string] | null {
  if (!date) return null;
  const [y, m, d] = date.split("-");
  return [d, MONTHS[Number(m) - 1], y];
}
/** «09» марта 2026 г. */
export const contractDate = (date: string | null) => {
  const p = parts(date);
  return p ? `«${p[0]}» ${p[1]} ${p[2]} г.` : "«___» __________ 20__ г.";
};
/** “05” октября 2026г */
export const orderDate = (date: string | null) => {
  const p = parts(date);
  return p ? `“${p[0]}” ${p[1]} ${p[2]}г` : "“___” __________ 20__г";
};

const num = (n: number, digits = 2) =>
  n.toLocaleString("ru-RU", { minimumFractionDigits: digits, maximumFractionDigits: digits }).replace(/ /g, " ");
const qtyText = (n: number) => n.toLocaleString("ru-RU", { maximumFractionDigits: 3 }).replace(/ /g, " ");

/** ¥138 420,00 — для таблицы товаров. */
export function moneyPrefix(amount: number | null, currency: string): string {
  if (amount === null) return "";
  const sign = SIGN[currency];
  return sign ? `${sign}${num(amount)}` : `${num(amount)} ${currency === "RUB" ? "руб." : currency}`;
}
/** 138 420,00 ¥ / 20 000,00 руб. — для сметы. */
export function moneySuffix(amount: number | null, currency: string): string {
  if (amount === null) return "Подтверждаемый расход";
  return `${num(amount)} ${SIGN[currency] ?? (currency === "RUB" ? "руб." : currency)}`;
}

type Party = typeof counterparties.$inferSelect;

function partyDetails(p: Party): string[] {
  const lines = [
    `Адрес: ${p.legalAddress ?? ""}`,
    `${p.kind === "ip" ? "ОГРНИП" : "ОГРН"}: ${p.ogrn ?? ""}`,
    p.kpp ? `ИНН: ${p.inn ?? ""}/КПП: ${p.kpp}` : `ИНН: ${p.inn ?? ""}`,
    `Расчетный счёт: ${p.bankAccount ?? ""}`,
    `Корр. счёт: ${p.bankCorrAccount ?? ""}`,
  ];
  if (p.bankAddress) lines.push(`Юр. адрес банка: ${p.bankAddress}`);
  if (p.bankInn) lines.push(`ИНН Банка: ${p.bankInn}`);
  lines.push(`БИК: ${p.bankBik ?? ""}`, `Банк: ${p.bankName ?? ""}`);
  return lines;
}

/** «Иванова Ирина Игоревна» → «Иванова И.И.» */
export function shortName(full: string | null | undefined): string {
  if (!full) return "";
  const [last, ...rest] = full.trim().split(/\s+/);
  if (rest.length === 0 || /\./.test(full)) return full.trim();
  return `${last} ${rest.map((r) => `${r[0]}.`).join("")}`;
}

/** Данные для шаблона поручения. */
export async function orderTemplateData(tx: DbOrTx, documentId: number) {
  const [doc] = await tx.select().from(documents).where(eq(documents.id, documentId));
  if (!doc || doc.type !== "commission_order") throw new HttpError(404, "Поручение не найдено");
  const [contract] = doc.parentId ? await tx.select().from(documents).where(eq(documents.id, doc.parentId)) : [];
  const [client] = doc.counterpartyId ? await tx.select().from(counterparties).where(eq(counterparties.id, doc.counterpartyId)) : [];
  if (!client) throw new HttpError(400, "В поручении не указан клиент (комитент)");
  const items = await tx
    .select()
    .from(documentItems)
    .where(eq(documentItems.documentId, documentId))
    .orderBy(asc(documentItems.position));
  const company = await getCompany(tx);
  const account = company.accounts.find((a) => a.id === company.orderAccountId) ?? company.accounts[0];
  const data = (doc.data ?? {}) as Partial<OrderData>;
  const currency = doc.currency ?? "CNY";

  const units = [...new Set(items.map((i) => i.unit ?? ""))];
  const totalQty = items.reduce((s, i) => s + Number(i.quantity ?? 0), 0);
  const totalAmount = items.reduce((s, i) => s + Number(i.amount ?? 0), 0);

  const companyDetails = [
    `Адрес: ${company.legalAddress}`,
    `ОГРН: ${company.ogrn}`,
    `ИНН: ${company.inn}/КПП: ${company.kpp}`,
    ...(account
      ? [
          `Расчетный счёт: ${account.account}`,
          `Корр. счёт: ${account.corrAccount}`,
          `Юр. адрес банка: ${account.bankAddress}`,
          `ИНН Банка: ${account.bankInn}`,
          `БИК: ${account.bik}`,
          `Банк: ${account.bankName}`,
        ]
      : []),
  ];

  return {
    order: {
      seq: doc.number ?? (doc.seqNo ? String(doc.seqNo).padStart(2, "0") : "___"),
      city: data.city ?? company.city,
      date: orderDate(doc.date),
      incoterms: data.incoterms ?? "",
      currencyText: CURRENCY_TEXT[currency] ?? currency,
      paymentTerms: data.paymentTerms ?? "",
      deliveryPoint: data.deliveryPoint ?? "",
    },
    contract: { number: contract?.number ?? "___", date: contractDate(contract?.date ?? null) },
    company: {
      name: company.name,
      lines: companyDetails,
      signTitle: company.signatoryTitle || "Директор",
      signer: company.signatoryShort || shortName(company.signatoryName),
    },
    client: {
      name: client.name,
      lines: partyDetails(client),
      signTitle: client.signatoryTitle || "Директор",
      signer: shortName(client.signatoryName) || client.name.replace(/^ИП\s+/, ""),
    },
    items: items.map((i, idx) => ({
      no: idx + 1,
      name: i.name,
      batch: i.batchNo ?? "",
      qty: i.quantity !== null ? `${qtyText(Number(i.quantity))}${i.unit ? ` ${i.unit}` : ""}` : "",
      price: i.price !== null ? `${moneyPrefix(Number(i.price), currency)}${i.unit ? ` / ${i.unit}` : ""}` : "",
      amount: i.amount !== null ? moneyPrefix(Number(i.amount), currency) : "",
    })),
    totals: {
      qty: units.length === 1 && totalQty ? `${qtyText(totalQty)}${units[0] ? ` ${units[0]}` : ""}` : "",
      amount: moneyPrefix(totalAmount, currency),
    },
    costs: (data.costs ?? []).map((c) => ({
      name: c.name,
      amount: c.category === "currency_control" && c.amount === null ? "" : moneySuffix(c.amount, c.currency),
      term: c.term,
    })),
  };
}

/** DOCX поручения. Шаблон можно заменить своим: CRM_UPLOAD_DIR/templates/commission_order.docx. */
export async function renderOrderDocx(tx: DbOrTx, documentId: number, uploadDir: string): Promise<Buffer> {
  const custom = path.join(uploadDir, "templates", "commission_order.docx");
  const template = await fs.promises.readFile(fs.existsSync(custom) ? custom : ORDER_TEMPLATE);
  const data = await orderTemplateData(tx, documentId);
  const out = await createReport({ template, data, cmdDelimiter: ["{{", "}}"], failFast: false, rejectNullish: false });
  return Buffer.from(out);
}
