/** Раздел «Расчёт»: разбор полей, пересчёт на сервере, ИИ-разбор текста заявки, данные для КП. */

import type Anthropic from "@anthropic-ai/sdk";
import { eq } from "drizzle-orm";

import { CURRENCIES, formatMoney } from "../../shared/documents.ts";
import { computeEstimate, DEFAULT_ESTIMATE, DEFAULT_MARKUP, type EstimateMarkup, type EstimateParams, MARKUP_MODES, type MarkupMode, type EstimateResult, estimateKpLines, ESTIMATE_SCHEMES, estimateUnits, fromRub } from "../../shared/estimate.ts";
import { FREIGHT_TRANSPORTS, type FreightRate } from "../../shared/quote.ts";
import type { DbOrTx } from "../db/client.ts";
import { freightRates } from "../db/schema.ts";
import { addUsage, aiBase, aiClient, aiError, type AiUsage, usageOf } from "./ai.ts";
import { suggestHsCodes } from "./ai-parse.ts";
import { HttpError } from "./http.ts";
import { freightDto } from "./quotes.ts";
import { tnvedByCodes } from "./tnved.ts";

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
const hs = (v: unknown) => {
  const d = String(v ?? "").replace(/\D/g, "").slice(0, 10);
  return d.length >= 4 ? d : null;
};

/** Параметры расчёта из запроса (неизвестное — по умолчанию). */
export function estimateParams(input: unknown): EstimateParams {
  const p = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const D = DEFAULT_ESTIMATE;
  const items = (Array.isArray(p.items) ? p.items : [])
    .slice(0, 100)
    .map((raw) => {
      const i = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
      const breakdown = (Array.isArray(i.breakdown) ? i.breakdown : [])
        .slice(0, 30)
        .map((b: Record<string, unknown>) => ({ label: str(b?.label, 60), packages: num(b?.packages) }))
        .filter((b: { label: string }) => b.label);
      return {
        name: str(i.name, 500),
        hsCode: hs(i.hsCode),
        quantity: num(i.quantity),
        unit: str(i.unit, 30) || "шт",
        amount: num(i.amount),
        vat10: i.vat10 === true,
        dutyQty: num(i.dutyQty),
        hsAuto: i.hsAuto === true,
        variant: str(i.variant, 120),
        packages: num(i.packages),
        packageUnit: str(i.packageUnit, 20),
        breakdown,
        price: num(i.price),
      };
    })
    .filter((i) => i.name || i.amount);
  const extras = (Array.isArray(p.extras) ? p.extras : [])
    .slice(0, 30)
    .map((raw) => {
      const e = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
      return { name: str(e.name, 200), amount: num(e.amount) };
    })
    .filter((e) => e.name || e.amount);
  const opt = (v: unknown, d: number | null) => (v === undefined ? d : num(v));
  return {
    title: str(p.title, 300),
    clientName: str(p.clientName, 300),
    supplier: str(p.supplier, 300),
    scheme: String(p.scheme) in ESTIMATE_SCHEMES ? (String(p.scheme) as EstimateParams["scheme"]) : D.scheme,
    items,
    currency: cur(p.currency, D.currency),
    incoterms: str(p.incoterms, 100),
    pickup: str(p.pickup, 300),
    destination: str(p.destination, 300),
    packaging: str(p.packaging, 500),
    places: num(p.places),
    weightKg: num(p.weightKg),
    volumeM3: num(p.volumeM3),
    transportMode: p.transportMode === "rate" ? "rate" : "manual",
    freightRateId: typeof p.freightRateId === "number" && p.freightRateId > 0 ? p.freightRateId : null,
    containers: num(p.containers) === null ? null : Math.max(1, Math.round(num(p.containers)!)),
    transportAmount: num(p.transportAmount),
    transportCurrency: cur(p.transportCurrency, D.transportCurrency),
    transportLabel: str(p.transportLabel, 200),
    fxPercent: opt(p.fxPercent, D.fxPercent),
    teuPercent: opt(p.teuPercent, D.teuPercent),
    broker: opt(p.broker, D.broker),
    terminal: num(p.terminal),
    lastMile: num(p.lastMile),
    extras,
    commission: num(p.commission),
    deliveryTerm: str(p.deliveryTerm, 200),
    notes: str(p.notes, 3000),
    containerType: str(p.containerType, 40),
    markup: markupParams(p.markup),
  };
}

function markupParams(input: unknown): EstimateMarkup | null {
  if (!input || typeof input !== "object") return null;
  const m = input as Record<string, unknown>;
  return {
    currency: cur(m.currency, DEFAULT_MARKUP.currency),
    deliveryClient: num(m.deliveryClient),
    mode: String(m.mode) in MARKUP_MODES ? (String(m.mode) as MarkupMode) : "manual",
    goodsCash: num(m.goodsCash),
    targetUnitPrice: num(m.targetUnitPrice),
    targetUnitCurrency: cur(m.targetUnitCurrency, DEFAULT_MARKUP.targetUnitCurrency),
    margin: num(m.margin),
  };
}

