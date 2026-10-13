/**
 * Сделки (отгрузки): этапы, ключевые даты и флажки ожиданий — общий справочник
 * для сервера и интерфейса.
 *
 * Сделка начинается с оплаты депозита. Этап не выбирается руками, а следует из
 * проставленных фактических дат: есть факт «готовность товара» → этап 2 и т.д.
 */

export type MilestoneKey = "ready" | "loading" | "departure" | "border" | "transshipment" | "arrival" | "release" | "delivery";
export type FlagKey = "balance" | "freight" | "customs_payment" | "customs_docs";

export type StageSpec = {
  no: number;
  name: string;
  color: string;
  /** Ключевая дата этапа: её факт переводит сделку на следующий этап. */
  milestone: MilestoneKey | null;
  /** Чего ждём на этом этапе (флажки). */
  flags: FlagKey[];
  /** Что происходит на этапе — простыми словами. */
  doing: string;
};

export const SHIPMENT_STAGES: StageSpec[] = [
  { no: 1, name: "Производство", color: "#a78bfa", milestone: "ready", flags: [], doing: "Поставщик производит товар. Ждём, когда товар будет готов." },
  { no: 2, name: "Готов к отгрузке", color: "#f59e0b", milestone: "loading", flags: ["balance", "freight"], doing: "Товар готов. Оплачиваем остаток поставщику и фрахт, грузим в контейнер." },
  { no: 3, name: "Погружен, ждёт отправки", color: "#38bdf8", milestone: "departure", flags: [], doing: "Контейнер загружен. Ждём отправку поезда / судна." },
  { no: 4, name: "В пути", color: "#3b82f6", milestone: "arrival", flags: [], doing: "Груз едет. Можно отмечать границу и перегруз. Ждём прибытия на таможню." },
  { no: 5, name: "На таможне", color: "#f97316", milestone: "release", flags: ["customs_payment", "customs_docs"], doing: "Груз на таможне. Оплачиваем таможенные платежи, подаём документы, ждём выпуск." },
  { no: 6, name: "Выпущен, доставка клиенту", color: "#14b8a6", milestone: "delivery", flags: [], doing: "Таможня выпустила груз. Везём клиенту." },
  { no: 7, name: "Доставлен", color: "#22c55e", milestone: null, flags: [], doing: "Груз у клиента. Проверьте оплаты и закройте сделку." },
];

export const LAST_STAGE = SHIPMENT_STAGES.length;

export type MilestoneSpec = {
  key: MilestoneKey;
  label: string;
  /** Подпись события в календаре. */
  event: string;
  /** Как звучит, когда случилось: «Груз погружен». */
  done: string;
  stage: number;
  /** Необязательная отметка в пути — на этап не влияет. */
  optional?: boolean;
};

/** В хронологическом порядке: «сдвинуть следующие» идёт по этому списку. */
export const MILESTONES: MilestoneSpec[] = [
  { key: "ready", label: "Готовность товара", event: "Готовность товара", done: "Товар готов", stage: 1 },
  { key: "loading", label: "Погрузка", event: "Погрузка", done: "Груз погружен", stage: 2 },
  { key: "departure", label: "Отправка", event: "Отправка поезда / судна", done: "Поезд / судно отправлен", stage: 3 },
  { key: "border", label: "Граница", event: "Прохождение границы", done: "Прошёл границу", stage: 4, optional: true },
  { key: "transshipment", label: "Перегруз", event: "Перегруз", done: "Перегружен", stage: 4, optional: true },
  { key: "arrival", label: "Прибытие", event: "Прибытие на таможню", done: "Прибыл на таможню", stage: 4 },
  { key: "release", label: "Выпуск", event: "Выпуск груза", done: "Выпущен таможней", stage: 5 },
  { key: "delivery", label: "Доставка клиенту", event: "Доставка клиенту", done: "Доставлен клиенту", stage: 6 },
];

export const MILESTONE_KEYS = MILESTONES.map((m) => m.key);

export const FLAGS: Record<FlagKey, { label: string; todo: string; done: string; stage: number; payment: boolean }> = {
  balance: { label: "Остаток поставщику", todo: "Оплатить остаток поставщику", done: "Остаток поставщику оплачен", stage: 2, payment: true },
  freight: { label: "Фрахт", todo: "Оплатить фрахт", done: "Фрахт оплачен", stage: 2, payment: true },
  customs_payment: { label: "Таможенные платежи", todo: "Оплатить таможенные платежи", done: "Таможенные платежи оплачены", stage: 5, payment: true },
  customs_docs: { label: "Документы", todo: "Документы для таможни", done: "Документы для таможни поданы", stage: 5, payment: false },
};

