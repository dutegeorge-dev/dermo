/**
 * Поля сделки — общий справочник для сервера (проверка, журнал изменений) и
 * интерфейса (подписи, варианты). Без зависимостей: импортируется с обеих сторон.
 */

export type FieldKind = "text" | "longtext" | "number" | "date" | "enum" | "user" | "labels" | "client" | "contact";

export type FieldSpec = {
  label: string;
  kind: FieldKind;
  /** Варианты для enum: значение → подпись. */
  values?: Record<string, string>;
  max?: number;
  required?: boolean;
};

export const ROUTES = { auto: "Авто", rail: "Ж/д", air: "Авиа", sea: "Море", multimodal: "Мультимодальный" } as const;
export const PRIORITIES = { low: "Низкий", medium: "Средний", high: "Высокий", urgent: "Срочный" } as const;
export const COMPANY_KINDS = { ooo: "ООО", ip: "ИП", other: "Другое" } as const;
export const MESSENGERS = { telegram: "Telegram", whatsapp: "WhatsApp", max: "Макс", wechat: "WeChat", other: "Другой" } as const;

export const DEAL_FIELDS = {
  title: { label: "Название", kind: "text", max: 300, required: true },
  clientId: { label: "Клиент", kind: "client" },
  contactId: { label: "Контакт", kind: "contact" },
  product: { label: "Товар", kind: "text", max: 500 },
  hsCode: { label: "Код ТН ВЭД", kind: "text", max: 20 },
  weightKg: { label: "Вес, кг", kind: "number" },
  volumeM3: { label: "Объём, м³", kind: "number" },
  pickupLocation: { label: "Место забора в Китае", kind: "text", max: 500 },
  deliveryLocation: { label: "Место доставки в России", kind: "text", max: 500 },
  goodsReadyDate: { label: "Готовность товара", kind: "date" },
  route: { label: "Маршрут", kind: "enum", values: ROUTES },
  contractParty: { label: "Контракт", kind: "enum", values: { ours: "Наш", client: "Клиента" } },
  exportLicense: {
    label: "Экспортная лицензия у поставщика",
    kind: "enum",
    values: { yes: "Есть", no: "Нет", we_arrange: "Оформляем сами" },
  },
  certificates: { label: "Сертификаты", kind: "enum", values: { yes: "Есть", no: "Нет", in_progress: "Оформляем" } },
  certificateHolder: { label: "Сертификат — на кого", kind: "text", max: 300 },
  chestnyZnak: {
    label: "«Честный знак»",
    kind: "enum",
    values: { not_required: "Не требуется", required: "Нужна маркировка", applied: "Нанесена" },
  },
  assigneeId: { label: "Исполнитель", kind: "user" },
  dueDate: { label: "Срок", kind: "date" },
  priority: { label: "Приоритет", kind: "enum", values: PRIORITIES },
  labels: { label: "Метки", kind: "labels" },
  description: { label: "Описание", kind: "longtext", max: 20_000 },
} as const satisfies Record<string, FieldSpec>;

export type DealField = keyof typeof DEAL_FIELDS;

export const DEAL_FIELD_NAMES = Object.keys(DEAL_FIELDS) as DealField[];

/** Группы полей в карточке сделки. */
export const DEAL_FIELD_GROUPS: { title: string; fields: DealField[] }[] = [
  { title: "Груз", fields: ["product", "hsCode", "weightKg", "volumeM3", "goodsReadyDate"] },
  { title: "Маршрут", fields: ["route", "pickupLocation", "deliveryLocation"] },
  {
    title: "Документы и разрешения",
    fields: ["contractParty", "exportLicense", "certificates", "certificateHolder", "chestnyZnak"],
  },
];

/** Цвет текста, читаемый на фоне цвета этапа. */
export function textOn(hex: string): "#111827" | "#FFFFFF" {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return "#111827";
  const n = parseInt(m[1], 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.45 ? "#111827" : "#FFFFFF";
}

/** Палитра для выбора цвета этапа. */
export const STAGE_COLORS = [
  "#FFF200", "#FFF46B", "#FFB300", "#EE3800", "#EE1C1C", "#E91E63",
  "#9C27B0", "#5C6BC0", "#1E3FD0", "#00AEEF", "#00BDF2", "#00BFA5",
  "#77D600", "#43A047", "#94A3B8", "#475569",
];
