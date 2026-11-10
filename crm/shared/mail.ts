/**
 * Рассылка: общие типы, настройки и чистые функции — варианты фраз {a|b|c}, подстановки, запрет основного домена,
 * разнесение писем по окну отправки, подсказка «похоже на отказ». Импортируется и сервером, и фронтом.
 */

import { addDaysIso, isWorkday } from "./leadgen.ts";

/** Право на раздел «Рассылка» (users.permissions). Ящики и настройки — только админ. */
export const MAIL_PERMISSION = "mail";

export const MAIL_MODES = {
  dry_run: "Проверка (dry-run): письма рендерятся и пишутся в журнал, не отправляются",
  test: "Тест: все письма уходят на тестовый адрес",
  live: "Боевой: письма уходят продавцам",
} as const;
export type MailMode = keyof typeof MAIL_MODES;

export type MailSettings = {
  mode: MailMode;
  /** Куда уходят все письма в режиме test. */
  testAddress: string;
  /** Окно отправки по местному времени timezone, «ЧЧ:ММ». */
  windowStart: string;
  windowEnd: string;
  timezone: string;
  /** Рабочие дни недели 1 (пн) … 7 (вс) и праздники YYYY-MM-DD. */
  workdays: number[];
  holidays: string[];
  /** Не чаще одного письма в N минут с ящика. */
  minGapMinutes: number;
  /** Случайный разброс времени письма, доля интервала (0,4 = ±40 %). */
  jitter: number;
  /** «Пауза всей рассылки». */
  paused: boolean;
};

export const DEFAULT_MAIL_SETTINGS: MailSettings = {
  mode: "dry_run",
  testAddress: "",
  windowStart: "09:30",
  windowEnd: "17:30",
  timezone: "Europe/Moscow",
  workdays: [1, 2, 3, 4, 5],
  holidays: [],
  minGapMinutes: 4,
  jitter: 0.4,
  paused: false,
};

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function normalizeMailSettings(raw: unknown): MailSettings {
  const src = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out = { ...DEFAULT_MAIL_SETTINGS };
  if (typeof src.mode === "string" && src.mode in MAIL_MODES) out.mode = src.mode as MailMode;
  if (typeof src.testAddress === "string") out.testAddress = src.testAddress.trim().toLowerCase().slice(0, 200);
  if (typeof src.windowStart === "string" && TIME_RE.test(src.windowStart)) out.windowStart = src.windowStart;
  if (typeof src.windowEnd === "string" && TIME_RE.test(src.windowEnd)) out.windowEnd = src.windowEnd;
  if (out.windowEnd <= out.windowStart) out.windowEnd = DEFAULT_MAIL_SETTINGS.windowEnd;
  if (typeof src.timezone === "string" && /^[A-Za-z_]+\/[A-Za-z_]+$/.test(src.timezone)) out.timezone = src.timezone;
  if (Array.isArray(src.workdays)) {
    const days = [...new Set(src.workdays.map(Number).filter((d) => Number.isInteger(d) && d >= 1 && d <= 7))].sort();
    if (days.length) out.workdays = days;
  }
  if (Array.isArray(src.holidays)) out.holidays = src.holidays.filter((d): d is string => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d));
  const num = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" ? Number(v.replace(",", ".")) : NaN);
  if (Number.isFinite(num(src.minGapMinutes)) && num(src.minGapMinutes) >= 1) out.minGapMinutes = Math.min(120, num(src.minGapMinutes));
  if (Number.isFinite(num(src.jitter)) && num(src.jitter) >= 0) out.jitter = Math.min(0.9, num(src.jitter));
  if (typeof src.paused === "boolean") out.paused = src.paused;
  return out;
}

// ── Основной домен — никогда ─────────────────────────────────────────────────

/**
 * tlkbars.ru и его поддомены / адреса (info@tlkbars.ru, www.tlkbars.ru). Холодные домены вида tlkbars-import.ru —
 * можно: после «tlkbars» там дефис, а не «.ru».
 */
