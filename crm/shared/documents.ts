/**
 * Типы документов и контрагентов — общий справочник для сервера и интерфейса.
 * Добавить новый тип документа = добавить запись в DOC_TYPES (миграция не нужна).
 */

export type CounterpartyRole = "client" | "supplier" | "contractor";

export const COUNTERPARTY_ROLES: Record<CounterpartyRole, { one: string; many: string; path: string }> = {
  client: { one: "Клиент", many: "Клиенты", path: "clients" },
  supplier: { one: "Поставщик", many: "Поставщики", path: "suppliers" },
  contractor: { one: "Подрядчик", many: "Подрядчики", path: "contractors" },
};

export const CONTRACTOR_TYPES = {
  carrier_cn: "Перевозчик (Китай)",
  carrier_ru: "Перевозчик (Россия)",
  broker: "Таможенный брокер",
  warehouse: "СВХ / терминал",
  agent: "Агент",
  other: "Прочее",
} as const;

export const SCHEMES = {
  commission: "Комиссия",
  supply: "Поставка",
  teu: "ТЭУ",
} as const;
export type Scheme = keyof typeof SCHEMES;

export const CURRENCIES = ["CNY", "USD", "EUR", "RUB"] as const;
export const CURRENCY_SIGNS: Record<string, string> = { CNY: "¥", USD: "$", EUR: "€", RUB: "₽" };

export const PAYMENT_STATUSES = { unpaid: "Не оплачен", partial: "Частично", paid: "Оплачен" } as const;
export type PaymentStatusKey = keyof typeof PAYMENT_STATUSES;

export const DOC_STATUSES = { draft: "Черновик", signed: "Подписан", cancelled: "Аннулирован" } as const;

/** Статьи расходов: смета поручения, инвойсы подрядчиков и ДТ сводятся к ним в «план / факт». */
export const COST_CATEGORIES = {
  goods: "Оплата стоимости Товаров",
  transport: "Оплата транспорта",
  broker: "Услуги брокера",
  terminal: "Терминальные расходы, хранение на СВХ, досмотры",
  customs: "Сумма таможенных платежей",
  fx: "Курсовая разница при конвертации и банковская комиссия за перевод",
  currency_control: "Комиссия за выполнение функции валютного контроля",
  eco: "Экологический сбор, уплачиваемый импортером согласно действующему законодательству",
  commission: "Вознаграждение Комиссионера",
} as const;
export type CostCategory = keyof typeof COST_CATEGORIES;

/** Подрядчик → статья расходов по умолчанию для его счетов. */
export const CONTRACTOR_COST: Record<string, CostCategory> = {
  carrier_cn: "transport",
  carrier_ru: "transport",
  broker: "broker",
  warehouse: "terminal",
  agent: "transport",
  other: "transport",
};

export type DocGroup = "client" | "supplier" | "contractor" | "shipping" | "customs" | "other";

export const DOC_GROUPS: Record<DocGroup, string> = {
  client: "С клиентом",
  supplier: "С поставщиком",
  contractor: "С подрядчиками",
  shipping: "Перевозка",
  customs: "Таможня и разрешения",
  other: "Прочее",
};

export type DocTypeSpec = {
  label: string;
  group: DocGroup;
  /** С кем документ (кого выбирать второй стороной). null — сторона не обязательна. */
  party: CounterpartyRole | null;
  /** Договор (рамочный документ, к нему крепятся приложения и инвойсы). */
  contract?: boolean;
  /** Типы договоров, к которым относится документ (parent). */
  parentTypes?: string[];
  /** Номер — порядковый внутри договора (Приложение № N). */
  numberedInParent?: boolean;
  /** Есть позиции товаров. */
  items?: boolean;
  /** Есть сумма и статус оплаты. */
  payable?: boolean;
  /** Есть срок действия. */
  validity?: boolean;
  /** Есть статус подписания. */
  signable?: boolean;
  /** Схема сделки для договора с клиентом. */
  scheme?: Scheme;
  /** Подсказка в форме. */
  hint?: string;
};

