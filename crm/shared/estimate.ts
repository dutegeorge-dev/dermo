/**
 * Раздел «Расчёт»: заявка клиента на его товар (не из нашего справочника) → стоимость с доставкой и растаможкой
 * → КП. Считается и в браузере (сразу при правке), и на сервере при сохранении — одна функция.
 *
 * Договор комиссии: товар и перевозку оплачиваем мы → комиссия за валютный перевод (4 %) — на товар + перевозку.
 * Договор ТЭУ: товар клиент оплачивает сам, мы — только фрахт → 4 % на фрахт, затем +6 % от общей суммы.
 * Комиссия компании — как везде, задаётся суммой; по ТЭУ 6 % начисляются и на неё.
 */

import { calcCustoms, type CustomsResult, dutyUnit, isWeightUnit } from "./customs.ts";
import { CONTAINERS, type ContainerType, FREIGHT_TRANSPORTS, type FreightRate } from "./quote.ts";

export const ESTIMATE_SCHEMES = { commission: "Договор комиссии", teu: "Договор ТЭУ" } as const;
export type EstimateScheme = keyof typeof ESTIMATE_SCHEMES;

export type EstimateItem = {
  name: string;
  hsCode: string | null;
  quantity: number | null;
  unit: string;
  /** Стоимость строки в валюте товара. */
  amount: number | null;
  vat10: boolean;
  /** Пошлина «за кг»: вес этого товара, кг (пусто — доля общего веса по стоимости). */
  dutyQty?: number | null;
  /** Код подобран ИИ — проверить. */
  hsAuto?: boolean;
};

export type EstimateExtra = { name: string; amount: number | null };

export type EstimateParams = {
  title: string;
  clientName: string;
  /** Производитель / продавец. */
  supplier: string;
  scheme: EstimateScheme;
  items: EstimateItem[];
  /** Валюта стоимости товара. */
  currency: string;
  incoterms: string;
  pickup: string;
  destination: string;
  /** Упаковка, размеры мест — текстом в КП. */
  packaging: string;
  places: number | null;
  weightKg: number | null;
  volumeM3: number | null;
  transportMode: "rate" | "manual";
  freightRateId: number | null;
  containers: number | null;
  transportAmount: number | null;
  transportCurrency: string;
  transportLabel: string;
  /** Комиссия за валютный перевод, %: по комиссии — от товара + перевозки, по ТЭУ — от фрахта. */
  fxPercent: number | null;
  /** ТЭУ: % от общей суммы. */
  teuPercent: number | null;
  broker: number | null;
  terminal: number | null;
  lastMile: number | null;
  /** Прочие расходы, ₽ (сертификация, маркировка…). */
  extras: EstimateExtra[];
  /** Комиссия компании, ₽. */
  commission: number | null;
  deliveryTerm: string;
  notes: string;
};

export const emptyEstimateItem = (): EstimateItem => ({ name: "", hsCode: null, quantity: null, unit: "шт", amount: null, vat10: false, dutyQty: null });

export const DEFAULT_ESTIMATE: EstimateParams = {
  title: "",
  clientName: "",
  supplier: "",
  scheme: "commission",
  items: [emptyEstimateItem()],
  currency: "USD",
  incoterms: "",
  pickup: "",
  destination: "",
  packaging: "",
  places: null,
  weightKg: null,
  volumeM3: null,
  transportMode: "manual",
  freightRateId: null,
  containers: null,
  transportAmount: null,
  transportCurrency: "USD",
  transportLabel: "",
  fxPercent: 4,
  teuPercent: 6,
  broker: 20000,
  terminal: null,
  lastMile: null,
  extras: [],
  commission: null,
  deliveryTerm: "",
  notes: "",
};

export type EstimateResult = {
  goods: number;
  goodsRub: number;
  transportRub: number;
  transportLabel: string;
  containers: number | null;
  chargeableCbm: number | null;
  /** База комиссии за перевод, ₽. */
  fxBase: number;
  fxRub: number;
  customs: CustomsResult;
  broker: number;
  terminal: number;
  lastMile: number;
  extras: number;
  /** Всё, кроме ТЭУ-процента и комиссии компании, ₽ (база ТЭУ — subtotal + commission). */
  subtotal: number;
  teuRub: number;
  commission: number;
  totalRub: number;
  warnings: string[];
};

const r2 = (n: number) => Math.round(n * 100) / 100;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

