/** Свои события календаря (не из дат сделок): встречи, поездки, оплаты счетов, звонки, задачи. */

export const CUSTOM_EVENT_TYPES = {
  meeting: { label: "Встреча", color: "#2563eb" },
  trip: { label: "Поездка", color: "#7c3aed" },
  payment: { label: "Оплата", color: "#d97706" },
  call: { label: "Звонок", color: "#0891b2" },
  task: { label: "Задача", color: "#16a34a" },
  other: { label: "Другое", color: "#64748b" },
} as const;
export type CustomEventType = keyof typeof CUSTOM_EVENT_TYPES;

export type CustomEvent = {
  id: number;
  type: CustomEventType;
  title: string;
  date: string;
  /** «14:30»; пусто — на весь день. */
  time: string | null;
  /** Поездка на несколько дней — по какую дату. */
  endDate: string | null;
  notes: string;
  amount: number | null;
  currency: string | null;
  shipmentId: number | null;
  shipmentNumber: number | null;
  shipmentTitle: string | null;
  counterpartyId: number | null;
  counterpartyName: string | null;
  assigneeId: number | null;
  assigneeName: string | null;
  done: boolean;
  createdBy: number | null;
  createdByName: string | null;
};