const MAIN_DOMAIN_RE = /(?<![a-z0-9-])(?:[a-z0-9-]+\.)*tlkbars\.ru(?![a-z0-9-])/i;

export const mentionsMainDomain = (text: string | null | undefined) => MAIN_DOMAIN_RE.test(String(text ?? ""));

export const MAIN_DOMAIN_ERROR = "Упоминание tlkbars.ru — в рассылке основной домен не используется никогда (только холодные домены)";

// ── Варианты фраз и подстановки ──────────────────────────────────────────────

/** FNV-1a — детерминированный «случай» по строке (тот же лид — тот же вариант). */
export function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

const VARIANT_RE = /\{([^{}|]*\|[^{}]*)\}/g;

/** {вариант 1|вариант 2|…} → один вариант, выбранный по seed. Подстановки без «|» ({brand}) не трогаются. */
export function spin(text: string, seed: string): { text: string; choices: number[] } {
  const choices: number[] = [];
  let i = 0;
  const out = text.replace(VARIANT_RE, (_, inner: string) => {
    const options = inner.split("|");
    const k = hash32(`${seed}#${i++}`) % options.length;
    choices.push(k);
    return options[k];
  });
  return { text: out, choices };
}

/** «Иванов Иван Иванович» → «Иван Иванович»; не удалось уверенно выделить — "". */
export function namePatronymic(fullName: string | null | undefined): string {
  const words = String(fullName ?? "")
    .replace(/^ИП\s+/i, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length < 3 || !words.every((w) => /^[А-ЯЁа-яё-]+$/.test(w))) return "";
  const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
  // Отчество — третье слово; «оглы» / «кызы» — часть отчества.
  const rest = words.slice(1, words.length >= 4 && /^(оглы|кызы|улы|уулу)$/i.test(words[3]) ? 4 : 3);
  if (!/(вич|вна|чна|ична|ович|евич|оглы|кызы|улы|уулу)$/i.test(rest.join(" "))) return "";
  return rest.map((w) => (/^(оглы|кызы|улы|уулу)$/i.test(w) ? w.toLowerCase() : cap(w))).join(" ");
}

export type MailVars = {
  name_patronymic: string;
  brand: string;
  product: string;
  category: string;
  marking_note: string;
  link: string;
  signature: string;
  first_subject: string;
};

