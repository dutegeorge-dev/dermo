/**
 * Разбор и валидация заявки с сайта + сборка полей лида для Bitrix24.
 *
 * Формы сайта (см. src/_includes/**) присылают: cargo, volume, contact,
 * consent, а также служебные page/locale/form/utm. Имя и e-mail опциональны —
 * поддержаны на будущее, если поля появятся в формах.
 */

/** Сырые данные, пришедшие от клиента (после JSON.parse — тип неизвестен). */
export type RawPayload = Record<string, unknown>;

export interface LeadInput {
  /** Имя контакта (если форма его собирает). */
  name: string;
  /** Что везём/закупаем. */
  cargo: string;
  /** Объём или вес груза. */
  volume: string;
  /** Контакт как ввёл пользователь: телефон, Telegram или e-mail. */
  contact: string;
  /** Телефон, выделенный из contact или переданный отдельным полем. */
  phone: string;
  /** E-mail, выделенный из contact или переданный отдельным полем. */
  email: string;
  /** Telegram-ник/ссылка, если контакт указан так. */
  telegram: string;
  /** Свободный комментарий. */
  comment: string;
  /** Согласие на обработку ПДн (152-ФЗ). */
  consent: boolean;
  /** Страница, с которой отправлена заявка. */
  page: string;
  /** Локаль страницы (ru/en/zh). */
  locale: string;
  /** Идентификатор формы (hero, trade, lead, ...). */
  form: string;
  /** Реферер визита. */
  referrer: string;
  /** UTM-метки. */
  utm: Record<string, string>;
}

export interface ValidationResult {
  ok: boolean;
  /** Ошибки по полям: имя поля → сообщение. */
  errors: Record<string, string>;
  lead: LeadInput;
}

const MAX_FIELD_LENGTH = 500;
const MAX_COMMENT_LENGTH = 2000;

const UTM_KEYS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
] as const;

/** Приводит произвольное значение к обрезанной строке. */
function str(value: unknown, maxLength = MAX_FIELD_LENGTH): string {
  if (typeof value === "string") return value.trim().slice(0, maxLength);
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value).slice(0, maxLength);
  }
  return "";
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const TELEGRAM_RE = /^@[\w]{3,}$|(?:https?:\/\/)?t\.me\/[\w+]{3,}/i;

/** Считает количество цифр в строке. */
function digitCount(value: string): number {
  return (value.match(/\d/g) ?? []).length;
}

/** Похоже ли значение на телефон (цифры и допустимая пунктуация). */
function looksLikePhone(value: string): boolean {
  return /^[+()\d\s-]{5,}$/.test(value) && digitCount(value) >= 5;
}

/** Нормализует телефон: оставляет `+` и цифры. */
function normalizePhone(value: string): string {
  const digits = value.replace(/[^\d+]/g, "").replace(/(?!^)\+/g, "");
  return digits;
}

/**
 * Разбирает поле «контакт», в которое пользователь может ввести телефон,
 * Telegram-ник или e-mail, и раскладывает его по типам.
 */
function splitContact(contact: string): {
  phone: string;
  email: string;
  telegram: string;
} {
  const value = contact.trim();
  if (!value) return { phone: "", email: "", telegram: "" };

  if (EMAIL_RE.test(value)) return { phone: "", email: value, telegram: "" };
  if (TELEGRAM_RE.test(value)) return { phone: "", email: "", telegram: value };
  if (looksLikePhone(value)) {
    return { phone: normalizePhone(value), email: "", telegram: "" };
  }

  // Ник без «собаки» («ivanov») — считаем Telegram, если не пусто и без цифр-номера.
  if (/^[\w.]{3,}$/.test(value)) return { phone: "", email: "", telegram: `@${value}` };

  return { phone: "", email: "", telegram: "" };
}

/** Достаёт UTM-метки из вложенного объекта или из плоских полей payload. */
function readUtm(payload: RawPayload): Record<string, string> {
  const nested =
    payload.utm && typeof payload.utm === "object"
      ? (payload.utm as RawPayload)
      : {};

  const utm: Record<string, string> = {};
  for (const key of UTM_KEYS) {
    const value = str(nested[key] ?? payload[key], 200);
    if (value) utm[key] = value;
  }
  return utm;
}

