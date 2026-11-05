/**
 * Лидогенерация WB: общие типы, настройки по умолчанию и чистые функции (нормализация контактов, первая строка
 * письма, раскладка по рабочим дням). Импортируется и сервером, и фронтом — без зависимостей.
 */

/** Право на раздел «Лидогенерация» (users.permissions). Админу доступно всегда. */
export const LEADGEN_PERMISSION = "leadgen";

/** Права, которые можно выдать сотруднику (users.permissions). */
export const PERMISSIONS: Record<string, string> = {
  [LEADGEN_PERMISSION]: "Лидогенерация WB",
};

export type LeadgenSettings = {
  /** Страниц выдачи WB на один поисковый запрос (сбор с сервера). */
  searchPages: number;
  /** Товаров на запрос при сборе расширением: WB не листает выдачу по страницам, только подгружает при прокрутке. */
  browserProducts: number;
  /** Пауза расширения между страницами WB, секунд: от и до. */
  browserDelayMin: number;
  browserDelayMax: number;
  /** Сколько карточек продавца смотреть для «Страны производства». */
  cardsSample: number;
  /** Минимум карточек с указанной страной, чтобы считать долю. */
  minCountryCards: number;
  /** Доля карточек «Китай», 0…1. */
  chinaShareMin: number;
  skuMin: number;
  skuMax: number;
  feedbacksMin: number;
  feedbacksMax: number;
  /** Возраст юрлица / ИП не меньше, месяцев. */
  minAgeMonths: number;
  /** Пул с запасом: прошедших фильтры набираем квота × poolFactor, контакты ищем по пулу. */
  poolFactor: number;
  /** Квота категории по умолчанию (новая категория). */
  defaultQuota: number;
  /** Продавцов в день (первое касание). */
  perDay: number;
  /** Рабочие дни недели: 1 — понедельник … 7 — воскресенье. */
  workdays: number[];
  /** Праздники и выходные вне графика, YYYY-MM-DD. */
  holidays: string[];
  /** Повтор через N дней после первого письма, если нет ответа. */
  followupDays: number;
  /** Пауза между запросами к WB, мс, и случайная добавка к ней. */
  wbDelayMs: number;
  wbJitterMs: number;
  /** Пауза между запросами к DaData / Checko / сайтам, мс. */
  apiDelayMs: number;
};

export const DEFAULT_LEADGEN_SETTINGS: LeadgenSettings = {
  searchPages: 20,
  browserProducts: 300,
  browserDelayMin: 6,
  browserDelayMax: 15,
  cardsSample: 20,
  minCountryCards: 5,
  chinaShareMin: 0,
  skuMin: 50,
  skuMax: 1500,
  feedbacksMin: 1000,
  feedbacksMax: 50000,
  minAgeMonths: 12,
  poolFactor: 1.6,
  defaultQuota: 150,
  perDay: 30,
  workdays: [1, 2, 3, 4, 5],
  holidays: [],
  followupDays: 4,
  wbDelayMs: 400,
  wbJitterMs: 400,
  apiDelayMs: 150,
};

/** Подписи порогов для страницы настроек (ключ → подпись, подсказка). */
export const SETTINGS_FIELDS: { key: keyof LeadgenSettings; label: string; hint?: string; step?: number }[] = [
  { key: "browserProducts", label: "Товаров на запрос (браузер)", hint: "прокрутка выдачи" },
  { key: "browserDelayMin", label: "Пауза браузера, с, от" },
  { key: "browserDelayMax", label: "Пауза браузера, с, до" },
  { key: "searchPages", label: "Страниц выдачи на запрос (сервер)" },
  { key: "cardsSample", label: "Карточек на продавца (страна)" },
  { key: "minCountryCards", label: "Минимум карточек со страной" },
  { key: "chinaShareMin", label: "Доля «Китай» не меньше", hint: "0 — не проверять; 0,7 = 70 %", step: 0.05 },
  { key: "skuMin", label: "SKU от" },
  { key: "skuMax", label: "SKU до" },
  { key: "feedbacksMin", label: "Отзывов от" },
  { key: "feedbacksMax", label: "Отзывов до" },
  { key: "minAgeMonths", label: "Возраст компании, мес. от" },
  { key: "poolFactor", label: "Запас пула × квота", step: 0.1 },
  { key: "defaultQuota", label: "Квота новой категории" },
  { key: "perDay", label: "Продавцов в день" },
  { key: "followupDays", label: "Повтор через, дней" },
  { key: "wbDelayMs", label: "Пауза WB, мс" },
  { key: "wbJitterMs", label: "Случайная добавка WB, мс" },
  { key: "apiDelayMs", label: "Пауза DaData / Checko, мс" },
];

