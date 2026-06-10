/**
 * Оглавление страницы (sticky-ToC) — прогрессивное улучшение.
 *  - плавная прокрутка к секции по клику (с учётом prefers-reduced-motion);
 *  - scroll-spy: подсветка активного пункта по мере прокрутки (бирюза).
 * Работает с любым числом контейнеров [data-toc] (фиксированный сайдбар +
 * свёрнутое «Содержание» на мобайле). Ссылки — обычные <a href="#id">,
 * поэтому клавиатура и переход работают и без JS.
 */
function initToc(): void {
  const navs = document.querySelectorAll<HTMLElement>("[data-toc]");
  if (!navs.length) return;

  // id секции → все ссылки на неё (в разных ToC-контейнерах).
  const linksById = new Map<string, HTMLAnchorElement[]>();
  const targets = new Set<HTMLElement>();

  const reduceMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;

  navs.forEach((nav) => {
    nav.querySelectorAll<HTMLAnchorElement>('a[href^="#"]').forEach((link) => {
      const id = decodeURIComponent(link.hash.slice(1));
      const target = id ? document.getElementById(id) : null;
      if (!target) return;

      if (!linksById.has(id)) linksById.set(id, []);
      linksById.get(id)?.push(link);
      targets.add(target);

      link.addEventListener("click", (event) => {
        event.preventDefault();
        target.scrollIntoView({
          behavior: reduceMotion ? "auto" : "smooth",
          block: "start",
        });
        history.replaceState(null, "", link.hash);
      });
    });
  });

  if (!targets.size) return;

  const setActive = (id: string): void => {
    linksById.forEach((links, key) => {
      const on = key === id;
      links.forEach((link) => {
        link.classList.toggle("text-cyan", on);
        link.classList.toggle("border-cyan", on);
        link.classList.toggle("text-muted", !on);
        link.classList.toggle("border-transparent", !on);
        if (on) link.setAttribute("aria-current", "true");
        else link.removeAttribute("aria-current");
      });
    });
  };

  // Активным считаем верхнюю секцию в «читаемой» зоне (верхняя треть экрана).
  const observer = new IntersectionObserver(
    (entries) => {
      const visible = entries
        .filter((e) => e.isIntersecting)
        .sort(
          (a, b) => a.boundingClientRect.top - b.boundingClientRect.top,
        );
      if (visible[0]) setActive((visible[0].target as HTMLElement).id);
    },
    { rootMargin: "-25% 0px -65% 0px", threshold: 0 },
  );

  targets.forEach((target) => observer.observe(target));
}

document.addEventListener("DOMContentLoaded", initToc);

export {};
