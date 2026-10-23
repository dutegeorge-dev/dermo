/**
 * База фабрик: найденные в WeChat заводы, с которыми ещё нет договора (кандидаты), их анкеты, цены,
 * фото и каталоги. Подписали договор — фабрика связывается с поставщиком (counterparties).
 * Кандидатов видит админ и тот, кто нашёл; фабрики-поставщики — все.
 */

export const FACTORY_STATUSES = {
  new: { label: "Новая", color: "slate" },
  contacted: { label: "На связи", color: "sky" },
  samples: { label: "Образцы", color: "amber" },
  approved: { label: "Подходит", color: "green" },
  rejected: { label: "Не подходит", color: "red" },
} as const;
export type FactoryStatus = keyof typeof FACTORY_STATUSES;

/** Да / нет / не знаем. */
export type YesNo = "yes" | "no" | "";
export const YES_NO: Record<YesNo, string> = { yes: "да", no: "нет", "": "—" };

/** Анкета поставщика — вопросы владельца (место производства — отдельное поле фабрики). */
export type FactoryProfile = {
  leadTime: string;
  prices: string;
  lot: string;
  moq: string;
  exportLicense: YesNo;
  vtbShanghai: YesNo;
  russianClients: string;
  samples: string;
  hsCode: string;
};

export const EMPTY_PROFILE: FactoryProfile = {
  leadTime: "",
  prices: "",
  lot: "",
  moq: "",
  exportLicense: "",
  vtbShanghai: "",
  russianClients: "",
  samples: "",
  hsCode: "",
};

/** Вопросы анкеты по порядку, как в таблице владельца. */
export const PROFILE_QUESTIONS: { key: "location" | keyof FactoryProfile; label: string; hint: string; yesNo?: boolean }[] = [
  { key: "location", label: "Место производства", hint: "Линьи, провинция Шаньдун" },
  { key: "leadTime", label: "Сроки производства", hint: "3–5 дней" },
  { key: "prices", label: "Цены с характеристиками", hint: "300 г — 5 юаней, 200 г — 3,5 юаня" },
  { key: "lot", label: "Вес и объём партии", hint: "300 г — 12 000 м² в 40HQ" },
  { key: "moq", label: "Минимальный объём", hint: "1 цвет — 3000 м²" },
  { key: "exportLicense", label: "Экспортная лицензия", hint: "", yesNo: true },
  { key: "vtbShanghai", label: "Банк ВТБ Шанхай", hint: "", yesNo: true },
  { key: "russianClients", label: "Работали с российскими клиентами (какой товар)", hint: "да, газон" },
  { key: "samples", label: "Образцы", hint: "заказаны" },
  { key: "hsCode", label: "Предполагаемый код ТН ВЭД", hint: "5703 30 800 0" },
];

/** Метки файлов фабрики. */
export const FACTORY_FILE_LABELS = { photo: "Фото", catalog: "Каталог / прайс", screenshot: "Скриншот переписки" } as const;
export type FactoryFileLabel = keyof typeof FACTORY_FILE_LABELS;

/** Цена фабрики на товар (вариант — в названии и условиях). */
export type Offer = {
  id?: number;
  productId: number | null;
  productName?: string | null;
  /** Как у фабрики: «Трава 20 мм, 400 г/м², ширина 2/4 м». */
  name: string;
  price: number | null;
  currency: string;
  unit: string | null;
  /** Минимальный заказ, в единицах цены. */
  moq: number | null;
  /** Сколько единиц входит в 40HQ. */
  perContainer: number | null;
  /** Вес единицы, кг (брутто). */
  kgPerUnit: number | null;
  /** Объём единицы, м³. */
  m3PerUnit: number | null;
  /** Условия: «EXW Линьи», «цена от 1000 м²». */
  conditions: string;
  quotedAt: string | null;
};

export const emptyOffer = (): Offer => ({
  productId: null,
  name: "",
  price: null,
  currency: "CNY",
  unit: "м²",
  moq: null,
  perContainer: null,
  kgPerUnit: null,
  m3PerUnit: null,
  conditions: "",
  quotedAt: null,
});

// ── Каталоги из рассылки ───────────────────────────────────────────────────

export const CATALOG_STATUSES = {
  queued: "В очереди",
  processing: "Разбирается",
  review: "На проверке",
  done: "Готово",
  failed: "Ошибка",
} as const;
export type CatalogStatus = keyof typeof CATALOG_STATUSES;

/** Что ИИ понял по каталогу: кто это и какие категории товара делает (без параметров — их узнают в переписке). */
export type CatalogResult = {
  /** Название как в каталоге: «Dezhou Chengda Nonwoven Products Co., Ltd.». */
  company: string;
  /** Коротко по-русски: «Chengda — ковролин». */
  nameRu: string;
  phone: string;
  wechatId: string;
  email: string;
  website: string;
  location: string;
  categories: string[];
  notes: string;
};

/** Категория фабрики — строчными, без лишних пробелов. */
export const normCategory = (c: string) => c.trim().replace(/\s+/g, " ").toLowerCase().slice(0, 60);