export function normalizeSettings(raw: unknown): LeadgenSettings {
  const src = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out = { ...DEFAULT_LEADGEN_SETTINGS };
  for (const key of Object.keys(DEFAULT_LEADGEN_SETTINGS) as (keyof LeadgenSettings)[]) {
    const def = DEFAULT_LEADGEN_SETTINGS[key];
    const v = src[key];
    if (typeof def === "number") {
      const n = typeof v === "string" ? Number(v.replace(",", ".")) : v;
      if (typeof n === "number" && Number.isFinite(n) && n >= 0) (out as Record<string, unknown>)[key] = n;
    }
  }
  if (Array.isArray(src.workdays)) {
    const days = [...new Set(src.workdays.map(Number).filter((d) => Number.isInteger(d) && d >= 1 && d <= 7))].sort();
    if (days.length) out.workdays = days;
  }
  if (Array.isArray(src.holidays)) out.holidays = src.holidays.filter((d): d is string => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d));
  out.chinaShareMin = Math.min(1, out.chinaShareMin);
  out.poolFactor = Math.max(1, out.poolFactor);
  out.searchPages = Math.max(1, Math.round(out.searchPages));
  out.browserProducts = Math.min(1000, Math.max(20, Math.round(out.browserProducts)));
  out.browserDelayMin = Math.max(3, out.browserDelayMin);
  out.browserDelayMax = Math.max(out.browserDelayMin, out.browserDelayMax);
  out.perDay = Math.max(1, Math.round(out.perDay));
  return out;
}

// ── Статусы ──────────────────────────────────────────────────────────────────

/** Статус продавца в работе (lead_sellers.status). */
export const SELLER_STATUSES = {
  new: { label: "Не писали", color: "slate" },
  sent: { label: "Написал", color: "blue" },
  followup_sent: { label: "Повтор отправлен", color: "indigo" },
  replied_pos: { label: "Ответил +", color: "green" },
  replied_neg: { label: "Ответил −", color: "amber" },
  bounced: { label: "Возврат / ошибка", color: "red" },
  do_not_contact: { label: "Не писать", color: "neutral" },
} as const;
export type SellerStatus = keyof typeof SELLER_STATUSES;

/** Кнопки статуса в «Сегодня» (порядок). */
export const STATUS_ACTIONS: SellerStatus[] = ["sent", "followup_sent", "replied_pos", "replied_neg", "bounced", "do_not_contact"];

export const JOB_STATUSES = {
  queued: "В очереди",
  running: "Идёт",
  collecting: "Ждёт сборщик в браузере",
  stopping: "Останавливается",
  paused: "Остановлена",
  failed: "Ошибка — можно продолжить",
  done: "Готово",
} as const;
export type JobStatus = keyof typeof JOB_STATUSES;

/** Откуда берётся выдача WB: расширение в браузере сотрудника или запросы с сервера (нужен доступ к API WB). */
export const JOB_SOURCES = {
  browser: "Расширение в браузере",
  direct: "С сервера",
} as const;
export type JobSource = keyof typeof JOB_SOURCES;

export const JOB_STAGES = {
  collect: "Сбор продавцов с WB",
  filter: "Фильтры, реквизиты и контакты",
  schedule: "Раскладка на месяц",
  done: "Готово",
} as const;
export type JobStage = keyof typeof JOB_STAGES;