/** Пересчёт на сервере: курсы — переданные (как видел пользователь), ставка и пошлины — из справочников. */
export async function serverEstimate(tx: DbOrTx, params: EstimateParams, rates: Record<string, number>) {
  const [row] = params.transportMode === "rate" && params.freightRateId ? await tx.select().from(freightRates).where(eq(freightRates.id, params.freightRateId)) : [];
  const freight = row ? freightDto(row) : null;
  const known = await tnvedByCodes(tx, params.items.map((i) => i.hsCode ?? ""));
  const tariffs = Object.fromEntries([...known.entries()].map(([code, t]) => [code, t.tariff]));
  return { freight, result: computeEstimate(params, { rates, tariffs, freight }) };
}

// ── КП (шаблон тот же, что у расчёта цены товара: templates/product_kp.docx) ──

const rubText = (n: number) => `${Math.round(n).toLocaleString("ru-RU").replace(/ /g, " ")} руб.`;
const dmy = (d: string) => d.split("-").reverse().join(".");
const rateText = (n: number) => n.toLocaleString("ru-RU", { maximumFractionDigits: 2 });

export function estimateKpData(params: EstimateParams, result: EstimateResult, freight: FreightRate | null, ratesDate: string, rates: Record<string, number>) {
  // Главные суммы — в рублях и долларах по курсу ЦБ расчёта.
  const both = (rubAmount: number) => {
    const usd = fromRub(rubAmount, "USD", rates);
    return `${rubText(rubAmount)}${usd !== null ? ` / ${formatMoney(usd, "USD")}` : ""}`;
  };
  const used = new Set(["USD", params.currency, freight?.currency, freight?.feeCurrency, params.transportMode === "manual" ? params.transportCurrency : null].filter((c): c is string => !!c && c !== "RUB"));
  const ratesList = [...used].map((c) => (rates[c] ? `1 ${c} = ${rateText(rates[c])} RUB` : null)).filter(Boolean).join(", ");
  const kind = freight ? (FREIGHT_TRANSPORTS[freight.transport as keyof typeof FREIGHT_TRANSPORTS] ?? freight.transport) : "";
  const items = params.items.filter((i) => i.name);
  const cargo = [
    params.places ? `${params.places} мест` : null,
    params.weightKg ? `${params.weightKg.toLocaleString("ru-RU")} кг` : null,
    params.volumeM3 ? `${params.volumeM3.toLocaleString("ru-RU")} куб. м` : null,
    result.containers ? `${result.containers} × ${freight?.container ?? "40HQ"}` : null,
    params.packaging || null,
  ]
    .filter(Boolean)
    .join(" / ");
  const route = [params.pickup || freight?.origin, params.destination || freight?.destination].filter(Boolean).join(" — ");
  return {
    kp: {
      product: [params.title || items.map((i) => i.name).join("; "), params.supplier ? `производитель ${params.supplier}` : null, params.incoterms ? `условия ${params.incoterms}` : null].filter(Boolean).join(", "),
      quantity: items.map((i) => `${i.quantity !== null ? `${i.quantity.toLocaleString("ru-RU")} ${i.unit}` : "—"}${items.length > 1 ? ` (${i.name})` : ""}`).join("; ") || "—",
      transport: params.transportMode === "manual" ? params.transportLabel || "по согласованию" : `${kind}${freight?.mode === "cbm" ? ", сборный груз" : ""}`,
      route: route || "—",
      cargo: cargo || "—",
      term: params.deliveryTerm || (freight?.transitDays ? `около ${freight.transitDays} дней после отправки` : "—"),
      rates: `${dmy(ratesDate)}: ${ratesList || "—"}`,
      total: both(result.totalRub),
      date: dmy(new Date().toISOString().slice(0, 10)),
    },
    lines: [
      ...estimateKpLines(params, result).map((l) => ({ name: l.indent ? `    ${l.name}` : l.name, value: `${l.approx ? "Прим.  " : ""}${rubText(l.amount)}` })),
      { name: "ТОВАР", value: both(result.goodsRub) },
      { name: "ДОСТАВКА (перевозка, таможенные платежи, услуги — всё, кроме товара)", value: both(result.totalRub - result.goodsRub) },
      { name: "СТОИМОСТЬ ПАРТИИ", value: both(result.totalRub) },
      // Стоимость единицы с доставкой и растаможкой — по каждой позиции с количеством.
      ...estimateUnits(params, result, rates)
        .filter((u) => u.perUnitRub !== null)
        .map((u) => ({ name: `СТОИМОСТЬ ЕДИНИЦЫ — 1 ${u.unit}${items.length > 1 ? ` (${u.name})` : ""}`, value: both(u.perUnitRub!) })),
    ],
  };
}

