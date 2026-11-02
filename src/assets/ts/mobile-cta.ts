/**
 * Закреплённая панель «Позвонить / Telegram / Рассчитать» на телефоне
 * (/logistika/, разметка — [data-mobile-cta] в pages/logistika.njk).
 *
 * Видна, только когда одновременно:
 *  - форма первого экрана ([data-mobile-cta-start]) целиком ушла за верхний край;
 *  - на экран ещё не вышел блок «Как с нами связаться» (первый
 *    [data-mobile-cta-stop]) — с него и ниже (финальный CTA, подвал) у человека
 *    и так есть кнопки, панель их не дублирует и не перекрывает подвал;
 *  - не открыта клавиатура (фокус в поле ввода) — иначе панель встаёт над
 *    клавиатурой и закрывает поле.
 * На десктопе панель скрыта классом md:hidden, скрипт там ничего не меняет.
 *
 * «Позвонить» и «Telegram» — обычные ссылки без JS-перехода (Метрика сама
 * засчитывает автоцели). «Рассчитать» только плавно прокручивает к форме.
 */
export function initMobileCta(): void {
  const bar = document.querySelector<HTMLElement>("[data-mobile-cta]");
  const start = document.querySelector<HTMLElement>("[data-mobile-cta-start]");
  if (!bar || !start) return;
  const stop = document.querySelector<HTMLElement>("[data-mobile-cta-stop]");

  const root = document.documentElement;
  root.classList.add("has-mobile-cta");
  bar.hidden = false;

  let typing = false;
  let ticking = false;

  const update = (): void => {
    ticking = false;
    const viewport = window.innerHeight;
    const pastForm = start.getBoundingClientRect().bottom < 0;
    const atContacts = stop ? stop.getBoundingClientRect().top < viewport : false;
    const show = pastForm && !atContacts && !typing;
    bar.classList.toggle("is-visible", show);
    root.classList.toggle("mobile-cta-on", show);
  };

  const schedule = (): void => {
    if (!ticking) {
      ticking = true;
      window.requestAnimationFrame(update);
    }
  };

  window.addEventListener("scroll", schedule, { passive: true });
  window.addEventListener("resize", schedule);

  const isField = (el: EventTarget | null): boolean =>
    el instanceof HTMLElement && el.matches("input, textarea, select");
  document.addEventListener("focusin", (event) => {
    if (isField(event.target)) {
      typing = true;
      schedule();
    }
  });
  document.addEventListener("focusout", (event) => {
    if (isField(event.target)) {
      typing = false;
      schedule();
    }
  });

  // «Рассчитать»: плавная прокрутка к форме (отступ под sticky-хедер задаёт
  // scroll-margin у якоря). Без JS сработает обычный переход по #raschet.
  bar.querySelector<HTMLAnchorElement>("[data-mobile-cta-calc]")?.addEventListener(
    "click",
    (event) => {
      event.preventDefault();
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      start.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
    },
  );

  update();
}