export function computeEstimate(p: EstimateParams, ctx: { rates: Record<string, number>; tariffs: Record<string, string>; freight: FreightRate | null }): EstimateResult {
  const warnings: string[] = [];
  const rub = (amount: number | null, currency: string) => {
    if (!amount) return 0;
    if (currency === "RUB") return amount;
    const rate = ctx.rates[currency];
    if (!rate) {
      warnings.push(`Нет курса ${currency}`);
      return 0;
    }
    return amount * rate;
  };
  const items = p.items.filter((i) => i.name.trim() || i.amount);
  if (!items.length) warnings.push("Добавьте товар");
  const goods = r2(items.reduce((s, i) => s + (i.amount ?? 0), 0));
  if (!goods) warnings.push("Не указана стоимость товара");
  const goodsRub = r2(rub(goods, p.currency));

  // Доставка: вручную или по ставке (контейнер / сборный груз).
  let transportRub = 0;
  let transportLabel = p.transportLabel;
  let containers: number | null = null;
  let chargeableCbm: number | null = null;
  if (p.transportMode === "manual") {
    transportRub = rub(p.transportAmount, p.transportCurrency);
    if (!p.transportAmount) warnings.push("Не указана стоимость доставки");
  } else if (!ctx.freight) {
    warnings.push("Выберите ставку доставки или впишите сумму вручную");
  } else {
    const f = ctx.freight;
    const kind = FREIGHT_TRANSPORTS[f.transport as keyof typeof FREIGHT_TRANSPORTS] ?? f.transport;
    if (f.mode === "container") {
      const cap = CONTAINERS[(f.container ?? "40HQ") as ContainerType] ?? CONTAINERS["40HQ"];
      const need = Math.max(p.volumeM3 ? p.volumeM3 / cap.m3 : 0, p.weightKg ? p.weightKg / cap.kg : 0);
      containers = p.containers || (need ? Math.max(1, Math.ceil(need - 1e-9)) : null);
      if (!containers) warnings.push("Не посчитать число контейнеров: укажите вес или объём");
      transportRub = rub((containers ?? 0) * f.rate, f.currency) + rub(f.fee, f.feeCurrency);
      transportLabel ||= `${kind} перевозка ${f.origin} — ${f.destination}, ${containers ?? "?"} × ${f.container ?? "конт."}`;
    } else {
      if (!p.volumeM3 && !p.weightKg) warnings.push("Для сборного груза нужен вес или объём");
      const byWeight = p.weightKg && f.kgPerCbm ? p.weightKg / f.kgPerCbm : 0;
      chargeableCbm = r3(Math.max(p.volumeM3 ?? 0, byWeight, f.minCbm ?? 0));
      transportRub = rub(chargeableCbm * f.rate, f.currency) + rub(f.fee, f.feeCurrency);
      transportLabel ||= `${kind} перевозка ${f.origin} — ${f.destination}, ${chargeableCbm.toLocaleString("ru-RU")} м³`;
    }
  }
  transportRub = r2(transportRub);
  transportLabel ||= [p.pickup, p.destination].filter(Boolean).length ? `Перевозка ${[p.pickup, p.destination].filter(Boolean).join(" — ")}` : "Перевозка";

  const customs = calcCustoms({
    items: items.map((i) => {
      const tariff = i.hsCode ? (ctx.tariffs[i.hsCode] ?? null) : null;
      // Единица пошлины закреплена за кодом: м², пары, шт — количество позиции; кг — вес позиции, если задан.
      const weightQty = isWeightUnit(dutyUnit(tariff)) && i.dutyQty ? (dutyUnit(tariff) === "т" ? i.dutyQty / 1000 : i.dutyQty) : null;
      return { productId: null, name: i.name || "Товар", hsCode: i.hsCode, tariff, vat10: i.vat10, quantity: i.quantity, unit: i.unit, amount: i.amount ?? 0, dutyQuantity: weightQty };
    }),
    goodsCurrency: p.currency,
    transportAmount: transportRub || null,
    transportCurrency: "RUB",
    weightKg: p.weightKg,
    rates: { RUB: 1, ...ctx.rates },
  });
  warnings.push(...customs.warnings.filter((w) => !/Не указана стоимость перевозки/.test(w)));

  const fxBase = p.scheme === "commission" ? goodsRub + transportRub : transportRub;
  const fxRub = p.fxPercent ? r2((fxBase * p.fxPercent) / 100) : 0;
  const broker = p.broker ?? 0;
  const terminal = p.terminal ?? 0;
  const lastMile = p.lastMile ?? 0;
  const extras = r2(p.extras.reduce((s, e) => s + (e.amount ?? 0), 0));
  const subtotal = r2(goodsRub + transportRub + fxRub + customs.duty + customs.vat + broker + terminal + lastMile + extras);
  const commission = p.commission ?? 0;
  // ТЭУ: 6 % от общей суммы — вместе с комиссией компании.
  const teuRub = p.scheme === "teu" && p.teuPercent ? r2(((subtotal + commission) * p.teuPercent) / 100) : 0;
  return {
    goods,
    goodsRub,
    transportRub,
    transportLabel,
    containers,
    chargeableCbm,
    fxBase: r2(fxBase),
    fxRub,
    customs,
    broker,
    terminal,
    lastMile,
    extras,
    subtotal,
    teuRub,
    commission,
    totalRub: r2(subtotal + teuRub + commission),
    warnings,
  };
}

