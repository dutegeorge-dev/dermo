/**
 * Расчёт сделки для клиента: смета (перевозка, брокер, комиссия…) + таможенные платежи по товарам
 * из инвойсов поставщика. Сохраняется в shipments.calc — из него делаются КП и поручение, а перед
 * таможней его можно пересчитать по свежему курсу ЦБ.
 */

import fs from "node:fs";
import path from "node:path";

import { createReport } from "docx-templates";
import { and, asc, eq, inArray } from "drizzle-orm";

import { calcCustoms, type CalcItem, type CalcParams, DEFAULT_CALC_PARAMS, kpLines, type ShipmentCalc } from "../../shared/customs.ts";
import { CURRENCIES } from "../../shared/documents.ts";
import { TRANSPORTS } from "../../shared/shipments.ts";
import { CRM_ROOT } from "../config.ts";
import type { DbOrTx } from "../db/client.ts";
import { documentItems, documents, products, shipments } from "../db/schema.ts";
import { HttpError } from "./http.ts";
import { cbrRates } from "./rates.ts";
import { tnvedByCodes } from "./tnved.ts";

export const KP_TEMPLATE = path.join(CRM_ROOT, "templates", "kp.docx");

type ShipmentRow = typeof shipments.$inferSelect;

const TRANSPORT_KP: Record<string, string> = { rail: "ЖД перевозка", sea: "Морская перевозка", auto: "Автоперевозка", air: "Авиаперевозка", multimodal: "Мультимодальная перевозка" };

/** Параметры по умолчанию для новой сделки: подпись перевозки из вида транспорта и объёма. */
export function defaultParams(sh: ShipmentRow): CalcParams {
  const volume = sh.volumeM3 ? ` ${Number(sh.volumeM3).toLocaleString("ru-RU")} куб. м` : "";
  return { ...DEFAULT_CALC_PARAMS, transportLabel: `${TRANSPORT_KP[sh.transport ?? ""] ?? "Перевозка"}${volume}` };
}

const numOrNull = (v: unknown, label: string): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).replace(/\s/g, "").replace(",", "."));
  if (!Number.isFinite(n) || n < 0 || n > 1e12) throw new HttpError(400, `${label}: введите число`);
  return n;
};

/** Параметры из запроса (всё необязательное — по умолчанию из прошлого расчёта). */
export function parseParams(input: Record<string, unknown>, base: CalcParams): CalcParams {
  const p = { ...base };
  if ("transportLabel" in input) p.transportLabel = String(input.transportLabel ?? "").slice(0, 200);
  if ("transportAmount" in input) p.transportAmount = numOrNull(input.transportAmount, "Перевозка");
  if ("transportCurrency" in input) {
    const c = String(input.transportCurrency ?? "");
    if (!(CURRENCIES as readonly string[]).includes(c)) throw new HttpError(400, "Валюта перевозки — CNY, USD, EUR или RUB");
    p.transportCurrency = c;
  }
  if ("fxPercent" in input) p.fxPercent = numOrNull(input.fxPercent, "Комиссия за перевод");
  if ("broker" in input) p.broker = numOrNull(input.broker, "Таможенное оформление");
  if ("terminal" in input) p.terminal = numOrNull(input.terminal, "СВХ");
  if ("commission" in input) p.commission = numOrNull(input.commission, "Комиссия");
  if ("lastMile" in input) p.lastMile = numOrNull(input.lastMile, "Доставка до склада");
  if ("deliveryTerm" in input) p.deliveryTerm = String(input.deliveryTerm ?? "").slice(0, 300);
  return p;
}

/** Товары сделки для расчёта: позиции инвойсов поставщика; код ТН ВЭД — из справочника товаров, иначе из инвойса. */
export async function calcItems(tx: DbOrTx, shipmentId: number): Promise<{ items: (CalcItem & { currency: string })[]; currency: string }> {
  const invoices = await tx
    .select({ id: documents.id, currency: documents.currency })
    .from(documents)
    .where(and(eq(documents.shipmentId, shipmentId), eq(documents.type, "supplier_invoice")))
    .orderBy(asc(documents.date), asc(documents.id));
  if (!invoices.length) return { items: [], currency: "CNY" };
  const currencyOf = new Map(invoices.map((i) => [i.id, i.currency ?? "CNY"]));
  const rows = await tx
    .select({
      documentId: documentItems.documentId,
      productId: documentItems.productId,
      name: documentItems.name,
      itemHs: documentItems.hsCode,
      productHs: products.hsCode,
      vat10: products.vat10,
      quantity: documentItems.quantity,
      unit: documentItems.unit,
      amount: documentItems.amount,
    })
    .from(documentItems)
    .leftJoin(products, eq(products.id, documentItems.productId))
    .where(inArray(documentItems.documentId, invoices.map((i) => i.id)))
    .orderBy(asc(documentItems.documentId), asc(documentItems.position));
  const codes = rows.map((r) => (r.productHs ?? r.itemHs ?? "").replace(/\D/g, ""));
  const tariffs = await tnvedByCodes(tx, codes);
  return {
    currency: invoices[0].currency ?? "CNY",
    items: rows.map((r, i) => ({
      productId: r.productId,
      name: r.name,
      hsCode: codes[i] || null,
      tariff: tariffs.get(codes[i])?.tariff ?? null,
      vat10: Boolean(r.vat10),
      quantity: r.quantity === null ? null : Number(r.quantity),
      unit: r.unit,
      amount: Number(r.amount ?? 0),
      currency: currencyOf.get(r.documentId) ?? "CNY",
    })),
  };
}

