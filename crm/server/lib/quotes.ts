/** Ставки доставки и расчёт цены товара для клиента: разбор полей, пересчёт на сервере, КП в Word. */

import fs from "node:fs";
import path from "node:path";

import { createReport } from "docx-templates";
import { eq } from "drizzle-orm";

import { CURRENCIES } from "../../shared/documents.ts";
import { computeQuote, CONTAINERS, DEFAULT_QUOTE, FREIGHT_MODES, FREIGHT_TRANSPORTS, type FreightRate, type QuoteParams, type QuoteResult, quoteKpLines } from "../../shared/quote.ts";
import { CRM_ROOT } from "../config.ts";
import type { DbOrTx } from "../db/client.ts";
import { freightRates, products } from "../db/schema.ts";
import { HttpError } from "./http.ts";
import { tnvedByCodes } from "./tnved.ts";

export const PRODUCT_KP_TEMPLATE = path.join(CRM_ROOT, "templates", "product_kp.docx");

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? n : null;
};
const cur = (v: unknown, fallback: string) => {
  const c = String(v ?? "").toUpperCase();
  return (CURRENCIES as readonly string[]).includes(c) ? c : fallback;
};
const dateStr = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

/** Поля ставки доставки из запроса. */
export function freightValues(input: Record<string, unknown>): Omit<typeof freightRates.$inferInsert, "id" | "createdBy" | "createdAt" | "updatedAt"> {
  const rate = num(input.rate);
  if (rate === null) throw new HttpError(400, "Укажите ставку");
  const mode = String(input.mode) in FREIGHT_MODES ? String(input.mode) : "container";
  const container = mode === "container" ? (String(input.container ?? "40HQ") in CONTAINERS ? String(input.container ?? "40HQ") : "40HQ") : null;
  const opt = (v: unknown) => {
    const n = num(v);
    return n === null ? null : String(n);
  };
  return {
    carrierName: str(input.carrierName, 200),
    transport: String(input.transport) in FREIGHT_TRANSPORTS ? String(input.transport) : "rail",
    mode,
    container,
    origin: str(input.origin, 200),
    destination: str(input.destination, 200),
    rate: String(rate),
    currency: cur(input.currency, "USD"),
    kgPerCbm: mode === "cbm" ? opt(input.kgPerCbm) : null,
    minCbm: mode === "cbm" ? opt(input.minCbm) : null,
    fee: opt(input.fee),
    feeCurrency: cur(input.feeCurrency, cur(input.currency, "USD")),
    transitDays: num(input.transitDays) === null ? null : Math.round(num(input.transitDays)!),
    etd: str(input.etd, 200),
    validUntil: dateStr(input.validUntil),
    quotedAt: dateStr(input.quotedAt),
    notes: str(input.notes, 2000),
  };
}

type FreightRow = typeof freightRates.$inferSelect;
export const freightDto = (r: FreightRow): FreightRate => ({
  id: r.id,
  carrierName: r.carrierName,
  transport: r.transport,
  mode: r.mode as FreightRate["mode"],
  container: r.container,
  origin: r.origin,
  destination: r.destination,
  rate: Number(r.rate),
  currency: r.currency,
  kgPerCbm: r.kgPerCbm === null ? null : Number(r.kgPerCbm),
  minCbm: r.minCbm === null ? null : Number(r.minCbm),
  fee: r.fee === null ? null : Number(r.fee),
  feeCurrency: r.feeCurrency,
  transitDays: r.transitDays,
  etd: r.etd,
  validUntil: r.validUntil,
  quotedAt: r.quotedAt,
  notes: r.notes,
});

/** Параметры расчёта из запроса (неизвестное — по умолчанию). */
export function quoteParams(input: unknown): QuoteParams {
  const p = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  return {
    offerId: typeof p.offerId === "number" && p.offerId > 0 ? p.offerId : null,
    price: num(p.price),
    currency: cur(p.currency, "CNY"),
    unit: str(p.unit, 30) || DEFAULT_QUOTE.unit,
    quantity: num(p.quantity),
    kgPerUnit: num(p.kgPerUnit),
    m3PerUnit: num(p.m3PerUnit),
    perContainer: num(p.perContainer),
    transportMode: p.transportMode === "manual" ? "manual" : "rate",
    freightRateId: typeof p.freightRateId === "number" && p.freightRateId > 0 ? p.freightRateId : null,
    containers: num(p.containers) === null ? null : Math.max(1, Math.round(num(p.containers)!)),
    transportAmount: num(p.transportAmount),
    transportCurrency: cur(p.transportCurrency, "USD"),
    transportLabel: str(p.transportLabel, 200),
    fxPercent: num(p.fxPercent),
    broker: num(p.broker),
    terminal: num(p.terminal),
    lastMile: num(p.lastMile),
    margin: num(p.margin),
    marginInKp: p.marginInKp === "goods" ? "goods" : "line",
    deliveryTerm: str(p.deliveryTerm, 200),
    clientName: str(p.clientName, 300),
  };
}

