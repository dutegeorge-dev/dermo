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
};

export const SHIPMENT_STAGES: StageSpec[] = [
  { no: 1, name: "Производство", color: "#a78bfa", milestone: "ready", flags: [] },
  { no: 2, name: "Готов к отгрузке", color: "#f59e0b", milestone: "loading", flags: ["balance", "freight"] },
  { no: 3, name: "Погружен, ждёт отправки", color: "#38bdf8", milestone: "departure", flags: [] },
  { no: 4, name: "В пути", color: "#3b82f6", milestone: "arrival", flags: [] },
  { no: 5, name: "На таможне", color: "#f97316", milestone: "release", flags: ["customs_payment", "customs_docs"] },
  { no: 6, name: "Выпущен, доставка клиенту", color: "#14b8a6", milestone: "delivery", flags: [] },
  { no: 7, name: "Доставлен", color: "#22c55e", milestone: null, flags: [] },
];

export const LAST_STAGE = SHIPMENT_STAGES.length;

export type MilestoneSpec = {
  key: MilestoneKey;
  label: string;
  /** Подпись события в календаре. */
  event: string;
  stage: number;
  /** Необязательная отметка в пути — на этап не влияет. */
  optional?: boolean;
};

/** В хронологическом порядке: «сдвинуть следующие» идёт по этому списку. */
export const MILESTONES: MilestoneSpec[] = [
  { key: "ready", label: "Готовность товара", event: "Готовность товара", stage: 1 },
  { key: "loading", label: "Погрузка", event: "Погрузка", stage: 2 },
  { key: "departure", label: "Отправка", event: "Отправка поезда / судна", stage: 3 },
  { key: "border", label: "Граница", event: "Прохождение границы", stage: 4, optional: true },
  { key: "transshipment", label: "Перегруз", event: "Перегруз", stage: 4, optional: true },
  { key: "arrival", label: "Прибытие", event: "Прибытие на таможню", stage: 4 },
  { key: "release", label: "Выпуск", event: "Выпуск груза", stage: 5 },
  { key: "delivery", label: "Доставка клиенту", event: "Доставка клиенту", stage: 6 },
];

export const MILESTONE_KEYS = MILESTONES.map((m) => m.key);

export const FLAGS: Record<FlagKey, { label: string; todo: string; stage: number; payment: boolean }> = {
  balance: { label: "Остаток поставщику", todo: "Оплатить остаток поставщику", stage: 2, payment: true },
  freight: { label: "Фрахт", todo: "Оплатить фрахт", stage: 2, payment: true },
  customs_payment: { label: "Таможенные платежи", todo: "Оплатить таможенные платежи", stage: 5, payment: true },
  customs_docs: { label: "Документы", todo: "Документы для таможни", stage: 5, payment: false },
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

export const shipmentLabel = (number: number) => `С-${String(number).padStart(3, "0")}`;
