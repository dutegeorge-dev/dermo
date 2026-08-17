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
 *   • доставка — разовый сбор за оформление (bill list) плюс тариф за каждый
 *     расчётный кубометр: max(объём; вес / 300), лимит 300 кг/куб;
 *   • таможенная стоимость — товар ПЛЮС половина стоимости перевозки;
 *   • пошлина — процент от таможенной стоимости;
 *   • НДС — процент от таможенной стоимости ВМЕСТЕ с пошлиной;
 *   • комиссия компании — фиксированная, зависит от стоимости товара.
 */

/** Способ доставки: разовый сбор за оформление плюс тариф за кубометр. */
export interface DeliveryMethod {
  /** Идентификатор, уходящий в заявку. */
  id: string;
  /** Подпись в интерфейсе. */
  label: string;
  /** Тариф, $ за 1 куб.м (без разового сбора). */
  rate: number;
  /** Разовый сбор за оформление (bill list), $ — берётся один раз на партию. */
  billList: number;
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

  /**
   * Способы доставки сборного груза и их тарифы.
   * Разовый сбор (bill list) входит в цену первого куба: ЖД 150 + 160 = 310 $
   * за первый кубометр и по 160 $ за каждый следующий; авто — 150 + 330 = 480 $
   * за первый и по 330 $ далее.
   */
  methods: [
    { id: "zhd", label: "Железная дорога", rate: 160, billList: 150, time: "20–30 дней", icon: "train-front" },
    { id: "avto", label: "Автодоставка", rate: 330, billList: 150, time: "8–14 дней", icon: "truck" },
  ] as DeliveryMethod[],

  /** Лимит веса на кубометр: тяжёлый груз тарифицируется по весу. */
  weightPerCbm: 300,

  /** До какого объёма расчёт считается применимым (дальше — только менеджер). */
  maxVolume: 8,

  /** Заявленная погрешность расчёта, %. */
  accuracy: "10–15 %",

  /**
   * Комиссия компании — фиксированная сумма, зависит от стоимости товара.
   * Дешевле порога — `below`, от порога и выше — `above`.
   */
  commission: {
    /** Порог стоимости товара, $. */
    threshold: 10_000,
    /** Комиссия при стоимости товара меньше порога, $. */
    below: 700,
    /** Комиссия при стоимости товара от порога, $. */
    above: 1000,
  },

  /** Доля стоимости перевозки, включаемая в таможенную стоимость. */
  freightInCustomsShare: 0.5,

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
  /**
   * Таможенная стоимость товара, $: цена плюс приходящаяся на него доля
   * перевозки (половина доставки делится между товарами пропорционально цене).
   */
  customsValue: number;
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
  /** Таможенная стоимость: товары + половина доставки, $. */
  customsValue: number;
  /** Сумма пошлин по всем товарам, $. */
  duty: number;
  /** Сумма НДС по всем товарам, $. */
  vat: number;
  /** Комиссия компании, $. */
  commission: number;
  /** Доставка + пошлины + НДС + комиссия, $ (всё, кроме самого товара). */
  deliveryAndCustoms: number;
  /** Итог «под ключ»: товары + доставка + таможня + комиссия, $. */
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

  // Разовый сбор берётся только за реальную партию: на пустой форме (объём и
  // вес ещё не введены) показывать 150 $ было бы враньём.
  const deliveryRaw = chargeable > 0 ? method.billList + chargeable * method.rate : 0;
  const delivery = round2(deliveryRaw);

  // Кросс-курс юань → доллар через рублёвые курсы ЦБ.
  const cnyToUsd = rates.usd > 0 ? rates.cny / rates.usd : 0;

  const pricesUsd = input.items.map((item) => item.priceCny * cnyToUsd);
  const goodsRaw = pricesUsd.reduce((sum, price) => sum + price, 0);

  // В таможенную стоимость входит половина перевозки. Она распределяется между
  // товарами пропорционально их цене: у каждого своя ставка пошлины и НДС,
  // поэтому общей суммой обойтись нельзя.
  const freightInCustoms = deliveryRaw * CALC_CONFIG.freightInCustomsShare;

  const items: CalcItemResult[] = input.items.map((item, index) => {
    const priceUsd = pricesUsd[index];
    const share = goodsRaw > 0 ? priceUsd / goodsRaw : 0;
    const customsValue = priceUsd + freightInCustoms * share;
    const duty = customsValue * (item.dutyRate / 100);
    // НДС — от таможенной стоимости С УЧЁТОМ пошлины.
    const vat = (customsValue + duty) * (item.vatRate / 100);
    return {
      ...item,
      priceUsd: round2(priceUsd),
      customsValue: round2(customsValue),
      duty: round2(duty),
      vat: round2(vat),
    };
  });

  const goodsUsd = round2(goodsRaw);
  const duty = round2(items.reduce((sum, item) => sum + item.duty, 0));
  const vat = round2(items.reduce((sum, item) => sum + item.vat, 0));
  // Комиссия зависит от стоимости товара, а не от итоговой суммы: она известна
  // ещё до расчёта таможни и не «плавает» вслед за пошлиной.
  const { threshold, below, above } = CALC_CONFIG.commission;
  const commission = goodsRaw > 0 ? (goodsRaw < threshold ? below : above) : 0;
  const customsValue = round2(goodsRaw > 0 ? goodsRaw + freightInCustoms : 0);
  const deliveryAndCustoms = round2(delivery + duty + vat + commission);

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
    customsValue,
    duty,
    vat,
    commission,
    deliveryAndCustoms,
    total: round2(deliveryAndCustoms + goodsUsd),
    rates,
  };
}