/** Пересчёт на сервере: курсы — переданные (как видел пользователь), ставка — из справочника. */
export async function serverQuote(tx: DbOrTx, productId: number, params: QuoteParams, rates: Record<string, number>) {
  const [product] = await tx.select().from(products).where(eq(products.id, productId));
  if (!product) throw new HttpError(404, "Товар не найден");
  const [row] = params.transportMode === "rate" && params.freightRateId ? await tx.select().from(freightRates).where(eq(freightRates.id, params.freightRateId)) : [];
  const freight = row ? freightDto(row) : null;
  const tariff = product.hsCode ? ((await tnvedByCodes(tx, [product.hsCode])).get(product.hsCode)?.tariff ?? null) : null;
  const result = computeQuote(params, { rates, hsCode: product.hsCode, tariff, vat10: product.vat10, productName: product.nameRu || product.name, freight });
  return { product, freight, result };
}

// ── КП ────────────────────────────────────────────────────────────────────

const rubText = (n: number) => `${Math.round(n).toLocaleString("ru-RU").replace(/ /g, " ")} руб.`;
const dmy = (d: string) => d.split("-").reverse().join(".");
const rate = (n: number) => n.toLocaleString("ru-RU", { maximumFractionDigits: 2 });

export function quoteKpData(productName: string, params: QuoteParams, result: QuoteResult, freight: FreightRate | null, ratesDate: string, rates: Record<string, number>) {
  const used = new Set([params.currency, freight?.currency, freight?.feeCurrency, params.transportMode === "manual" ? params.transportCurrency : null].filter((c): c is string => !!c && c !== "RUB"));
  const ratesText = [...used].map((c) => (rates[c] ? `1 ${c} = ${rate(rates[c])} RUB` : null)).filter(Boolean).join(", ");
  const kind = freight ? (FREIGHT_TRANSPORTS[freight.transport as keyof typeof FREIGHT_TRANSPORTS] ?? freight.transport) : "";
  const cargo = [result.weightKg ? `${result.weightKg.toLocaleString("ru-RU")} кг` : null, result.volumeM3 ? `${result.volumeM3.toLocaleString("ru-RU")} куб. м` : null, result.containers ? `${result.containers} × ${freight?.container ?? "40HQ"}` : null].filter(Boolean).join(" / ");
  const qty = (params.quantity ?? 0).toLocaleString("ru-RU");
  return {
    kp: {
      product: productName,
      quantity: `${qty} ${params.unit}`,
      transport: params.transportMode === "manual" ? params.transportLabel || "по согласованию" : `${kind}${freight?.mode === "cbm" ? ", сборный груз" : ""}`,
      route: freight ? `${freight.origin} — ${freight.destination}` : "—",
      cargo: cargo || "—",
      term: params.deliveryTerm || (freight?.transitDays ? `около ${freight.transitDays} дней после отправки` : "—"),
      rates: `${dmy(ratesDate)}: ${ratesText || "—"}`,
      total: `${rubText(result.totalRub)}${result.perUnitRub !== null ? ` (${result.perUnitRub.toLocaleString("ru-RU", { maximumFractionDigits: 2 })} руб. за ${params.unit})` : ""}`,
      date: dmy(new Date().toISOString().slice(0, 10)),
    },
    lines: quoteKpLines(params, result).map((l) => ({ name: l.indent ? `    ${l.name}` : l.name, value: `${l.approx ? "Прим.  " : ""}${rubText(l.amount)}` })),
  };
}

export async function renderQuoteKp(data: ReturnType<typeof quoteKpData>, uploadDir: string): Promise<Buffer> {
  const custom = path.join(uploadDir, "templates", "product_kp.docx");
  const template = await fs.promises.readFile(fs.existsSync(custom) ? custom : PRODUCT_KP_TEMPLATE);
  const out = await createReport({ template, data, cmdDelimiter: ["{{", "}}"], failFast: false, rejectNullish: false });
  return Buffer.from(out);
}