/** Пересчитать: rates — сохранённые (пошлина не «плывёт» от курса) или свежие ЦБ. */
export async function computeCalc(tx: DbOrTx, sh: ShipmentRow, params: CalcParams, freshRates: boolean): Promise<ShipmentCalc> {
  const { items, currency } = await calcItems(tx, sh.id);
  if (!items.length) throw new HttpError(400, "Сначала загрузите инвойс поставщика — товары и суммы берутся из него");
  const saved = sh.calc;
  const { date, rates } = !freshRates && saved?.rates ? { date: saved.ratesDate, rates: saved.rates } : await cbrRates().catch((e: Error) => {
    throw new HttpError(502, e.message);
  });
  // Позиции в другой валюте — пересчитываем в валюту первого инвойса через рубли.
  const toGoods = (amount: number, cur: string) => (cur === currency ? amount : (amount * (rates[cur] ?? 0)) / (rates[currency] ?? 1));
  const goodsItems: CalcItem[] = items.map(({ currency: cur, ...i }) => ({ ...i, amount: toGoods(i.amount, cur) }));
  const customs = calcCustoms({
    items: goodsItems,
    goodsCurrency: currency,
    transportAmount: params.transportAmount,
    transportCurrency: params.transportCurrency,
    weightKg: sh.weightKg === null ? null : Number(sh.weightKg),
    rates,
  });
  return {
    ...params,
    ratesDate: date,
    rates,
    goodsCurrency: currency,
    goodsAmount: Math.round(goodsItems.reduce((s, i) => s + i.amount, 0) * 100) / 100,
    customs,
    calculatedAt: new Date().toISOString(),
  };
}

// ── КП (DOCX) ──────────────────────────────────────────────────────────────

const rubText = (n: number) => `${Math.round(n).toLocaleString("ru-RU").replace(/ /g, " ")} руб.`;
const dmy = (d: string) => d.split("-").reverse().join(".");
const rate = (n: number) => n.toLocaleString("ru-RU", { maximumFractionDigits: 2 });

export function kpTemplateData(sh: ShipmentRow, calc: ShipmentCalc) {
  const { lines, total } = kpLines(calc);
  const r = calc.rates;
  const ratePairs = [r.USD && r.CNY ? `1 USD = ${rate(r.USD / r.CNY)} CNY` : null, r.USD ? `1 USD = ${rate(r.USD)} RUB` : null, r.CNY ? `1 CNY = ${rate(r.CNY)} RUB` : null, calc.goodsCurrency === "EUR" || calc.transportCurrency === "EUR" ? `1 EUR = ${rate(r.EUR)} RUB` : null];
  const weight = sh.weightKg ? `${Number(sh.weightKg).toLocaleString("ru-RU")} кг` : "— кг";
  const volume = sh.volumeM3 ? `${Number(sh.volumeM3).toLocaleString("ru-RU")} куб. м` : "— куб. м";
  return {
    kp: {
      transport: TRANSPORT_KP[sh.transport ?? ""] ?? (sh.transport ? TRANSPORTS[sh.transport as keyof typeof TRANSPORTS] : "—"),
      route: [sh.pickupLocation, sh.deliveryLocation].filter(Boolean).join(" → ") || "—",
      cargo: `${weight} / ${volume}`,
      term: calc.deliveryTerm || "—",
      rates: `${dmy(calc.ratesDate)}: ${ratePairs.filter(Boolean).join(", ")}`,
      total: rubText(total),
      date: dmy(new Date().toISOString().slice(0, 10)),
    },
    lines: lines.map((l) => ({
      name: l.indent ? `    ${l.name}` : l.name,
      value: l.amount === null ? "" : `${l.approx ? "Прим.  " : ""}${rubText(l.amount)}`,
    })),
  };
}

/** DOCX КП. Свой шаблон — CRM_UPLOAD_DIR/templates/kp.docx. */
export async function renderKpDocx(sh: ShipmentRow, calc: ShipmentCalc, uploadDir: string): Promise<Buffer> {
  const custom = path.join(uploadDir, "templates", "kp.docx");
  const template = await fs.promises.readFile(fs.existsSync(custom) ? custom : KP_TEMPLATE);
  const out = await createReport({ template, data: kpTemplateData(sh, calc), cmdDelimiter: ["{{", "}}"], failFast: false, rejectNullish: false });
  return Buffer.from(out);
}
