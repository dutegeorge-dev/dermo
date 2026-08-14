/**
 * Калькулятор сборной доставки и таможенных платежей — единый источник правды.
 *
 * Модуль намеренно не зависит ни от чего: его импортируют оба конца проекта —
 * бэкенд (пересчитывает заявку с калькулятора перед отправкой в CRM) и
 * 11ty-данные `src/_data/calculator.ts` (отдают конфиг в вёрстку, а оттуда —
 * клиентскому скрипту). Тарифы и ставки живут здесь в одном экземпляре: правка
 * в этом файле меняет и то, что видит посетитель, и то, что уходит менеджеру.
 *
 * Что считаем (расчёт предварительный, не оферта):
 *   • доставка — по расчётному объёму: max(объём; вес / 300), лимит 300 кг/куб;
 *   • пошлина — процент от стоимости товара;
 *   • НДС — процент от стоимости товара ВМЕСТЕ с пошлиной (как на таможне).
 */

/** Способ доставки со своим тарифом за кубометр. */
export interface DeliveryMethod {
  /** Идентификатор, уходящий в заявку. */
  id: string;
  /** Подпись в интерфейсе. */
  label: string;
  /** Тариф, $ за 1 куб.м. */
  rate: number;
  /** Ориентировочный срок в пути. */
  time: string;
  /** Иконка (partials/icon.njk). */
  icon: string;
}

/** Вариант ставки НДС в селекте. */
export interface VatOption {
  value: number;
  label: string;
}

/**
 * Конфигурация калькулятора.
 *
 * Города: тариф пока единый для всех направлений, список нужен, чтобы город
 * попадал в заявку. Появятся тарифы по городам — добавьте цену в элемент
 * списка и учтите её в `computeDelivery`.
 *
 * Ставки НДС: с 01.01.2026 базовая ставка в РФ — 22 % (ФЗ от 28.11.2025
 * № 425-ФЗ), льготные — 10 % и 0 %. Конкретная ставка зависит от кода ТН ВЭД,
 * поэтому в интерфейсе это выбор, а не константа.
 */
export const CALC_CONFIG = {
  /** Города назначения (тариф единый — см. комментарий выше). */
  cities: [
    "Москва",
    "Санкт-Петербург",
    "Екатеринбург",
    "Новосибирск",
    "Казань",
    "Благовещенск",
  ] as string[],

  /** Способы доставки сборного груза и их тарифы. */
  methods: [
    { id: "zhd", label: "Железная дорога", rate: 310, time: "20–30 дней", icon: "train-front" },
    { id: "avto", label: "Автодоставка", rate: 480, time: "8–14 дней", icon: "truck" },
  ] as DeliveryMethod[],

  /** Лимит веса на кубометр: тяжёлый груз тарифицируется по весу. */
  weightPerCbm: 300,

  /** До какого объёма расчёт считается применимым (дальше — только менеджер). */
  maxVolume: 8,

  /** Заявленная погрешность расчёта, %. */
  accuracy: "10–15 %",

  /** Варианты ставки НДС (подписи короткие — это селект). Первый — по умолчанию. */
  vatRates: [
    { value: 22, label: "22 % — базовая" },
    { value: 10, label: "10 % — льготная" },
    { value: 0, label: "0 % — освобождение" },
  ] as VatOption[],

  /** Ограничения ввода (валидация на клиенте и на бэкенде). */
  limits: {
    maxItems: 20,
    maxWeight: 1_000_000,
    maxVolume: 10_000,
    maxPrice: 1_000_000_000,
    maxNameLength: 200,
  },
} as const;

/** Товар, как его ввёл пользователь. */
export interface CalcItemInput {
  name: string;
  /** Стоимость товара, юани. */
  priceCny: number;
  /** Ставка пошлины, %. */
  dutyRate: number;
  /** Ставка НДС, %. */
  vatRate: number;
}

/** Товар после расчёта платежей. */
export interface CalcItemResult extends CalcItemInput {
  /** Стоимость товара в долларах (через кросс-курс ЦБ). */
  priceUsd: number;
  /** Сумма пошлины, $. */
  duty: number;
  /** Сумма НДС, $. */
  vat: number;
}

/** Исходные данные расчёта. */
export interface CalcInput {
  city: string;
  methodId: string;
  /** Вес груза, кг. */
  weight: number;
  /** Объём груза, куб.м. */
  volume: number;
  items: CalcItemInput[];
}

/** Курсы ЦБ, в которых считаем (рублей за единицу валюты). */
export interface CalcRates {
  usd: number;
  cny: number;
  date: string;
}

/** Результат расчёта — то, что видит посетитель и что уходит в заявку. */
export interface CalcResult {
  city: string;
  method: DeliveryMethod;
  weight: number;
  volume: number;
  /** Объём для тарификации: max(объём; вес / 300). */
  chargeableVolume: number;
  /** По какому параметру тарифицируем: по объёму или по весу. */
  chargeableBy: "volume" | "weight";
  /** Стоимость доставки, $. */
  delivery: number;
  items: CalcItemResult[];
  /** Стоимость всех товаров, $. */
  goodsUsd: number;
  /** Сумма пошлин по всем товарам, $. */
  duty: number;
  /** Сумма НДС по всем товарам, $. */
  vat: number;
  /** Доставка + пошлины + НДС, $. */
  deliveryAndCustoms: number;
  /** Итог «под ключ»: товары + доставка + таможня, $. */
  total: number;
  rates: CalcRates;
}

