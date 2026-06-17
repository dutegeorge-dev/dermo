/**
 * Sticky-оглавление читательского шаблона (reading.njk).
 *
 * Прогрессивное улучшение: каркас и якорные ссылки работают и без JS, здесь
 * добавляется автоматическое оглавление по разделам страницы.
 *
 *  - строит список из разделов контента (section[id] с заголовком h2/h3);
 *  - порог показа: оглавление выводится только при 3+ разделах (иначе скрыто,
 *    контент занимает основную ширину — без «огрызка»);
 *  - десктоп: правое sticky-оглавление со scroll-spy (активный раздел — бирюза);
 *  - мобайл: «Содержание» сверху раскрывающимся блоком (аккордеон);
 *  - плавная прокрутка к разделу по клику (через нативный якорь + CSS), фокус
 *    переводится на раздел для доступности с клавиатуры.
 */

/** Минимальное число разделов, при котором показываем оглавление. */
const MIN_SECTIONS = 3;

interface TocSection {
  id: string;
  text: string;
}

/** Собирает разделы контента: section[id] + текст его первого заголовка. */
function collectSections(content: HTMLElement): TocSection[] {
  return Array.from(content.querySelectorAll<HTMLElement>("section[id]"))
    .map((section) => {
      const heading = section.querySelector("h2, h3");
      return {
        id: section.id,
        text: (heading?.textContent ?? "").trim(),
      };
    })
    .filter((item) => item.id !== "" && item.text !== "");
}

/** Создаёт пункт оглавления (li + a) с привязкой к разделу. */
function createTocItem(
  section: TocSection,
  variant: "desktop" | "mobile",
): { li: HTMLLIElement; link: HTMLAnchorElement } {
  const li = document.createElement("li");
  const link = document.createElement("a");
  link.href = `#${section.id}`;
  link.textContent = section.text;
  link.dataset.tocLink = section.id;

  if (variant === "desktop") {
    li.className = "-ml-px border-l-2 border-transparent";
    link.className =
      "block py-1 pl-4 text-sm leading-snug text-muted transition-colors hover:text-ink";
  } else {
    li.className = "border-b border-slate-200 last:border-b-0";
    link.className =
      "block py-2.5 text-sm text-muted transition-colors hover:text-ink";
  }

  li.appendChild(link);
  return { li, link };
}

/** Раскрывающийся блок «Содержание» на мобайле (свой аккордеон). */
function initMobileToggle(mobile: HTMLElement): void {
  const toggle = mobile.querySelector<HTMLButtonElement>("[data-toc-mobile-toggle]");
  const panel = mobile.querySelector<HTMLElement>("[data-toc-mobile-panel]");
  if (!toggle || !panel) return;

  toggle.addEventListener("click", () => {
    const open = panel.hasAttribute("hidden");
    panel.toggleAttribute("hidden", !open);
    panel.classList.toggle("hidden", !open);
    toggle.setAttribute("aria-expanded", String(open));
    const caret = toggle.querySelector<SVGElement>(".accordion-caret");
    if (caret) caret.style.transform = open ? "rotate(180deg)" : "";
  });

  // Клик по пункту — сворачиваем блок (на мобайле после перехода к разделу).
  panel.addEventListener("click", (event) => {
    if ((event.target as HTMLElement).closest("a")) {
      panel.setAttribute("hidden", "");
      panel.classList.add("hidden");
      toggle.setAttribute("aria-expanded", "false");
      const caret = toggle.querySelector<SVGElement>(".accordion-caret");
      if (caret) caret.style.transform = "";
    }
  });
}

export function initToc(): void {
  const root = document.querySelector<HTMLElement>("[data-reading]");
  if (!root) return;

  const content = root.querySelector<HTMLElement>("[data-reading-content]");
  if (!content) return;

  const sections = collectSections(content);

  // Порог: меньше 3 разделов — оглавление не выводим, контент во всю колонку.
  if (sections.length < MIN_SECTIONS) return;

  const desktopAside = root.querySelector<HTMLElement>("[data-toc-desktop]");
  const desktopList = desktopAside?.querySelector<HTMLOListElement>("[data-toc-list]");
  const mobile = root.querySelector<HTMLElement>("[data-toc-mobile]");
  const mobileList = mobile?.querySelector<HTMLOListElement>("[data-toc-list]");

  // Все ссылки на раздел (десктоп + мобайл) — для синхронной подсветки.
  const linksById = new Map<string, HTMLAnchorElement[]>();
  const register = (link: HTMLAnchorElement): void => {
    const id = link.dataset.tocLink ?? "";
    const list = linksById.get(id) ?? [];
    list.push(link);
    linksById.set(id, list);
  };

  sections.forEach((section) => {
    if (desktopList) {
      const { li, link } = createTocItem(section, "desktop");
      desktopList.appendChild(li);
      register(link);
    }
    if (mobileList) {
      const { li, link } = createTocItem(section, "mobile");
      mobileList.appendChild(li);
      register(link);
    }
  });

  // Показываем оглавление и убираем центрирование «одинокой» колонки контента.
  // Десктоп-aside остаётся скрытым на мобайле (база hidden), показываем на lg+.
  desktopAside?.classList.add("lg:block");
  mobile?.removeAttribute("hidden");
  content.classList.remove("lg:mx-auto");
  if (mobile) initMobileToggle(mobile);

  // Доступность: раздел можно сфокусировать после перехода по якорю.
  sections.forEach((section) => {
    const el = document.getElementById(section.id);
    if (el && !el.hasAttribute("tabindex")) el.setAttribute("tabindex", "-1");
  });

  // Подсветка активного пункта (scroll-spy).
  const setActive = (activeId: string): void => {
    linksById.forEach((links, id) => {
      const active = id === activeId;
      links.forEach((link) => {
        link.classList.toggle("text-cyan-dark", active);
        link.classList.toggle("font-medium", active);
        link.classList.toggle("text-muted", !active);
        if (active) link.setAttribute("aria-current", "true");
        else link.removeAttribute("aria-current");
        const li = link.parentElement;
        if (li?.classList.contains("border-l-2")) {
          li.classList.toggle("border-cyan", active);
          li.classList.toggle("border-transparent", !active);
        }
      });
    });
  };

  // Перевод фокуса на раздел при клике (плавный скролл — нативный, через href).
  linksById.forEach((links, id) => {
    links.forEach((link) => {
      link.addEventListener("click", () => {
        setActive(id);
        const target = document.getElementById(id);
        // preventScroll — чтобы не перебить плавную прокрутку от якоря.
        target?.focus({ preventScroll: true });
      });
    });
  });

  // Раздел считается активным, когда его верх в верхней зоне вьюпорта.
  const visible = new Set<string>();
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const id = (entry.target as HTMLElement).id;
        if (entry.isIntersecting) visible.add(id);
        else visible.delete(id);
      }
      const active = sections.find((s) => visible.has(s.id));
      if (active) setActive(active.id);
    },
    { rootMargin: "0px 0px -65% 0px", threshold: 0 },
  );

  sections.forEach((section) => {
    const el = document.getElementById(section.id);
    if (el) observer.observe(el);
  });

  // Стартовая подсветка — первый раздел.
  setActive(sections[0].id);
}