/** Подстановки. Нет имени и отчества — обращение без имени: «Добрый день!» / «Напомню о себе…». */
export function fillVars(text: string, v: MailVars): string {
  let out = text;
  if (!v.name_patronymic) {
    out = out
      .replace(/^[^\n]*?,\s*\{name_patronymic\}\s*!/gm, "Добрый день!")
      .replace(/(^|\n)\{name_patronymic\},\s*(\S)/g, (_, pre: string, ch: string) => `${pre}${ch.toUpperCase()}`)
      .replace(/,?\s*\{name_patronymic\}/g, "");
  }
  out = out.replace(/\{(name_patronymic|brand|product|category|marking_note|link|signature|first_subject)\}/g, (_, k: keyof MailVars) => v[k] ?? "");
  // Пустой {marking_note} не оставляет двойных пробелов; лишние пустые строки — убрать.
  return out
    .replace(/[ \t]{2,}/g, " ")
    .replace(/ +\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Неизвестные подстановки, оставшиеся в тексте: {name}, {inn}… — показать в шаблоне как ошибку. */
export function unknownPlaceholders(text: string): string[] {
  const known = new Set(["name_patronymic", "brand", "product", "category", "marking_note", "link", "signature", "first_subject"]);
  return [...new Set([...text.matchAll(/\{([a-z_]+)\}/g)].map((m) => m[1]).filter((k) => !known.has(k)))];
}

export const PLACEHOLDERS: Record<keyof MailVars, string> = {
  name_patronymic: "имя и отчество руководителя (нет — «Добрый день!» без имени)",
  brand: "бренд продавца",
  product: "товар продавца, коротко",
  category: "категория — как в письме («фитнес-инвентаря»)",
  marking_note: "фраза о маркировке из категории",
  link: "персональная ссылка https://<домен ящика>/wb/<категория>?l=<токен>",
  signature: "подпись ящика",
  first_subject: "тема первого письма (для повтора: «Re: {first_subject}»)",
};

// ── Ответы ───────────────────────────────────────────────────────────────────

/** «Похоже на отказ» — по первым строкам ответа (без цитаты). Решает человек. */
export function looksLikeRefusal(text: string): boolean {
  const head = String(text ?? "")
    .split(/\n/)
    .filter((l) => !/^\s*>/.test(l))
    .slice(0, 6)
    .join(" ")
    .toLowerCase();
  return /(^|[^а-яё])нет([^а-яё]|$)|не\s+актуальн|неактуальн|не\s+интересн|неинтересн|отпиш|не\s+пиш|не\s+беспоко|удалите/.test(head);
}

// ── Разнесение писем по окну ─────────────────────────────────────────────────

/**
 * Времена n писем ящика в окне [start, end): равномерно, со случайным сдвигом ±jitter интервала, не чаще minGap.
 * after — уже занятые времена этого ящика (прошлые планы дня): новые не встают ближе minGap к ним.
 * Не влезающие в окно не возвращаются (их переносит планировщик).
 */
export function spreadTimes(n: number, start: number, end: number, opts: { minGapMs: number; jitter: number; rnd?: () => number; busy?: number[] }): number[] {
  const rnd = opts.rnd ?? Math.random;
  if (n <= 0 || end <= start) return [];
  const interval = (end - start) / n;
  const wanted = Array.from({ length: n }, (_, i) => start + interval * (i + 0.5) + (rnd() * 2 - 1) * opts.jitter * interval);
  const busy = [...(opts.busy ?? [])].sort((a, b) => a - b);
  const out: number[] = [];
  for (const w of wanted.sort((a, b) => a - b)) {
    let t = Math.max(start, w, out.length ? out[out.length - 1] + opts.minGapMs : start);
    // Не ближе minGap к уже запланированным письмам ящика.
    for (const b of busy) if (Math.abs(t - b) < opts.minGapMs) t = b + opts.minGapMs;
    if (t >= end) break;
    out.push(Math.round(t));
  }
  return out;
}

// ── Запуск дня и автоматический прогрев ──────────────────────────────────────

export const MAX_MAILBOXES_PER_RUN = 30;
export const WARMUP_INITIAL_LIMIT = 10;
export const WARMUP_DAILY_STEP = 5;

export function normalizeRunMailboxIds(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(Number).filter((id) => Number.isInteger(id) && id > 0))];
}

/** Номер рабочего дня прогрева, начиная с 1. Выходные и праздники лимит не увеличивают. */
export function warmupWorkday(start: string | null, day: string, settings: Pick<MailSettings, "workdays" | "holidays">): number {
  if (!start || !/^\d{4}-\d{2}-\d{2}$/.test(start) || start > day) return 0;
  let n = 0;
  for (let cursor = start; cursor <= day; cursor = addDaysIso(cursor, 1)) {
    if (isWorkday(cursor, settings)) n++;
  }
  return n;
}

/** 10 писем в первый рабочий день, затем +5 каждый рабочий день до целевого лимита. */
export function warmupDailyLimit(target: number, start: string | null, day: string, settings: Pick<MailSettings, "workdays" | "holidays">): number {
  const limit = Math.max(0, target);
  if (!start) return limit;
  const n = warmupWorkday(start, day, settings);
  return n ? Math.min(limit, WARMUP_INITIAL_LIMIT + (n - 1) * WARMUP_DAILY_STEP) : 0;
}

// ── Время в часовом поясе ────────────────────────────────────────────────────

/** Дата YYYY-MM-DD в часовом поясе tz. */
export function dayInZone(at: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

/** Момент «day hh:mm» по часам пояса tz. */
export function zonedTime(day: string, hhmm: string, tz: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  const [hh, mm] = hhmm.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
      .formatToParts(new Date(guess))
      .map((p) => [p.type, p.value]),
  );
  const asTz = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute));
  return new Date(guess - (asTz - guess));
}
