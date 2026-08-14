/**
 * Клиентский скрипт каркаса:
 *  - поведение хедера (мега-меню, мобильная панель, sticky) — модуль ./header;
 *  - отправка форм заявок: клиентская валидация → POST на бэкенд-обработчик
 *    (server/index.ts) → лид в Bitrix24 → событие в аналитику (модуль ./lead).
 */

// Хедер: sticky, мега-меню, off-canvas, аккордеоны (см. ./header.ts).
import "./header";

// Слайдер-карусели (команда на странице «О компании») — см. ./slider.ts.
import "./slider";

// Баннер согласия на cookies (глобальный) — см. ./cookie.ts.
import "./cookie";

// Sticky-оглавление + scroll-spy читательского шаблона — см. ./toc.ts.
import { initToc } from "./toc";

// Калькулятор доставки и таможенных платежей (/calculator/) — см. ./calculator.ts.
import { initCalculator } from "./calculator";

// Отправка заявок на бэкенд — см. ./lead.ts.
import { isValidContact, sendLead, trackEvent } from "./lead";

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
  initCalculator();
});

export {};
