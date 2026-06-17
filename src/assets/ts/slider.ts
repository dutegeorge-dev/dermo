/**
 * Слайдер-карусель (команда на странице «О компании» и др.).
 *
 * Прогрессивное улучшение без зависимостей:
 *  - трек [data-slider-track] — нативно прокручиваемый контейнер, поэтому
 *    свайп на тач-устройствах работает «из коробки»;
 *  - стрелки [data-slider-prev] / [data-slider-next] прокручивают на ширину
 *    одной карточки (обычные <button> — доступны с клавиатуры);
 *  - стрелки блокируются (disabled) на краях прокрутки.
 */
function initSliders(): void {
  const sliders = document.querySelectorAll<HTMLElement>("[data-slider]");

  sliders.forEach((slider) => {
    const track = slider.querySelector<HTMLElement>("[data-slider-track]");
    const prev = slider.querySelector<HTMLButtonElement>("[data-slider-prev]");
    const next = slider.querySelector<HTMLButtonElement>("[data-slider-next]");
    if (!track || !prev || !next) return;

    // Шаг прокрутки = ширина карточки + межкарточный gap.
    const step = (): number => {
      const item = track.querySelector<HTMLElement>("[data-slider-item]");
      if (!item) return track.clientWidth;
      const gap = Number.parseFloat(getComputedStyle(track).columnGap) || 0;
      return item.getBoundingClientRect().width + gap;
    };

    // Блокировка стрелок на краях (с допуском в 1px на дробную прокрутку).
    const update = (): void => {
      const max = track.scrollWidth - track.clientWidth - 1;
      prev.disabled = track.scrollLeft <= 0;
      next.disabled = track.scrollLeft >= max;
    };

    prev.addEventListener("click", () => {
      track.scrollBy({ left: -step(), behavior: "smooth" });
    });
    next.addEventListener("click", () => {
      track.scrollBy({ left: step(), behavior: "smooth" });
    });

    // Перерисовка состояния стрелок при прокрутке/свайпе (throttle через rAF).
    let ticking = false;
    track.addEventListener(
      "scroll",
      () => {
        if (ticking) return;
        ticking = true;
        window.requestAnimationFrame(() => {
          update();
          ticking = false;
        });
      },
      { passive: true },
    );
    window.addEventListener("resize", update, { passive: true });

    update();
  });
}

document.addEventListener("DOMContentLoaded", initSliders);

export {};
