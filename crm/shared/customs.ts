/**
 * Расчёт для клиента (КП и поручение) и таможенных платежей — общий код сервера и интерфейса.
 *
 * Таможенная стоимость = стоимость товара + ½ стоимости доставки (в рублях по курсу ЦБ).
 * Пошлина — по ставке ТН ВЭД каждого товара: процент от таможенной стоимости, «€ за кг / м² / шт…»,
 * «%, но не менее …» (берём большее) или «% плюс …». НДС = (таможенная стоимость + пошлина) × 22 %
 * (10 % — у товаров с галочкой). Вес для ставок «за кг» — вес сделки, поделённый между товарами
 * пропорционально стоимости.
 */

/** Ставка ЕТТ ЕАЭС, разобранная из текста «6.5%, но не менее 0.096 EUR за 1 кг». */
export type Tariff = {
  /** Адвалорная часть, %. */
  percent: number | null;
  /** Специфическая часть: amount валюты за per единиц unit. */
  specific: { amount: number; currency: string; per: number; unit: string } | null;
  /** Как сложить части: большее из двух («но не менее») или сумма («плюс»). */
  mode: "max" | "plus" | null;
};

export function parseTariff(text: string | null | undefined): Tariff | null {
  const t = (text ?? "").replace(/,/g, ".").replace(/\s+/g, " ").trim();
  if (!t) return null;
  const pct = /^(\d+(?:\.\d+)?)\s*%/.exec(t);
  const spec = /(\d+(?:\.\d+)?)\s*(EUR|USD)\s*за\s*(\d+(?:\.\d+)?)?\s*(?:(\d+)\s+)?(кг|т|л|м2|м3|шт|пар|см3, мл|см3)/i.exec(t);
  const specific = spec
    ? { amount: Number(spec[1]), currency: spec[2].toUpperCase(), per: Number(spec[3] ?? 1) * Number(spec[4] ?? 1), unit: spec[5].toLowerCase().replace("см3, мл", "см3") }
    : null;
  const percent = pct ? Number(pct[1]) : null;
  if (percent === null && !specific) return null;
  return { percent, specific, mode: percent !== null && specific ? (/плюс/i.test(t) ? "plus" : "max") : null };
}

/** Строка сметы КП / поручения. */
export type CalcParams = {
  /** Как назвать перевозку в КП: «ЖД перевозка 1 куб. м». */
  transportLabel: string;
  transportAmount: number | null;
  transportCurrency: string;
  /** Комиссия за валютный перевод, % от (стоимость товара + перевозка). */
  fxPercent: number | null;
  /** Таможенное оформление (брокер), ₽. */
  broker: number | null;
  /** Хранение на СВХ, досмотры, ₽. */
  terminal: number | null;
  /** Наше вознаграждение, ₽. */
  commission: number | null;
  /** Доставка от станции до склада клиента, ₽ (примерно). */
  lastMile: number | null;
  /** Срок доставки — текстом в КП. */
  deliveryTerm: string;
};

export const DEFAULT_CALC_PARAMS: CalcParams = {
  transportLabel: "",
  transportAmount: null,
  transportCurrency: "RUB",
  fxPercent: 4,
  broker: 20000,
  terminal: null,
  commission: null,
  lastMile: null,
  deliveryTerm: "",
};

export type CustomsLine = {
  productId: number | null;
  name: string;
  hsCode: string | null;
  /** Ставка как в ЕТТ: «6.5%, но не менее 0.096 EUR за 1 кг». */
  tariff: string | null;
  goodsRub: number;
  customsValue: number;
  duty: number;
  vatRate: number;
  vat: number;
  /** Что не так: нет кода, нет веса для ставки «за кг»… */
  note: string | null;
};

export type CustomsResult = {
  customsValue: number;
  duty: number;
  vat: number;
  lines: CustomsLine[];
  warnings: string[];
};

/** Сохранённый расчёт сделки (shipments.calc). */
export type ShipmentCalc = CalcParams & {
  /** Дата курсов ЦБ, по которым посчитано. */
  ratesDate: string;
  /** Рублей за 1 единицу валюты. */
  rates: Record<string, number>;
  goodsCurrency: string;
  goodsAmount: number;
  customs: CustomsResult;
  calculatedAt: string;
};