/** Округление до копеек (доллара). */
export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Округление объёма до трёх знаков (расчётный объём — дробный). */
function round3(value: number): number {
  return Math.round((value + Number.EPSILON) * 1000) / 1000;
}

/** Число в допустимом диапазоне; иначе — 0. */
function num(value: unknown, max: number): number {
  const parsed =
    typeof value === "number"
      ? value
      : Number(
          String(value ?? "")
            .replace(/\s/g, "")
            .replace(",", "."),
        );
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.min(parsed, max);
}

/** Способ доставки по идентификатору (по умолчанию — первый в конфиге). */
export function findMethod(id: string): DeliveryMethod {
  return CALC_CONFIG.methods.find((method) => method.id === id) ?? CALC_CONFIG.methods[0];
}

/**
 * Расчётный объём: лёгкий груз считаем по объёму, тяжёлый — по весу.
 * 3 куб.м / 500 кг → 500/300 = 1.67 < 3 → берём 3.
 * 1 куб.м / 500 кг → 500/300 = 1.67 > 1 → берём 1.67.
 */
export function chargeableVolume(volume: number, weight: number): number {
  return Math.max(volume, weight / CALC_CONFIG.weightPerCbm);
}

/** Разбирает произвольные данные клиента в валидный ввод калькулятора. */
export function parseCalcInput(raw: unknown): CalcInput | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const source = raw as Record<string, unknown>;
  const { limits } = CALC_CONFIG;

  const rawItems = Array.isArray(source.items) ? source.items : [];
  const items: CalcItemInput[] = rawItems
    .slice(0, limits.maxItems)
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .map((item) => ({
      name: String(item.name ?? "").trim().slice(0, limits.maxNameLength),
      priceCny: num(item.priceCny, limits.maxPrice),
      dutyRate: num(item.dutyRate, 100),
      vatRate: num(item.vatRate, 100),
    }));

  const city = String(source.city ?? "").trim().slice(0, 100);

  return {
    city: CALC_CONFIG.cities.includes(city) ? city : city || CALC_CONFIG.cities[0],
    methodId: findMethod(String(source.methodId ?? "")).id,
    weight: num(source.weight, limits.maxWeight),
    volume: num(source.volume, limits.maxVolume),
    items,
  };
}

/** Разбирает курсы, присланные клиентом (используются, если ЦБ недоступен). */
export function parseCalcRates(raw: unknown): CalcRates | null {
  if (!raw || typeof raw !== "object") return null;
  const source = raw as Record<string, unknown>;
  const usd = num(source.usd, 1_000_000);
  const cny = num(source.cny, 1_000_000);
  if (usd <= 0 || cny <= 0) return null;
  return { usd, cny, date: String(source.date ?? "").slice(0, 32) };
}

/**
 * Полный расчёт по введённым данным и курсам ЦБ.
 * Считается всегда заново — и на клиенте при вводе, и на бэкенде перед
 * отправкой в CRM: менеджер должен видеть суммы, посчитанные нами, а не
 * пришедшие из браузера.
 */
export function computeCalculation(input: CalcInput, rates: CalcRates): CalcResult {
  const method = findMethod(input.methodId);
  const byWeight = input.weight / CALC_CONFIG.weightPerCbm;
  const chargeable = chargeableVolume(input.volume, input.weight);

  // Кросс-курс юань → доллар через рублёвые курсы ЦБ.
  const cnyToUsd = rates.usd > 0 ? rates.cny / rates.usd : 0;

  const items: CalcItemResult[] = input.items.map((item) => {
    const priceUsd = item.priceCny * cnyToUsd;
    const duty = priceUsd * (item.dutyRate / 100);
    // НДС — от таможенной стоимости С УЧЁТОМ пошлины.
    const vat = (priceUsd + duty) * (item.vatRate / 100);
    return {
      ...item,
      priceUsd: round2(priceUsd),
      duty: round2(duty),
      vat: round2(vat),
    };
  });

  const goodsUsd = round2(items.reduce((sum, item) => sum + item.priceUsd, 0));
  const duty = round2(items.reduce((sum, item) => sum + item.duty, 0));
  const vat = round2(items.reduce((sum, item) => sum + item.vat, 0));
  const delivery = round2(chargeable * method.rate);
  const deliveryAndCustoms = round2(delivery + duty + vat);

  return {
    city: input.city,
    method,
    weight: input.weight,
    volume: input.volume,
    chargeableVolume: round3(chargeable),
    chargeableBy: byWeight > input.volume ? "weight" : "volume",
    delivery,
    items,
    goodsUsd,
    duty,
    vat,
    deliveryAndCustoms,
    total: round2(deliveryAndCustoms + goodsUsd),
    rates,
  };
}