const pct = (n: number | null) => (n ?? 0).toLocaleString("ru-RU");

/** Строки КП. По ТЭУ товар клиент оплачивает поставщику сам — строка с пометкой. */
export function estimateKpLines(p: EstimateParams, q: EstimateResult): { name: string; amount: number; approx?: boolean; indent?: boolean }[] {
  const lines: { name: string; amount: number; approx?: boolean; indent?: boolean }[] = [];
  let n = 0;
  lines.push({ name: `${++n}. Стоимость товара${p.scheme === "teu" ? " (оплачивается клиентом поставщику)" : ""}`, amount: q.goodsRub });
  lines.push({ name: `${++n}. ${q.transportLabel}`, amount: q.transportRub });
  if (q.fxRub) lines.push({ name: `${++n}. Комиссия за валютный перевод ${pct(p.fxPercent)}%${p.scheme === "teu" ? " (от фрахта)" : ""}`, amount: q.fxRub });
  const c = ++n;
  lines.push({ name: `${c}. Таможенные платежи`, amount: r2(q.customs.duty + q.customs.vat) });
  lines.push({ name: `${c}.1. Таможенная пошлина`, amount: q.customs.duty, indent: true });
  lines.push({ name: `${c}.2. НДС`, amount: q.customs.vat, indent: true });
  if (q.broker) lines.push({ name: `${++n}. Таможенное оформление`, amount: q.broker });
  if (q.terminal) lines.push({ name: `${++n}. Хранение на СВХ, досмотры`, amount: q.terminal });
  for (const e of p.extras) if (e.amount) lines.push({ name: `${++n}. ${e.name || "Прочие расходы"}`, amount: e.amount });
  if (q.teuRub) lines.push({ name: `${++n}. Транспортно-экспедиционное обслуживание ${pct(p.teuPercent)}%`, amount: q.teuRub });
  if (q.commission) lines.push({ name: `${++n}. Вознаграждение`, amount: q.commission });
  if (q.lastMile) lines.push({ name: "*Доставка до склада клиента", amount: q.lastMile, approx: true });
  return lines;
}

/** Рубли → доллары (или другая валюта) по курсу ЦБ расчёта; нет курса — null. */
export function fromRub(n: number, currency: string, rates: Record<string, number>): number | null {
  if (currency === "RUB") return n;
  return rates[currency] ? r2(n / rates[currency]) : null;
}

export type EstimateUnitCost = {
  name: string;
  quantity: number | null;
  unit: string;
  goodsRub: number;
  /** Доля доставки, таможни и остального, ₽. */
  costsRub: number;
  totalRub: number;
  /** За единицу: товар и всё вместе (с доставкой и растаможкой), ₽. */
  perUnitGoodsRub: number | null;
  perUnitRub: number | null;
};

/**
 * Себестоимость единицы для клиента: товар позиции + её доля всего остального (доставка, таможня, комиссии,
 * вознаграждение) пропорционально стоимости товара.
 */
export function estimateUnits(p: EstimateParams, q: EstimateResult, rates: Record<string, number>): EstimateUnitCost[] {
  const items = p.items.filter((i) => i.name.trim() || i.amount);
  const costs = q.totalRub - q.goodsRub;
  const goods = items.reduce((s, i) => s + (i.amount ?? 0), 0);
  const rate = p.currency === "RUB" ? 1 : (rates[p.currency] ?? 0);
  return items.map((i) => {
    const share = goods ? (i.amount ?? 0) / goods : 1 / items.length;
    const goodsRub = r2((i.amount ?? 0) * rate);
    const costsRub = r2(costs * share);
    const totalRub = r2(goodsRub + costsRub);
    return {
      name: i.name || "Товар",
      quantity: i.quantity,
      unit: i.unit,
      goodsRub,
      costsRub,
      totalRub,
      perUnitGoodsRub: i.quantity ? r2(goodsRub / i.quantity) : null,
      perUnitRub: i.quantity ? r2(totalRub / i.quantity) : null,
    };
  });
}