export type CalcItem = {
  productId: number | null;
  name: string;
  hsCode: string | null;
  tariff: string | null;
  vat10: boolean;
  quantity: number | null;
  unit: string | null;
  /** Сумма строки в валюте товара. */
  amount: number;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

export function toRub(amount: number | null | undefined, currency: string, rates: Record<string, number>): number {
  if (!amount) return 0;
  if (currency === "RUB") return amount;
  const r = rates[currency];
  if (!r) throw new Error(`Нет курса ${currency}`);
  return amount * r;
}

/** Количество в единице специфической ставки: кг — доля веса сделки; м², шт, пар, л — из позиции. */
function quantityIn(unit: string, item: CalcItem, weightShare: number | null): number | null {
  const u = (item.unit ?? "").toLowerCase().replace(/\s|\./g, "");
  if (unit === "кг") return weightShare;
  if (unit === "т") return weightShare === null ? null : weightShare / 1000;
  if (unit === "м2") return /^(м2|м²|кв\.?м|sqm|m2)$/.test(u) ? item.quantity : null;
  if (unit === "шт") return /^(шт|pcs|pc)$/.test(u) ? item.quantity : null;
  if (unit === "пар") return /^(пар|пара|pairs?)$/.test(u) ? item.quantity : null;
  if (unit === "л") return /^(л|l)$/.test(u) ? item.quantity : null;
  return null;
}

export function calcCustoms(input: {
  items: CalcItem[];
  goodsCurrency: string;
  transportAmount: number | null;
  transportCurrency: string;
  weightKg: number | null;
  rates: Record<string, number>;
}): CustomsResult {
  const { items, rates } = input;
  const warnings: string[] = [];
  const goodsTotal = items.reduce((s, i) => s + i.amount, 0);
  const transportRub = toRub(input.transportAmount, input.transportCurrency, rates);
  if (!input.transportAmount) warnings.push("Не указана стоимость перевозки — таможенная стоимость посчитана без доставки");
  const lines: CustomsLine[] = items.map((item) => {
    const share = goodsTotal ? item.amount / goodsTotal : 0;
    const goodsRub = toRub(item.amount, input.goodsCurrency, rates);
    const customsValue = goodsRub + (transportRub * share) / 2;
    const tariff = parseTariff(item.tariff);
    let duty = 0;
    let note: string | null = null;
    if (!item.hsCode) note = "нет кода ТН ВЭД — пошлина 0";
    else if (!tariff) note = item.tariff ? `не разобрана ставка «${item.tariff}»` : "кода нет в справочнике ТН ВЭД — пошлина 0";
    else {
      const adv = tariff.percent !== null ? (customsValue * tariff.percent) / 100 : 0;
      let spec = 0;
      if (tariff.specific) {
        const qty = quantityIn(tariff.specific.unit, item, input.weightKg ? input.weightKg * share : null);
        if (qty === null) {
          note = tariff.specific.unit === "кг" ? "нет веса сделки — специфическая часть не посчитана" : `нужно количество в «${tariff.specific.unit}» — специфическая часть не посчитана`;
        } else {
          spec = (qty / tariff.specific.per) * tariff.specific.amount * (rates[tariff.specific.currency] ?? 0);
        }
      }
      duty = tariff.mode === "plus" ? adv + spec : Math.max(adv, spec);
    }
    const vatRate = item.vat10 ? 10 : 22;
    const vat = ((customsValue + duty) * vatRate) / 100;
    return {
      productId: item.productId,
      name: item.name,
      hsCode: item.hsCode,
      tariff: item.tariff,
      goodsRub: round2(goodsRub),
      customsValue: round2(customsValue),
      duty: round2(duty),
      vatRate,
      vat: round2(vat),
      note,
    };
  });
  for (const l of lines) if (l.note) warnings.push(`${l.name}: ${l.note}`);
  return {
    customsValue: round2(lines.reduce((s, l) => s + l.customsValue, 0)),
    duty: round2(lines.reduce((s, l) => s + l.duty, 0)),
    vat: round2(lines.reduce((s, l) => s + l.vat, 0)),
    lines,
    warnings,
  };
}

/** Статьи КП в рублях: [название, сумма, «примерно»]. Итог — без стоимости товара. */
export function kpLines(calc: ShipmentCalc): { lines: { name: string; amount: number | null; approx?: boolean; indent?: boolean }[]; total: number; goodsRub: number } {
  const rub = (a: number | null, c: string) => (a === null ? null : round2(toRub(a, c, calc.rates)));
  const goodsRub = round2(toRub(calc.goodsAmount, calc.goodsCurrency, calc.rates));
  const transport = rub(calc.transportAmount, calc.transportCurrency);
  const fx = calc.fxPercent ? round2(((goodsRub + (transport ?? 0)) * calc.fxPercent) / 100) : null;
  const dutyRates = [...new Set(calc.customs.lines.map((l) => l.tariff ?? "—"))];
  const vatRates = [...new Set(calc.customs.lines.map((l) => l.vatRate))];
  const lines: { name: string; amount: number | null; approx?: boolean; indent?: boolean }[] = [];
  let n = 0;
  lines.push({ name: `${++n}. Стоимость товара`, amount: goodsRub });
  lines.push({ name: `${++n}. ${calc.transportLabel || "Перевозка"}`, amount: transport });
  if (fx) lines.push({ name: `${++n}. Комиссия за валютный перевод ${calc.fxPercent}%`, amount: fx });
  const c = ++n;
  lines.push({ name: `${c}. *Таможенные платежи, в т. ч.`, amount: null });
  lines.push({ name: `${c}.1. Таможенная пошлина${dutyRates.length === 1 ? ` ${dutyRates[0]}` : ""}`, amount: calc.customs.duty, indent: true });
  lines.push({ name: `${c}.2. НДС ${vatRates.length === 1 ? `${vatRates[0]}%` : "22% / 10%"}`, amount: calc.customs.vat, indent: true });
  if (calc.broker) lines.push({ name: `${++n}. Таможенное оформление`, amount: calc.broker });
  if (calc.terminal) lines.push({ name: `${++n}. Хранение на СВХ, досмотры`, amount: calc.terminal });
  if (calc.commission) lines.push({ name: `${++n}. Комиссия транспортной компании`, amount: calc.commission });
  if (calc.lastMile) lines.push({ name: "*Доставка от станции до склада клиента", amount: calc.lastMile, approx: true });
  const total = round2([transport, fx, calc.customs.duty, calc.customs.vat, calc.broker, calc.terminal, calc.commission, calc.lastMile].reduce<number>((s, v) => s + (v ?? 0), 0));
  return { lines, total, goodsRub };
}