// ── ИИ: текст заявки → поля ──────────────────────────────────────────────

const STR = { type: "string" } as const;
const NUM = { type: ["number", "null"] } as const;

export const ESTIMATE_REQUEST_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "clientName", "supplier", "items", "currency", "incoterms", "pickup", "destination", "packaging", "places", "weightKg", "volumeM3", "containerType", "deliveryTerm", "notes"],
  properties: {
    title: STR,
    clientName: STR,
    supplier: STR,
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "variant", "hsCode", "hsGuess", "quantity", "unit", "price", "amount", "packages", "packageUnit", "breakdown"],
        properties: {
          name: STR,
          variant: STR,
          hsCode: STR,
          hsGuess: STR,
          quantity: NUM,
          unit: STR,
          price: NUM,
          amount: NUM,
          packages: NUM,
          packageUnit: STR,
          breakdown: { type: "array", items: { type: "object", additionalProperties: false, required: ["label", "packages"], properties: { label: STR, packages: NUM } } },
        },
      },
    },
    currency: STR,
    incoterms: STR,
    pickup: STR,
    destination: STR,
    packaging: STR,
    places: NUM,
    weightKg: NUM,
    volumeM3: NUM,
    containerType: STR,
    deliveryTerm: STR,
    notes: STR,
  },
} as const;

const REQUEST_PROMPT = `Ты переписываешь заявку клиента (текстом) или инвойс поставщика на доставку и растаможку товара из Китая в поля расчёта CRM компании ООО «ТЛК БАРС». Только то, что написано в заявке, ничего не придумывай; нет значения — пустая строка (у чисел — null).
- title — короткое название груза по-русски («Рекламный призматрон Tri-Vision»).
- clientName — клиент, если назван; supplier — производитель / продавец («SHENZHEN DEMO TECH CO., LTD.»).
- items — товары по одному: name — коротко по-русски, hsCode — код ТН ВЭД, если указан в заявке (только цифры); hsGuess — твой код ТН ВЭД ЕАЭС для этого товара как можно точнее (минимум 4 цифры, лучше 10), даже если в заявке код есть; quantity и unit (шт, м², кг, компл.), amount — стоимость строки в валюте заявки. Одна общая стоимость партии на один товар — его amount; если количество не указано, а товар один — quantity 1, unit «шт».
- Инвойс / проформа поставщика (таблица позиций): каждая строка таблицы — отдельный item. name — товар по-русски, одинаковый у строк одного товара («Покрытие ПВХ»); variant — чем строка отличается: размер / модель («0,5 × 25 м», «2 × 20 м»); quantity и unit — в единице цены (м², шт, кг); price — цена за единицу; amount — сумма строки; packages — мест в строке (рулонов, коробок; колонка Total / Всего), packageUnit — вид мест по-русски («рул.», «кор.»); breakdown — разбивка мест строки по цветам / моделям из колонок таблицы (label — по-русски, как в шапке колонки, «Серый»; packages — число), если колонок разбивки нет — пустой массив. Строки «Sub-Total» / «TOTAL» не переписывай. weightKg — общий вес (Weight / Gross), если есть; containerType — контейнер, если указан («20FT», «40HQ»); supplier — продавец (THE SELLER). Наша компания (BARS TRADING, ТЛК БАРС) — покупатель, не supplier.
- У заявки текстом variant, price, packages, packageUnit — пустые, breakdown — пустой массив; containerType — если назван.
- currency — валюта стоимости (USD, CNY, EUR, RUB; RMB, ￥, 元 — CNY). Если у цен валюта не подписана — возьми её из условий оплаты / сумм в тексте документа («45000 CNY» → CNY); USD — только если доллары указаны явно.
- clientName — наш клиент; ООО «ТЛК БАРС» / BARS TRADING CO., LTD — это мы (покупатель в инвойсе), не клиент.
- incoterms — условия поставки кратко («EXW Dongguan»).
- pickup — место забора («Dongguan, Guangdong, Китай»), destination — пункт назначения («Москва»).
- packaging — упаковка и размеры мест текстом («фанерный ящик 310 × 100 × 86 см»); places — число мест (если упаковка одна — 1); weightKg — вес брутто, кг; volumeM3 — объём, м³ (если указаны только размеры — посчитай: см × см × см / 1 000 000 на место × число мест, округли до 0,01).
- deliveryTerm — желаемый срок, если есть.
- notes — важные оговорки одной-двумя строками по-русски (что уточнить, что проверить: код ТН ВЭД «проверить», адрес уточнят, перевозится разобранным…).`;

