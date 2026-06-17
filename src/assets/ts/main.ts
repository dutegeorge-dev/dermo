/**
 * Клиентский скрипт каркаса:
 *  - поведение хедера (мега-меню, мобильная панель, sticky) — модуль ./header;
 *  - заглушка отправки форм заявок (клиентская валидация + событие в аналитику).
 *
 * Реального сабмита на бэкенд здесь НЕТ — это визуальная заглушка.
 */

// Хедер: sticky, мега-меню, off-canvas, аккордеоны (см. ./header.ts).
import "./header";

// Слайдер-карусели (команда на странице «О компании») — см. ./slider.ts.
import "./slider";

// Баннер согласия на cookies (глобальный) — см. ./cookie.ts.
import "./cookie";

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

/**
 * Инициализация форм-заглушек.
 * TODO(integration): здесь позже подключится реальный обработчик
 * (Netlify Forms / Formspree / собственный эндпоинт). Выбор провайдера отложен.
 */
function initForms(): void {
  const forms = document.querySelectorAll<HTMLFormElement>("[data-lead-form]");

  forms.forEach((form) => {
    const success = form.querySelector<HTMLElement>("[data-form-success]");

    // Согласие на обработку ПДн (152-ФЗ): если чекбокс есть, кнопка отправки
    // блокируется до его отметки. Состояние синхронизируется на старте и по change.
    const consent = form.querySelector<HTMLInputElement>("[data-consent]");
    const submitBtn = form.querySelector<HTMLButtonElement>('button[type="submit"]');
    const consentError = form.querySelector<HTMLElement>('[data-error-for="consent"]');

    const syncConsent = (): void => {
      if (consent && submitBtn) submitBtn.disabled = !consent.checked;
    };
    if (consent) {
      syncConsent();
      consent.addEventListener("change", () => {
        syncConsent();
        if (consent.checked) consentError?.classList.add("hidden");
      });
    }

    form.addEventListener("submit", (event) => {
      event.preventDefault();

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
      if (consent && !consent.checked) {
        valid = false;
        consent.setAttribute("aria-invalid", "true");
        consentError?.classList.remove("hidden");
      } else {
        consent?.removeAttribute("aria-invalid");
        consentError?.classList.add("hidden");
      }

      if (!valid) return;

      // Заглушка «отправки»: показываем подтверждение и шлём событие в аналитику.
      trackEvent("lead_form_submit");

      if (success) {
        success.classList.remove("hidden");
      }
      form.reset();
      // reset() снимает отметку согласия — снова блокируем кнопку отправки.
      syncConsent();
    });
  });
}

document.addEventListener("DOMContentLoaded", () => {
  initForms();
});

export {};