/** Счётчики прогресса по категории. */
export type CategoryProgress = {
  name: string;
  quota: number;
  /** Пройдено поисковых запросов / страниц. */
  queriesDone: number;
  queriesTotal: number;
  /** Найдено продавцов в выдаче. */
  collected: number;
  /** Проверено фильтрами. */
  checked: number;
  /** Прошли все фильтры (WB + DaData). */
  passed: number;
  /** Нашлись контакты. */
  withContacts: number;
  /** Отобрано в базу. */
  selected: number;
  /** Сбор в браузере: ждут, пока расширение откроет страницу продавца. */
  waiting?: number;
  /** Причины отсева: причина → сколько. */
  rejected: Record<string, number>;
};

export type JobProgress = {
  categories: Record<string, CategoryProgress>;
  requests: { wb: number; dadata: number; checko: number; site: number };
  scheduled?: { sellers: number; from: string; to: string };
};

export type JobError = { at: string; stage: string; message: string };

export type ContactType = "phone" | "email" | "site";
export type ContactSource = "wb" | "checko" | "site";

export const CONTACT_SOURCES: Record<ContactSource, string> = { wb: "WB", checko: "Checko", site: "сайт" };

export type ProductSample = { nm: number; name: string; url: string };

// ── Контакты ─────────────────────────────────────────────────────────────────

/** Телефон → +7XXXXXXXXXX; маскированный, иностранный или неполный — null. */
export function normalizePhone(raw: string): string | null {
  const s = String(raw ?? "").trim();
  if (!s || /[*xх•]/i.test(s.replace(/доб\.?.*$/i, ""))) return null;
  const main = s.replace(/(доб\.?|ext\.?|\bвн\.?).*$/i, "");
  let d = main.replace(/\D/g, "");
  if (d.length === 11 && (d[0] === "7" || d[0] === "8")) d = d.slice(1);
  if (d.length !== 10 || !/^[3489]/.test(d)) return null;
  return `+7${d}`;
}

const EMAIL_RE = /^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,24}$/;

/** Email → нижний регистр без пробелов и «mailto:»; null, если пусто. */
export function normalizeEmail(raw: string): string | null {
  const s = String(raw ?? "")
    .trim()
    .replace(/^mailto:/i, "")
    .replace(/[\s<>"']/g, "")
    .replace(/[.,;:]+$/, "")
    .toLowerCase();
  return s || null;
}

export const emailSyntaxOk = (email: string) => EMAIL_RE.test(email) && !email.includes("..");

/** Сайт → https://host/ (без путей); null, если не похоже на адрес. */
export function normalizeSite(raw: string): string | null {
  let s = String(raw ?? "").trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  try {
    const u = new URL(s);
    if (!/\.[a-zа-я]{2,}$/i.test(u.hostname)) return null;
    return `${u.protocol}//${u.hostname.toLowerCase()}/`;
  } catch {
    return null;
  }
}

/** Российский ИНН: 10 цифр — организация, 12 — ИП (с проверкой контрольных цифр). */
export function innKind(raw: string | null | undefined): "ul" | "ip" | null {
  const inn = String(raw ?? "").replace(/\D/g, "");
  const n = [...inn].map(Number);
  const check = (w: number[]) => (w.reduce((s, k, i) => s + k * n[i], 0) % 11) % 10;
  if (inn.length === 10 && !/^0{10}$/.test(inn)) return check([2, 4, 10, 3, 5, 9, 4, 6, 8]) === n[9] ? "ul" : null;
  if (inn.length === 12 && !/^0{12}$/.test(inn)) {
    return check([7, 2, 4, 10, 3, 5, 9, 4, 6, 8]) === n[10] && check([3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8]) === n[11] ? "ip" : null;
  }
  return null;
}

// ── Первая строка письма ─────────────────────────────────────────────────────

export const TEMPLATE_MARKING =
  "Видел ваши {product} под брендом {brand} на WB. С 1 декабря такие товары ввозятся только с кодами Честного знака — мы наносим их на фабрике в Китае и ввозим под своим контрактом с полным пакетом документов.";
export const TEMPLATE_PLAIN =
  "Видел ваши {product} под брендом {brand} на WB. Мы ввозим такие товары из Китая по-белому под своим контрактом: документы для маркетплейса, НДС к вычету, без рисков карго.";

const NOISE_WORDS = new Set(["набор", "комплект", "новинка", "хит", "для", "и", "с", "в", "на", "из", "от", "по", "шт", "штук", "см", "мм", "м", "л", "мл", "кг", "г"]);

/**
 * Название товара → суть в 1–3 слова: без бренда, размеров, цифр, скобок и хвоста после запятой / тире.
 * «Сковорода антипригарная 28 см с крышкой, Tefal» → «сковорода антипригарная».
 */
export function shortProduct(name: string, brand = ""): string {
  let s = String(name ?? "")
    .replace(/\([^)]*\)|\[[^\]]*\]/g, " ")
    .split(/[,;/|]|\s[-–—]\s/)[0];
  if (brand.trim()) s = s.replace(new RegExp(brand.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), " ");
  const words = s
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/\s+/)
    .filter((w) => w && !/\d/.test(w) && /\p{Script=Cyrillic}/u.test(w));
  const out: string[] = [];
  for (const w of words) {
    const lw = w.toLowerCase();
    if (out.length === 0 && NOISE_WORDS.has(lw)) continue;
    if (NOISE_WORDS.has(lw)) break;
    out.push(lw);
    if (out.length === 3) break;
  }
  return out.join(" ") || String(name ?? "").trim().toLowerCase().slice(0, 40);
}

