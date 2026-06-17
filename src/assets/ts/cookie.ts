/**
 * Баннер согласия на cookies.
 *
 * Баннер отрендерен скрытым (атрибут hidden + классы для анимации снизу).
 * При загрузке: если согласие ещё не сохранено — показываем баннер.
 * По кнопке «Принять» — сохраняем факт согласия и прячем баннер; повторно
 * он не появляется. Хранилище: localStorage с фолбэком на cookie (на случай
 * приватного режима, где localStorage может бросать исключение).
 */
const STORAGE_KEY = "cookie_consent";
const STORAGE_VALUE = "accepted";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 год

/** Прочитать факт согласия (localStorage → cookie). */
function hasConsent(): boolean {
  try {
    if (window.localStorage.getItem(STORAGE_KEY) === STORAGE_VALUE) return true;
  } catch {
    // localStorage недоступен — проверяем cookie ниже.
  }
  return document.cookie
    .split(";")
    .some((c) => c.trim() === `${STORAGE_KEY}=${STORAGE_VALUE}`);
}

/** Сохранить факт согласия (localStorage + cookie). */
function saveConsent(): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, STORAGE_VALUE);
  } catch {
    // Игнорируем — ниже всё равно ставим cookie.
  }
  document.cookie = `${STORAGE_KEY}=${STORAGE_VALUE}; path=/; max-age=${COOKIE_MAX_AGE}; SameSite=Lax`;
}

function initCookieBanner(): void {
  const banner = document.querySelector<HTMLElement>("[data-cookie-banner]");
  if (!banner) return;
  if (hasConsent()) return;

  const accept = banner.querySelector<HTMLButtonElement>("[data-cookie-accept]");

  // Показ: снимаем hidden, затем на следующем кадре убираем классы сдвига/прозрачности.
  banner.hidden = false;
  window.requestAnimationFrame(() => {
    banner.classList.remove("translate-y-full", "opacity-0");
  });

  // Скрытие после согласия: анимируем вниз и убираем из потока после перехода.
  const hide = (): void => {
    banner.classList.add("translate-y-full", "opacity-0");
    banner.addEventListener(
      "transitionend",
      () => {
        banner.hidden = true;
      },
      { once: true },
    );
  };

  accept?.addEventListener("click", () => {
    saveConsent();
    hide();
  });
}

document.addEventListener("DOMContentLoaded", initCookieBanner);

export {};
