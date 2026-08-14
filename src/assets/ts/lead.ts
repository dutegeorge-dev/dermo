/**
 * Отправка заявок на бэкенд-обработчик (server/index.ts) → лид в Bitrix24.
 *
 * Модуль общий для всех форм сайта: обычные формы заявок (main.ts) и
 * калькулятор доставки (calculator.ts) шлют один и тот же JSON по одному
 * адресу, поэтому UTM-метки, honeypot-поле и разбор ответа живут здесь в
 * одном экземпляре.
 *
 * Адрес эндпоинта приходит из вёрстки: data-lead-endpoint на <html>
 * (значение — site.leadApiUrl, переменная окружения LEAD_API_URL).
 */

// Типизация глобальных функций аналитики (могут отсутствовать в dev).
declare global {
  interface Window {
    ym?: (counterId: number, action: string, target: string) => void;
    gtag?: (command: string, eventName: string, params?: Record<string, unknown>) => void;
  }
}

/** Отправка цели/события в Яндекс.Метрику и GA4, если счётчики подключены. */
export function trackEvent(eventName: string): void {
  const ymId = document.documentElement.dataset.ymId;
  if (window.ym && ymId) {
    window.ym(Number(ymId), "reachGoal", eventName);
  }
  if (window.gtag) {
    window.gtag("event", eventName);
  }
}

/** Простейшая валидация телефона/Telegram. */
export function isValidContact(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length < 5) return false;
  // Телефон (цифры, +, скобки, дефисы, пробелы) или Telegram-ник (@... / t.me/...).
  const phone = /^[+()\d\s-]{5,}$/;
  const telegram = /^@?[\w.]{3,}$|t\.me\//i;
  return phone.test(trimmed) || telegram.test(trimmed);
}

/** UTM-метки, которые передаём в CRM вместе с заявкой. */
const UTM_KEYS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
] as const;

const UTM_STORAGE_KEY = "bars:utm";

/**
 * UTM-метки визита: берём из адреса страницы и запоминаем на сессию —
 * заявку человек часто отправляет уже с другой страницы, без меток в URL.
 */
function collectUtm(): Record<string, string> {
  let stored: Record<string, string> = {};
  try {
    stored = JSON.parse(sessionStorage.getItem(UTM_STORAGE_KEY) ?? "{}") as Record<
      string,
      string
    >;
  } catch {
    stored = {};
  }

  const params = new URLSearchParams(window.location.search);
  const fresh: Record<string, string> = {};
  UTM_KEYS.forEach((key) => {
    const value = params.get(key);
    if (value) fresh[key] = value.slice(0, 200);
  });

  const utm = Object.keys(fresh).length > 0 ? fresh : stored;

  if (Object.keys(fresh).length > 0) {
    try {
      sessionStorage.setItem(UTM_STORAGE_KEY, JSON.stringify(fresh));
    } catch {
      // Приватный режим браузера — метки просто не сохранятся.
    }
  }

  return utm;
}

/** Ответ бэкенда заявок. */
export interface LeadResponse {
  ok?: boolean;
  leadId?: number | null;
  error?: string;
  fields?: Record<string, string>;
}

/**
 * Отправляет заявку на бэкенд. Бросает исключение, если заявка не принята.
 * `extra` — дополнительные данные формы (например, расчёт калькулятора).
 */
export async function sendLead(
  form: HTMLFormElement,
  extra: Record<string, unknown> = {},
): Promise<LeadResponse> {
  const endpoint = document.documentElement.dataset.leadEndpoint || "/api/lead";
  const data = new FormData(form);

  const payload: Record<string, unknown> = {
    form: form.dataset.leadForm || "lead",
    page: window.location.href,
    referrer: document.referrer,
    locale: document.documentElement.lang || "ru",
    utm: collectUtm(),
    consent: form.querySelector<HTMLInputElement>("[data-consent]")?.checked ?? true,
  };

  // Поля формы (cargo, volume, contact, honeypot company, …) — как есть.
  data.forEach((value, key) => {
    if (typeof value === "string" && key !== "consent") payload[key] = value;
  });

  // Данные калькулятора кладём последними: они не должны затираться полями,
  // попавшими в форму под тем же именем.
  Object.assign(payload, extra);

  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });

  const result = (await response.json().catch(() => ({}))) as LeadResponse;

  if (!response.ok || result.ok !== true) {
    throw new Error(result.error || `HTTP ${response.status}`);
  }

  return result;
}