export async function parseEstimateRequest(tx: DbOrTx, text: string, files: Anthropic.Beta.BetaContentBlockParam[] = []): Promise<{ params: Partial<EstimateParams>; usage: AiUsage }> {
  if (!text.trim() && !files.length) throw new HttpError(400, "Вставьте текст заявки или загрузите инвойс");
  const content: Anthropic.Beta.BetaContentBlockParam[] = [...files];
  if (text.trim()) content.push({ type: "text", text: text.slice(0, 20000) });
  let response: Anthropic.Beta.BetaMessage;
  try {
    response = await aiClient().beta.messages.create({
      ...aiBase(),
      max_tokens: 8000,
      thinking: { type: "disabled" },
      output_config: { effort: "low", format: { type: "json_schema", schema: ESTIMATE_REQUEST_SCHEMA as unknown as Record<string, unknown> } },
      system: REQUEST_PROMPT,
      messages: [{ role: "user", content }],
    });
  } catch (error) {
    throw aiError(error);
  }
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join(""));
  } catch {
    throw new HttpError(502, "ИИ вернул неразборчивый ответ — попробуйте ещё раз");
  }
  // Только заполненное — остальное (ставки, проценты, брокер) остаётся как в форме.
  const parsed = estimateParams(raw);
  // Мы (покупатель в инвойсе) — не клиент.
  if (/bars\s*trading|тлк\s*барс|bars\s*logistics/i.test(parsed.clientName)) parsed.clientName = "";
  const out: Partial<EstimateParams> = {};
  for (const k of ["title", "clientName", "supplier", "incoterms", "pickup", "destination", "packaging", "deliveryTerm", "notes", "containerType"] as const) if (parsed[k]) out[k] = parsed[k];
  for (const k of ["places", "weightKg", "volumeM3"] as const) if (parsed[k] !== null) out[k] = parsed[k];
  let usage = usageOf(response);
  if (parsed.items.length) {
    // Код ТН ВЭД: указанный в заявке (если он есть в справочнике), иначе подбираем сами — как в документах.
    const rawItems = (Array.isArray(raw.items) ? raw.items : []).filter((i: { name?: string; amount?: unknown }) => i && (i.name || i.amount));
    const hsGuesses = rawItems.map((i: { hsGuess?: unknown }) => (typeof i.hsGuess === "string" ? i.hsGuess.replace(/\D/g, "") || null : null));
    const extra = await suggestHsCodes(tx, { items: parsed.items, hsGuesses });
    if (extra) usage = addUsage(usage, extra);
    out.items = parsed.items;
  }
  if (typeof raw.currency === "string" && (CURRENCIES as readonly string[]).includes(raw.currency.toUpperCase())) out.currency = parsed.currency;
  // Модель любит «USD» по умолчанию: в документе только юани, а долларов нет — значит юани.
  const source = content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n");
  if (out.currency === "USD" && /\b(CNY|RMB)\b|[￥¥元]/i.test(source) && !/\bUSD\b|US\s?\$|\$\s?\d/i.test(source)) out.currency = "CNY";
  return { params: out, usage };
}

/** «Подобрать» у товара: название → код ТН ВЭД (догадка модели → кандидаты справочника → выбор). */
export async function suggestEstimateHs(tx: DbOrTx, name: string): Promise<{ hsCode: string | null; usage: AiUsage | null }> {
  if (!name.trim()) throw new HttpError(400, "Впишите название товара");
  let response: Anthropic.Beta.BetaMessage;
  try {
    response = await aiClient().beta.messages.create({
      ...aiBase(),
      max_tokens: 300,
      thinking: { type: "disabled" },
      output_config: { effort: "low", format: { type: "json_schema", schema: { type: "object", additionalProperties: false, required: ["hsGuess"], properties: { hsGuess: STR } } } },
      system: "Ты таможенный декларант ЕАЭС. Назови код ТН ВЭД ЕАЭС для товара как можно точнее (10 цифр, минимум 4).",
      messages: [{ role: "user", content: name.slice(0, 1000) }],
    });
  } catch (error) {
    throw aiError(error);
  }
  let guess: string | null = null;
  try {
    guess = String(JSON.parse(response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("")).hsGuess ?? "").replace(/\D/g, "") || null;
  } catch {
    // без догадки — кода нет
  }
  const item: { name: string; hsCode: string | null; hsAuto?: boolean } = { name, hsCode: null };
  const extra = await suggestHsCodes(tx, { items: [item], hsGuesses: [guess] });
  return { hsCode: item.hsCode, usage: extra ? addUsage(usageOf(response), extra) : usageOf(response) };
}