export function renderFirstLine(template: string, vars: { brand: string; product: string }): string {
  return template.replace(/\{brand\}/g, vars.brand || "вашим брендом").replace(/\{product\}/g, vars.product || "товары").replace(/\s+/g, " ").trim();
}

// ── Даты и раскладка ─────────────────────────────────────────────────────────

export const isoDay = (d: Date) => d.toISOString().slice(0, 10);

export function addDaysIso(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return isoDay(d);
}

/** День недели 1 (пн) … 7 (вс). */
export const weekday = (day: string) => ((new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;

export function isWorkday(day: string, s: Pick<LeadgenSettings, "workdays" | "holidays">): boolean {
  return s.workdays.includes(weekday(day)) && !s.holidays.includes(day);
}

/** Ближайший рабочий день, начиная с day (включительно). */
export function nextWorkday(day: string, s: Pick<LeadgenSettings, "workdays" | "holidays">): string {
  let d = day;
  for (let i = 0; i < 370 && !isWorkday(d, s); i++) d = addDaysIso(d, 1);
  return d;
}

/** Месяц YYYY-MM → первый день; null — некорректный. */
export function monthStart(month: string): string | null {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? `${month}-01` : null;
}

/**
 * Перемешать категории: списки продавцов по категориям → один список, где подряд идут разные категории
 * (по кругу, каждая категория — в своём случайном порядке). Так в каждом дне — смесь.
 */
export function interleave<T>(groups: T[][]): T[] {
  const out: T[] = [];
  const max = Math.max(0, ...groups.map((g) => g.length));
  for (let i = 0; i < max; i++) for (const g of groups) if (i < g.length) out.push(g[i]);
  return out;
}

/** Разложить n продавцов по рабочим дням начиная с start: perDay в день. Возвращает дату для каждого. */
export function planDays(n: number, start: string, s: Pick<LeadgenSettings, "workdays" | "holidays" | "perDay">): string[] {
  const out: string[] = [];
  let day = nextWorkday(start, s);
  for (let i = 0; i < n; i++) {
    if (i > 0 && i % s.perDay === 0) day = nextWorkday(addDaysIso(day, 1), s);
    out.push(day);
  }
  return out;
}

/** Перемешивание Фишера — Йетса (rnd — для воспроизводимости в тестах). */
export function shuffle<T>(list: T[], rnd: () => number = Math.random): T[] {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export const pct = (part: number, total: number) => (total > 0 ? Math.round((part / total) * 1000) / 10 : 0);
