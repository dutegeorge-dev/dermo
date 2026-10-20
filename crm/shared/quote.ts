/**
 * Расчёт цены товара для клиента (кнопка в карточке товара): цена фабрики × объём + доставка (по сохранённой
 * ставке или вручную) + комиссия за перевод + пошлина и НДС (по коду ТН ВЭД товара) + брокер, СВХ, доставка
 * до склада + маржа суммой на партию → итог и цена за единицу в рублях. Считается и в браузере (сразу при
 * правке), и на сервере при сохранении — одна функция.
 */

import { calcCustoms, type CustomsResult } from "./customs.ts";

/** Вместимость контейнеров для подсчёта, сколько их нужно (если фабрика не сказала, сколько входит в 40HQ). */
export const CONTAINERS = {
  "40HQ": { m3: 68, kg: 26000 },
  "40GP": { m3: 58, kg: 26000 },
  "20GP": { m3: 28, kg: 21000 },
} as const;
export type ContainerType = keyof typeof CONTAINERS;

export const FREIGHT_MODES = { container: "за контейнер", cbm: "за м³ (сборный груз)" } as const;
export type FreightMode = keyof typeof FREIGHT_MODES;

export const FREIGHT_TRANSPORTS = { rail: "ЖД", truck: "Авто", sea: "Море", multimodal: "Мультимодальная" } as const;

/** Ставка доставки (freight_rates). */
export type FreightRate = {
  id: number;
  carrierName: string;
  transport: string;
  mode: FreightMode;
  container: string | null;
  origin: string;
  destination: string;
  rate: number;
  currency: string;
  /** Сборный груз: сколько кг считается за 1 м³ (1 CBM = 500 кг) — платный объём = max(м³, кг / это). */
  kgPerCbm: number | null;
  /** Минимальный платный объём, м³. */
  minCbm: number | null;
  /** Разовый сбор за отправку (H/F & CUS за BL). */
  fee: number | null;
  feeCurrency: string;
  transitDays: number | null;
  etd: string;
  validUntil: string | null;
  quotedAt: string | null;
  notes: string;
};

export type QuoteParams = {
  offerId: number | null;
  /** Цена фабрики за единицу. */
  price: number | null;
  currency: string;
  unit: string;
  quantity: number | null;
  kgPerUnit: number | null;
  m3PerUnit: number | null;
  /** Вес и объём всей партии — задаёт пользователь; пусто — из «на единицу» × объём. */
  weightKg?: number | null;
  volumeM3?: number | null;
  /** Единиц в 40HQ (от фабрики) — для числа контейнеров. */
  perContainer: number | null;
  transportMode: "rate" | "manual";
  freightRateId: number | null;
  /** Сколько контейнеров (пусто — посчитать). */
  containers: number | null;
  /** Доставка вручную: сумма на партию. */
  transportAmount: number | null;
  transportCurrency: string;
  transportLabel: string;
  fxPercent: number | null;
  broker: number | null;
  terminal: number | null;
  lastMile: number | null;
  /** Маржа, ₽ на всю партию. */
  margin: number | null;
  /** В КП: маржа отдельной строкой «Вознаграждение» или внутри стоимости товара. */
  marginInKp: "line" | "goods";
  deliveryTerm: string;
  clientName: string;
};

export const DEFAULT_QUOTE: QuoteParams = {
  offerId: null,
  price: null,
  currency: "CNY",
  unit: "м²",
  quantity: null,
  kgPerUnit: null,
  m3PerUnit: null,
  weightKg: null,
  volumeM3: null,
  perContainer: null,
  transportMode: "rate",
  freightRateId: null,
  containers: null,
  transportAmount: null,
  transportCurrency: "USD",
  transportLabel: "",
  fxPercent: 2.25,
  broker: 20000,
  terminal: null,
  lastMile: null,
  margin: null,
  marginInKp: "line",
  deliveryTerm: "",
  clientName: "",
};

export type QuoteResult = {
  weightKg: number | null;
  volumeM3: number | null;
  containers: number | null;
  /** Платный объём сборного груза, м³. */
  chargeableCbm: number | null;
  goods: number;
  goodsRub: number;
  transportRub: number;
  transportLabel: string;
  fxRub: number;
  customs: CustomsResult;
  broker: number;
  terminal: number;
  lastMile: number;
  margin: number;
  /** Себестоимость партии (без маржи), ₽. */
  costRub: number;
  totalRub: number;
  perUnitRub: number | null;
  costPerUnitRub: number | null;
  warnings: string[];
};

const r2 = (n: number) => Math.round(n * 100) / 100;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** Сколько контейнеров: явно → по «единиц в 40HQ» → по объёму и весу. */
export function containersNeeded(p: Pick<QuoteParams, "quantity" | "perContainer" | "containers">, cargo: { weightKg: number | null; volumeM3: number | null }, type: string | null): number | null {
  if (p.containers) return p.containers;
  if (!p.quantity) return null;
  const cap = CONTAINERS[(type ?? "40HQ") as ContainerType] ?? CONTAINERS["40HQ"];
  if (p.perContainer && (type ?? "40HQ") === "40HQ") return Math.max(1, Math.ceil(p.quantity / p.perContainer - 1e-9));
  const byVolume = cargo.volumeM3 ? cargo.volumeM3 / cap.m3 : 0;
  const byWeight = cargo.weightKg ? cargo.weightKg / cap.kg : 0;
  const n = Math.max(byVolume, byWeight);
  return n ? Math.max(1, Math.ceil(n - 1e-9)) : null;
}

