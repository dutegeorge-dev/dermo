/**
 * Поведение хедера (прогрессивное улучшение).
 * Десктоп-hover мега-меню работает на чистом CSS; здесь добавляются:
 *  - sticky-логика (сворачивание utility-полосы при скролле);
 *  - мега-меню по клику/тапу + Esc + клик-вне + клавиатура;
 *  - мобильная off-canvas панель (бургер, оверлей, блокировка скролла, Esc);
 *  - аккордеоны внутри мобильной панели.
 */

/** Ярус 1 сворачивается, когда страница прокручена от самого верха. */
function initStickyHeader(): void {
  const header = document.querySelector<HTMLElement>("[data-header]");
  if (!header) return;

  // Гистерезис: сворачиваем ниже COLLAPSE_AT, разворачиваем только у самого
  // верха (EXPAND_AT). Мёртвая зона между порогами шире высоты utility-полосы —
  // иначе изменение высоты хедера (scroll anchoring) возвращает scrollY за порог
  // и состояние «дрожит». Внутри зоны состояние не меняется.
  const COLLAPSE_AT = 64;
  const EXPAND_AT = 8;
  let ticking = false;

  const update = (): void => {
    const y = window.scrollY;
    const collapsed = header.dataset.scrolled === "true";
    if (!collapsed && y > COLLAPSE_AT) {
      header.dataset.scrolled = "true";
    } else if (collapsed && y < EXPAND_AT) {
      header.dataset.scrolled = "false";
    }
    ticking = false;
  };

  window.addEventListener(
    "scroll",
    () => {
      if (!ticking) {
        window.requestAnimationFrame(update);
        ticking = true;
      }
    },
    { passive: true },
  );

  header.dataset.scrolled = window.scrollY > COLLAPSE_AT ? "true" : "false";
}

/** Мега-меню «Услуги»: тап/клик-переключение, Esc и клик-вне (hover — на CSS). */
function initMegaMenu(): void {
  const mega = document.querySelector<HTMLElement>("[data-mega]");
  const toggle = mega?.querySelector<HTMLButtonElement>("[data-mega-toggle]");
  if (!mega || !toggle) return;

  const setOpen = (open: boolean): void => {
    mega.dataset.open = open ? "true" : "false";
    toggle.setAttribute("aria-expanded", String(open));
  };

  toggle.addEventListener("click", () => {
    setOpen(mega.dataset.open !== "true");
  });

  document.addEventListener("click", (event) => {
    if (mega.dataset.open === "true" && !mega.contains(event.target as Node)) {
      setOpen(false);
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && mega.dataset.open === "true") {
      setOpen(false);
      toggle.focus();
    }
  });

  // Закрываем, когда фокус по Tab уходит за пределы пункта меню.
  mega.addEventListener("focusout", (event) => {
    const next = event.relatedTarget as Node | null;
    if (mega.dataset.open === "true" && (!next || !mega.contains(next))) {
      setOpen(false);
    }
  });
}

/** Универсальные аккордеоны: кнопка переключает следующий [data-accordion-panel]. */
function initAccordions(): void {
  const toggles = document.querySelectorAll<HTMLButtonElement>(
    "[data-accordion-toggle]",
  );
  toggles.forEach((toggle) => {
    const panel = toggle.nextElementSibling as HTMLElement | null;
    if (!panel || !panel.hasAttribute("data-accordion-panel")) return;

    toggle.addEventListener("click", () => {
      const open = panel.hasAttribute("hidden");
      panel.toggleAttribute("hidden", !open);
      panel.classList.toggle("hidden", !open);
      toggle.setAttribute("aria-expanded", String(open));
      const caret = toggle.querySelector<SVGElement>(".accordion-caret");
      if (caret) caret.style.transform = open ? "rotate(180deg)" : "";
    });
  });
}

/** Мобильная off-canvas панель: бургер, оверлей, блокировка скролла, Esc, фокус. */
function initMobilePanel(): void {
  const toggle = document.querySelector<HTMLButtonElement>("[data-menu-toggle]");
  const closeBtn = document.querySelector<HTMLButtonElement>("[data-menu-close]");
  const panel = document.querySelector<HTMLElement>("[data-mobile-panel]");
  const overlay = document.querySelector<HTMLElement>("[data-mobile-overlay]");
  if (!toggle || !panel || !overlay) return;

  const open = (): void => {
    panel.classList.remove("translate-x-full");
    panel.setAttribute("aria-hidden", "false");
    overlay.removeAttribute("hidden");
    // Двойной rAF, чтобы сработал transition прозрачности после снятия hidden.
    window.requestAnimationFrame(() => {
      overlay.classList.remove("invisible", "opacity-0");
    });
    toggle.setAttribute("aria-expanded", "true");
    document.body.style.overflow = "hidden";
    closeBtn?.focus();
  };

  const close = (): void => {
    panel.classList.add("translate-x-full");
    panel.setAttribute("aria-hidden", "true");
    overlay.classList.add("invisible", "opacity-0");
    toggle.setAttribute("aria-expanded", "false");
    document.body.style.overflow = "";
    toggle.focus();
  };

  // Снимаем оверлей из потока после завершения анимации закрытия.
  overlay.addEventListener("transitionend", () => {
    if (overlay.classList.contains("invisible")) overlay.setAttribute("hidden", "");
  });

  toggle.addEventListener("click", open);
  closeBtn?.addEventListener("click", close);
  overlay.addEventListener("click", close);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && panel.getAttribute("aria-hidden") === "false") {
      close();
    }
  });
}

document.addEventListener("DOMContentLoaded", () => {
  initStickyHeader();
  initMegaMenu();
  initAccordions();
  initMobilePanel();
});

export {};