export const DOC_TYPES = {
  commission_contract: {
    label: "Договор комиссии",
    group: "client",
    party: "client",
    contract: true,
    validity: true,
    signable: true,
    scheme: "commission",
  },
  supply_contract: {
    label: "Договор поставки",
    group: "client",
    party: "client",
    contract: true,
    validity: true,
    signable: true,
    scheme: "supply",
  },
  teu_contract: {
    label: "Договор ТЭУ",
    group: "client",
    party: "client",
    contract: true,
    validity: true,
    signable: true,
    scheme: "teu",
  },
  commission_order: {
    label: "Поручение на закупку",
    group: "client",
    party: "client",
    parentTypes: ["commission_contract"],
    numberedInParent: true,
    items: true,
    signable: true,
    hint: "Формируется из сделки кнопкой «Сформировать поручение»",
  },
  specification: {
    label: "Спецификация",
    group: "client",
    party: "client",
    parentTypes: ["supply_contract"],
    numberedInParent: true,
    items: true,
    signable: true,
  },
  teu_request: {
    label: "Заявка / расчёт ТЭУ",
    group: "client",
    party: "client",
    parentTypes: ["teu_contract"],
    numberedInParent: true,
    signable: true,
  },
  client_invoice: {
    label: "Счёт клиенту",
    group: "client",
    party: "client",
    payable: true,
  },
  supplier_contract: {
    label: "Контракт с поставщиком",
    group: "supplier",
    party: "supplier",
    contract: true,
    validity: true,
    signable: true,
    hint: "Наш контракт — один на поставщика. Контракт клиента (при ТЭУ) — укажите клиента.",
  },
  supplier_invoice: {
    label: "Инвойс поставщика",
    group: "supplier",
    party: "supplier",
    parentTypes: ["supplier_contract"],
    items: true,
    payable: true,
  },
  packing_list: {
    label: "Упаковочный лист",
    group: "supplier",
    party: "supplier",
    parentTypes: ["supplier_contract"],
  },
  contractor_contract: {
    label: "Договор с подрядчиком",
    group: "contractor",
    party: "contractor",
    contract: true,
    validity: true,
    signable: true,
  },
  contractor_invoice: {
    label: "Инвойс / счёт подрядчика",
    group: "contractor",
    party: "contractor",
    parentTypes: ["contractor_contract"],
    payable: true,
  },
  railway_bill: { label: "Ж/д накладная (СМГС)", group: "shipping", party: "contractor" },
  cmr: { label: "CMR", group: "shipping", party: "contractor" },
  bill_of_lading: { label: "Коносамент", group: "shipping", party: "contractor" },
  air_waybill: { label: "Авианакладная", group: "shipping", party: "contractor" },
  customs_declaration: {
    label: "ДТ (ГТД)",
    group: "customs",
    party: null,
    payable: true,
    hint: "Сумма — таможенные платежи (пошлина, НДС, сборы) в рублях",
  },
  conformity: {
    label: "Декларация соответствия / сертификат",
    group: "customs",
    party: null,
    validity: true,
  },
  power_of_attorney: {
    label: "Доверенность",
    group: "other",
    party: null,
    validity: true,
  },
  supplementary: {
    label: "Доп. соглашение",
    group: "other",
    party: null,
    parentTypes: [
      "commission_contract",
      "supply_contract",
      "teu_contract",
      "supplier_contract",
      "contractor_contract",
    ],
    signable: true,
  },
  other: { label: "Прочее", group: "other", party: null },
} as const satisfies Record<string, DocTypeSpec>;

export type DocType = keyof typeof DOC_TYPES;
export const DOC_TYPE_KEYS = Object.keys(DOC_TYPES) as DocType[];

export function docSpec(type: string): DocTypeSpec | null {
  return (DOC_TYPES as Record<string, DocTypeSpec>)[type] ?? null;
}

/** Тип договора с клиентом для схемы сделки. */
export const CLIENT_CONTRACT_BY_SCHEME: Record<Scheme, DocType> = {
  commission: "commission_contract",
  supply: "supply_contract",
  teu: "teu_contract",
};

/** Строка сметы поручения. */
export type CostLine = {
  category: CostCategory;
  /** Текст статьи как в поручении (можно уточнить: «Оплата транспорта по маршруту …»). */
  name: string;
  /** Сумма; null — «Подтверждаемый расход». */
  amount: number | null;
  currency: string;
  /** Срок оплаты. */
  term: string;
};

/** Стандартная смета поручения — как в шаблоне ТЛК БАРС. */
export function defaultCostLines(goodsCurrency: string): CostLine[] {
  const t2 = "2 банковских дня с момента выставления счета";
  return [
    { category: "goods", name: COST_CATEGORIES.goods, amount: null, currency: goodsCurrency, term: t2 },
    {
      category: "transport",
      name: "Оплата транспорта по маршруту",
      amount: null,
      currency: goodsCurrency,
      term: `${t2}, по факту уведомления о готовности товара к отгрузке и согласования даты отгрузки`,
    },
    { category: "broker", name: COST_CATEGORIES.broker, amount: null, currency: "RUB", term: t2 },
    { category: "terminal", name: COST_CATEGORIES.terminal, amount: null, currency: "RUB", term: t2 },
    { category: "customs", name: COST_CATEGORIES.customs, amount: null, currency: "RUB", term: t2 },
    { category: "fx", name: COST_CATEGORIES.fx, amount: null, currency: "RUB", term: t2 },
    { category: "currency_control", name: COST_CATEGORIES.currency_control, amount: null, currency: "RUB", term: "" },
    {
      category: "eco",
      name: COST_CATEGORIES.eco,
      amount: null,
      currency: "RUB",
      term: "3 дня с момента выставления счета, срок уплаты – до 15 апреля года, следующего за годом ввоза",
    },
    {
      category: "commission",
      name: COST_CATEGORIES.commission,
      amount: null,
      currency: "RUB",
      term: "По факту выпуска таможенной декларации по процедуре «выпуск для внутреннего потребления», 3 дня с момента выставления счета",
    },
  ];
}

export function formatMoney(amount: number | string | null | undefined, currency?: string | null): string {
  if (amount === null || amount === undefined || amount === "") return "—";
  const n = Number(amount);
  if (!Number.isFinite(n)) return "—";
  const text = n.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (!currency) return text;
  return currency === "RUB" ? `${text} ₽` : `${CURRENCY_SIGNS[currency] ?? ""}${text}${CURRENCY_SIGNS[currency] ? "" : ` ${currency}`}`;
}