export function computeQuote(
  p: QuoteParams,
  ctx: { rates: Record<string, number>; hsCode: string | null; tariff: string | null; vat10: boolean; productName: string; freight: FreightRate | null },
): QuoteResult {
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
  const qty = p.quantity ?? 0;
  if (!qty) warnings.push("Укажите объём партии");
  if (p.price === null) warnings.push("Нет цены фабрики");
  const weightKg = p.weightKg || (p.kgPerUnit && qty ? r3(qty * p.kgPerUnit) : null);
  const volumeM3 = p.volumeM3 || (p.m3PerUnit && qty ? r3(qty * p.m3PerUnit) : null);
  const goods = r2((p.price ?? 0) * qty);
  const goodsRub = r2(rub(goods, p.currency));

  // Доставка.
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
      containers = containersNeeded(p, { weightKg, volumeM3 }, f.container);
      if (!containers) warnings.push("Не посчитать число контейнеров: нужен объём или вес единицы, или «сколько в 40HQ»");
      transportRub = rub((containers ?? 0) * f.rate, f.currency) + rub(f.fee, f.feeCurrency);
      transportLabel ||= `${kind} перевозка ${f.origin} — ${f.destination}, ${containers ?? "?"} × ${f.container ?? "конт."}`;
    } else {
      if (!volumeM3 && !weightKg) warnings.push("Для сборного груза нужен объём или вес единицы");
      const byWeight = weightKg && f.kgPerCbm ? weightKg / f.kgPerCbm : 0;
      chargeableCbm = r3(Math.max(volumeM3 ?? 0, byWeight, f.minCbm ?? 0));
      transportRub = rub(chargeableCbm * f.rate, f.currency) + rub(f.fee, f.feeCurrency);
      transportLabel ||= `${kind} перевозка ${f.origin} — ${f.destination}, ${chargeableCbm.toLocaleString("ru-RU")} м³`;
    }
  }
  transportRub = r2(transportRub);
  transportLabel ||= "Перевозка";

  const customs = calcCustoms({
    items: [{ productId: null, name: ctx.productName, hsCode: ctx.hsCode, tariff: ctx.tariff, vat10: ctx.vat10, quantity: qty || null, unit: p.unit, amount: goods }],
    goodsCurrency: p.currency,
    transportAmount: transportRub || null,
    transportCurrency: "RUB",
    weightKg,
    rates: ctx.rates,
  });
  warnings.push(...customs.warnings.filter((w) => !/Не указана стоимость перевозки/.test(w)));
  const fxRub = p.fxPercent ? r2(((goodsRub + transportRub) * p.fxPercent) / 100) : 0;
  const broker = p.broker ?? 0;
  const terminal = p.terminal ?? 0;
  const lastMile = p.lastMile ?? 0;
  const margin = p.margin ?? 0;
  const costRub = r2(goodsRub + transportRub + fxRub + customs.duty + customs.vat + broker + terminal + lastMile);
  const totalRub = r2(costRub + margin);
  return {
    weightKg,
    volumeM3,
    containers,
    chargeableCbm,
    goods,
    goodsRub,
    transportRub,
    transportLabel,
    fxRub,
    customs,
    broker,
    terminal,
    lastMile,
    margin,
    costRub,
    totalRub,
    perUnitRub: qty ? r2(totalRub / qty) : null,
    costPerUnitRub: qty ? r2(costRub / qty) : null,
    warnings,
  };
}

/** Строки КП для клиента. Маржа — отдельной строкой «Вознаграждение» или внутри стоимости товара. */
export function quoteKpLines(p: QuoteParams, q: QuoteResult): { name: string; amount: number; approx?: boolean; indent?: boolean }[] {
  const lines: { name: string; amount: number; approx?: boolean; indent?: boolean }[] = [];
  let n = 0;
  const qty = (p.quantity ?? 0).toLocaleString("ru-RU");
  lines.push({ name: `${++n}. Стоимость товара, ${qty} ${p.unit}`, amount: r2(q.goodsRub + (p.marginInKp === "goods" ? q.margin : 0)) });
  lines.push({ name: `${++n}. ${q.transportLabel}`, amount: q.transportRub });
  if (q.fxRub) lines.push({ name: `${++n}. Комиссия за валютный перевод ${(p.fxPercent ?? 0).toLocaleString("ru-RU")}%`, amount: q.fxRub });
  const c = ++n;
  lines.push({ name: `${c}. Таможенные платежи`, amount: r2(q.customs.duty + q.customs.vat) });
  lines.push({ name: `${c}.1. Таможенная пошлина${q.customs.lines[0]?.tariff ? ` ${q.customs.lines[0].tariff}` : ""}`, amount: q.customs.duty, indent: true });
  lines.push({ name: `${c}.2. НДС ${q.customs.lines[0]?.vatRate ?? 22}%`, amount: q.customs.vat, indent: true });
  if (q.broker) lines.push({ name: `${++n}. Таможенное оформление`, amount: q.broker });
  if (q.terminal) lines.push({ name: `${++n}. Хранение на СВХ, досмотры`, amount: q.terminal });
  if (q.margin && p.marginInKp === "line") lines.push({ name: `${++n}. Вознаграждение`, amount: q.margin });
  if (q.lastMile) lines.push({ name: "*Доставка от станции до склада клиента", amount: q.lastMile, approx: true });
  return lines;
}
