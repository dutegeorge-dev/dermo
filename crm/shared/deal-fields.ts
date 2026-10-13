/**
 * Поля сделки — общий справочник для сервера (проверка, журнал изменений) и
 * интерфейса (подписи, варианты). Без зависимостей: импортируется с обеих сторон.
 */

export type FieldKind =
  | "text"
  | "longtext"
  | "number"
  | "date"
  | "enum"
  | "user"
  | "labels"
  | "client"
  | "contact"
  | "counterparty"
  | "document";

export type FieldSpec = {
  label: string;
  kind: FieldKind;
  /** Варианты для enum: значение → подпись. */
  values?: Record<string, string>;
  max?: number;
  required?: boolean;
};

export const PRIORITIES = { low: "Низкий", medium: "Средний", high: "Высокий", urgent: "Срочный" } as const;
export const COMPANY_KINDS = { ooo: "ООО", ip: "ИП", foreign: "Иностранная компания", other: "Другое" } as const;
export const MESSENGERS = { telegram: "Telegram", whatsapp: "WhatsApp", max: "Макс", wechat: "WeChat", other: "Другой" } as const;

/**
 * Поля лида в воронке — только работа с клиентом. Груз, поставщик, договоры,
 * документы и деньги — в сделке (shared/shipments.ts).
 */
export const DEAL_FIELDS = {
  title: { label: "Название", kind: "text", max: 300, required: true },
  clientId: { label: "Клиент", kind: "client" },
  contactId: { label: "Контакт", kind: "contact" },
  product: { label: "Что хочет клиент", kind: "text", max: 500 },
  assigneeId: { label: "Исполнитель", kind: "user" },
  dueDate: { label: "Срок", kind: "date" },
  priority: { label: "Приоритет", kind: "enum", values: PRIORITIES },
  labels: { label: "Метки", kind: "labels" },
  description: { label: "Описание", kind: "longtext", max: 20_000 },
} as const satisfies Record<string, FieldSpec>;

export type DealField = keyof typeof DEAL_FIELDS;

export const DEAL_FIELD_NAMES = Object.keys(DEAL_FIELDS) as DealField[];

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
