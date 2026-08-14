/**
 * Клиентский скрипт каркаса:
 *  - поведение хедера (мега-меню, мобильная панель, sticky) — модуль ./header;
 *  - отправка форм заявок: клиентская валидация → POST на бэкенд-обработчик
 *    (server/index.ts) → лид в Bitrix24 → событие в аналитику.
 *
 * Адрес эндпоинта приходит из вёрстки: data-lead-endpoint на <html>
 * (значение — site.leadApiUrl, переменная окружения LEAD_API_URL).
 */

// Хедер: sticky, мега-меню, off-canvas, аккордеоны (см. ./header.ts).
import "./header";

// Слайдер-карусели (команда на странице «О компании») — см. ./slider.ts.
import "./slider";

// Баннер согласия на cookies (глобальный) — см. ./cookie.ts.
import "./cookie";

// Sticky-оглавление + scroll-spy читательского шаблона — см. ./toc.ts.
import { initToc } from "./toc";

// Типизация глобальных функций аналитики (могут отсутствовать в dev).
declare global {
  interface Window {
    ym?: (counterId: number, action: string, target: string) => void;
    gtag?: (command: string, eventName: string, params?: Record<string, unknown>) => void;
  }
}

/** Отправка цели/события в Яндекс.Метрику и GA4, если счётчики подключены. */
function trackEvent(eventName: string): void {
  const ymId = document.documentElement.dataset.ymId;
  if (window.ym && ymId) {
    window.ym(Number(ymId), "reachGoal", eventName);
  }
  if (window.gtag) {
    window.gtag("event", eventName);
  }
}

/** Простейшая валидация телефона/Telegram. */
function isValidContact(value: string): boolean {
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
interface LeadResponse {
  ok?: boolean;
  leadId?: number | null;
  error?: string;
  fields?: Record<string, string>;
}

/** Отправляет заявку на бэкенд. Бросает исключение, если заявка не принята. */
async function sendLead(form: HTMLFormElement): Promise<LeadResponse> {
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

/** Инициализация форм заявок: валидация, отправка на бэкенд, состояния. */
function initForms(): void {
  const forms = document.querySelectorAll<HTMLFormElement>("[data-lead-form]");

  forms.forEach((form) => {
    const success = form.querySelector<HTMLElement>("[data-form-success]");
    const failure = form.querySelector<HTMLElement>("[data-form-error]");

    // Согласие на обработку ПДн (152-ФЗ) обязательно, но кнопку отправки оно
    // НЕ блокирует: заблокированная кнопка молча ничего не делает, и человек,
    // не заметивший чекбокс, просто уходит со страницы. Вместо этого форма по
    // клику показывает, чего не хватает (см. проверку в обработчике submit).
    const consent = form.querySelector<HTMLInputElement>("[data-consent]");
    const submitBtn = form.querySelector<HTMLButtonElement>('button[type="submit"]');
    const consentError = form.querySelector<HTMLElement>('[data-error-for="consent"]');

    consent?.addEventListener("change", () => {
      if (consent.checked) {
        consent.removeAttribute("aria-invalid");
        consentError?.classList.add("hidden");
      }
    });

    form.addEventListener("submit", (event) => {
      event.preventDefault();

      // Повторный сабмит, пока запрос в полёте, создал бы дубль лида.
      if (form.dataset.sending === "true") return;

      let valid = true;
      const fields = form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
        "[data-validate]",
      );

      fields.forEach((field) => {
        const errorEl = form.querySelector<HTMLElement>(
          `[data-error-for="${field.name}"]`,
        );
        const value = field.value.trim();
        let fieldValid = value.length > 0;

        if (fieldValid && field.dataset.validate === "contact") {
          fieldValid = isValidContact(value);
        }

        if (!fieldValid) {
          valid = false;
          field.setAttribute("aria-invalid", "true");
          errorEl?.classList.remove("hidden");
        } else {
          field.removeAttribute("aria-invalid");
          errorEl?.classList.add("hidden");
        }
      });

      // Согласие обязательно, если чекбокс присутствует в форме.
      const consentMissing = Boolean(consent && !consent.checked);
      if (consentMissing && consent) {
        valid = false;
        consent.setAttribute("aria-invalid", "true");
        consentError?.classList.remove("hidden");
      } else {
        consent?.removeAttribute("aria-invalid");
        consentError?.classList.add("hidden");
      }

      if (!valid) {
        // Уводим фокус на первую проблему, иначе на длинной форме подсказка
        // может оказаться за пределами экрана и клик снова выглядит «пустым».
        const firstInvalid = form.querySelector<HTMLElement>('[aria-invalid="true"]');
        firstInvalid?.focus({ preventScroll: true });
        firstInvalid?.scrollIntoView({ block: "center", behavior: "smooth" });
        return;
      }

      // ── Отправка на бэкенд ───────────────────────────────────────────────
      failure?.classList.add("hidden");
      success?.classList.add("hidden");

      form.dataset.sending = "true";
      const idleLabel = submitBtn?.textContent ?? "";
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent =
          document.documentElement.dataset.formSending || "Отправляем…";
      }

      void sendLead(form)
        .then(() => {
          trackEvent("lead_form_submit");
          success?.classList.remove("hidden");
          form.reset();
        })
        .catch((error: unknown) => {
          console.error("Не удалось отправить заявку:", error);
          failure?.classList.remove("hidden");
        })
        .finally(() => {
          delete form.dataset.sending;
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = idleLabel;
          }
        });
    });
  });
}

document.addEventListener("DOMContentLoaded", () => {
  initForms();
  initToc();
});

export {};