export const FLAG_KEYS = Object.keys(FLAGS) as FlagKey[];

export const TRANSPORTS = {
  rail: "Ж/д",
  sea: "Море",
  auto: "Авто",
  air: "Авиа",
  multimodal: "Мультимодально",
} as const;

export type MilestoneDates = { plan: string | null; fact: string | null };
export type Milestones = Partial<Record<MilestoneKey, MilestoneDates>>;

/** Текущий этап: первый, у ключевой даты которого ещё нет факта. */
export function stageOf(milestones: Milestones): number {
  for (const stage of SHIPMENT_STAGES) {
    if (!stage.milestone) return stage.no;
    if (!milestones[stage.milestone]?.fact) return stage.no;
  }
  return LAST_STAGE;
}

export const stageSpec = (no: number): StageSpec => SHIPMENT_STAGES[Math.min(Math.max(no, 1), LAST_STAGE) - 1];

export const milestoneSpec = (key: string): MilestoneSpec | undefined => MILESTONES.find((m) => m.key === key);

/** Сдвиг даты YYYY-MM-DD на n дней. */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** Номер сделки — вторичен, основное имя — название груза. */
export const shipmentLabel = (number: number) => `№ ${number}`;

// ── Поля сделки ───────────────────────────────────────────────────────────

export type ShipmentFieldKind = "text" | "longtext" | "number" | "date" | "enum" | "user" | "client" | "supplier" | "carrier" | "contact" | "document" | "deal";

export type ShipmentFieldSpec = { label: string; kind: ShipmentFieldKind; values?: Record<string, string>; max?: number; required?: boolean };

export const SCHEME_LABELS = { commission: "Комиссия", supply: "Поставка", teu: "ТЭУ" } as const;

export const SHIPMENT_FIELDS = {
  title: { label: "Название", kind: "text", max: 300, required: true },
  scheme: { label: "Схема", kind: "enum", values: SCHEME_LABELS },
  clientId: { label: "Клиент", kind: "client" },
  contactId: { label: "Контакт", kind: "contact" },
  supplierId: { label: "Поставщик", kind: "supplier" },
  carrierId: { label: "Перевозчик", kind: "carrier" },
  carrierInvoiceId: { label: "Инвойс перевозчика", kind: "document" },
  clientContractId: { label: "Договор с клиентом", kind: "document" },
  supplierContractId: { label: "Контракт с поставщиком", kind: "document" },
  dealId: { label: "Лид из воронки", kind: "deal" },
  assigneeId: { label: "Менеджер", kind: "user" },
  containerNo: { label: "Номер контейнера", kind: "text", max: 20 },
  hsCode: { label: "Код ТН ВЭД", kind: "text", max: 20 },
  weightKg: { label: "Вес, кг", kind: "number" },
  volumeM3: { label: "Объём, м³", kind: "number" },
  transport: { label: "Транспорт", kind: "enum", values: TRANSPORTS },
  pickupLocation: { label: "Откуда (Китай)", kind: "text", max: 300 },
  deliveryLocation: { label: "Куда доставить", kind: "text", max: 300 },
  depositDate: { label: "Депозит оплачен", kind: "date" },
  exportLicense: { label: "Экспортная лицензия у поставщика", kind: "enum", values: { yes: "Есть", no: "Нет", we_arrange: "Оформляем сами" } },
  certificates: { label: "Сертификаты", kind: "enum", values: { yes: "Есть", no: "Нет", in_progress: "Оформляем" } },
  certificateHolder: { label: "Сертификат — на кого", kind: "text", max: 300 },
  chestnyZnak: { label: "«Честный знак»", kind: "enum", values: { not_required: "Не требуется", required: "Нужна маркировка", applied: "Нанесена" } },
  notes: { label: "Заметки", kind: "longtext", max: 20_000 },
} as const satisfies Record<string, ShipmentFieldSpec>;

export type ShipmentField = keyof typeof SHIPMENT_FIELDS;
export const SHIPMENT_FIELD_NAMES = Object.keys(SHIPMENT_FIELDS) as ShipmentField[];

/** Группы полей в карточке сделки. */
export const SHIPMENT_FIELD_GROUPS: { title: string; fields: ShipmentField[] }[] = [
  { title: "Груз", fields: ["containerNo", "hsCode", "weightKg", "volumeM3"] },
  { title: "Маршрут", fields: ["transport", "pickupLocation", "deliveryLocation"] },
  { title: "Разрешения и маркировка", fields: ["exportLicense", "certificates", "certificateHolder", "chestnyZnak"] },
];