/** Разбирает и валидирует полезную нагрузку заявки. */
export function parseLead(payload: RawPayload): ValidationResult {
  const contact = str(payload.contact);
  const parsed = splitContact(contact);

  const explicitPhone = str(payload.phone);
  const explicitEmail = str(payload.email);

  const lead: LeadInput = {
    name: str(payload.name, 200),
    cargo: str(payload.cargo),
    volume: str(payload.volume),
    contact,
    phone: explicitPhone ? normalizePhone(explicitPhone) : parsed.phone,
    email: EMAIL_RE.test(explicitEmail) ? explicitEmail : parsed.email,
    telegram: parsed.telegram,
    comment: str(payload.comment ?? payload.message, MAX_COMMENT_LENGTH),
    consent: payload.consent === true || payload.consent === "on" || payload.consent === "true",
    page: str(payload.page, 500),
    locale: str(payload.locale, 8) || "ru",
    form: str(payload.form, 64) || "lead",
    referrer: str(payload.referrer, 500),
    utm: readUtm(payload),
  };

  const errors: Record<string, string> = {};

  if (!lead.contact) {
    errors.contact = "Укажите телефон, Telegram или e-mail.";
  } else if (!lead.phone && !lead.email && !lead.telegram) {
    errors.contact = "Не удалось распознать контакт. Проверьте телефон или Telegram.";
  }

  if (!lead.cargo && !lead.comment) {
    errors.cargo = "Укажите, что нужно перевезти или закупить.";
  }

  if (!lead.consent) {
    errors.consent = "Требуется согласие на обработку персональных данных.";
  }

  return { ok: Object.keys(errors).length === 0, errors, lead };
}

/** Человекочитаемое название формы для заголовка лида. */
const FORM_TITLES: Record<string, string> = {
  hero: "главная",
  logi: "логистика",
  trade: "торговля",
  lead: "форма заявки",
};

/** Заголовок лида: «Заявка с сайта — <груз>». */
function buildTitle(lead: LeadInput): string {
  const source = FORM_TITLES[lead.form] ?? lead.form;
  const subject = lead.cargo || lead.comment;
  const base = subject
    ? `Заявка с сайта — ${subject}`
    : `Заявка с сайта (${source})`;
  return base.slice(0, 240);
}

/** Комментарий лида: всё, что не влезло в типизированные поля Bitrix24. */
function buildComments(lead: LeadInput, meta: { ip: string; userAgent: string }): string {
  const lines: string[] = [];

  if (lead.cargo) lines.push(`Груз: ${lead.cargo}`);
  if (lead.volume) lines.push(`Объём/вес: ${lead.volume}`);
  if (lead.contact) lines.push(`Контакт (как ввёл клиент): ${lead.contact}`);
  if (lead.telegram) lines.push(`Telegram: ${lead.telegram}`);
  if (lead.comment) lines.push(`Комментарий: ${lead.comment}`);

  lines.push("");
  if (lead.page) lines.push(`Страница: ${lead.page}`);
  if (lead.referrer) lines.push(`Реферер: ${lead.referrer}`);
  lines.push(`Форма: ${lead.form}`);
  lines.push(`Язык: ${lead.locale}`);

  const utmEntries = Object.entries(lead.utm);
  if (utmEntries.length > 0) {
    lines.push(`UTM: ${utmEntries.map(([k, v]) => `${k}=${v}`).join(", ")}`);
  }

  lines.push(
    `Согласие на обработку ПДн: получено ${new Date().toISOString()} (IP ${meta.ip})`,
  );
  if (meta.userAgent) lines.push(`User-Agent: ${meta.userAgent}`);

  return lines.join("\n");
}

/** Поля лида в формате crm.lead.add. */
export type LeadFields = Record<string, unknown>;

/**
 * Собирает поля для `crm.lead.add`.
 * Множественные поля (PHONE/EMAIL) передаются массивом объектов
 * `{ VALUE, VALUE_TYPE }` — как того требует REST Bitrix24.
 */
export function buildLeadFields(
  lead: LeadInput,
  meta: { ip: string; userAgent: string },
  options: { sourceId: string; assignedById: string },
): LeadFields {
  const fields: LeadFields = {
    TITLE: buildTitle(lead),
    NAME: lead.name || undefined,
    SOURCE_ID: options.sourceId,
    SOURCE_DESCRIPTION: lead.page || "Сайт",
    COMMENTS: buildComments(lead, meta),
    OPENED: "Y",
  };

  if (lead.phone) {
    fields.PHONE = [{ VALUE: lead.phone, VALUE_TYPE: "WORK" }];
  }
  if (lead.email) {
    fields.EMAIL = [{ VALUE: lead.email, VALUE_TYPE: "WORK" }];
  }
  if (lead.telegram) {
    fields.IM = [{ VALUE: lead.telegram, VALUE_TYPE: "TELEGRAM" }];
  }
  if (options.assignedById) {
    fields.ASSIGNED_BY_ID = options.assignedById;
  }

  for (const [key, value] of Object.entries(lead.utm)) {
    fields[key.toUpperCase()] = value;
  }

  // Bitrix24 не любит undefined в JSON — выбрасываем пустые ключи.
  for (const key of Object.keys(fields)) {
    if (fields[key] === undefined) delete fields[key];
  }

  return fields;
}
