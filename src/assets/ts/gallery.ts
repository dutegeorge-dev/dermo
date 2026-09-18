/**
 * Лайтбокс галереи отправок: клик по фото открывает его крупно поверх страницы.
 *
 * Разметка (components/shipments-gallery.njk): контейнер [data-gallery], внутри
 * кнопки [data-gallery-item] с <img>. Кнопки, а не ссылки: никуда не ведём,
 * только открываем просмотр — так это и читается с клавиатуры и скринридером.
 *
 * Крупную версию берём из srcset самой картинки (самый широкий кандидат), а не
 * из отдельного data-атрибута: eleventy-img сам решает, какие ширины сгенерировать,
 * и подмена фото через Decap не потребует правок в шаблоне.
 */

/** Самый широкий кандидат из srcset; если srcset нет — обычный src. */
function largestSrc(img: HTMLImageElement): string {
  const set = img.getAttribute("srcset");
  if (!set) return img.currentSrc || img.src;

  let best = img.src;
  let bestWidth = 0;
  for (const candidate of set.split(",")) {
    const [url, descriptor] = candidate.trim().split(/\s+/);
    const width = descriptor?.endsWith("w") ? parseInt(descriptor, 10) : 0;
    if (url && width >= bestWidth) {
      best = url;
      bestWidth = width;
    }
  }
  return best;
}

export function initGallery(): void {
  const groups = Array.from(document.querySelectorAll<HTMLElement>("[data-gallery]"));
  if (!groups.length) return;

  let items: HTMLButtonElement[] = [];
  let index = 0;
  let lastFocused: HTMLElement | null = null;

  // Оверлей один на страницу и создаётся при первом открытии: пока по фото не
  // кликнули, в DOM ничего лишнего нет.
  let overlay: HTMLElement | null = null;
  let picture: HTMLImageElement;
  let caption: HTMLElement;
  let counter: HTMLElement;
  let prevBtn: HTMLButtonElement;
  let nextBtn: HTMLButtonElement;

  function build(): HTMLElement {
    const root = document.createElement("div");
    root.className =
      "fixed inset-0 z-[60] hidden items-center justify-center bg-ink/90 p-4 sm:p-8";
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.setAttribute("aria-label", "Просмотр фотографии");

    root.innerHTML = `
      <button type="button" data-lb-close
        class="absolute right-3 top-3 inline-flex h-11 w-11 items-center justify-center rounded-lg text-white/80 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
        aria-label="Закрыть просмотр">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" class="h-6 w-6" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
      </button>
      <button type="button" data-lb-prev
        class="absolute left-2 top-1/2 inline-flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-lg text-white/80 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white sm:left-4"
        aria-label="Предыдущее фото">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" class="h-6 w-6" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>
      </button>
      <button type="button" data-lb-next
        class="absolute right-2 top-1/2 inline-flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-lg text-white/80 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white sm:right-4"
        aria-label="Следующее фото">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" class="h-6 w-6" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>
      </button>
      <figure data-lb-figure class="flex max-h-full max-w-4xl flex-col items-center gap-3">
        <img data-lb-image alt="" class="max-h-[78vh] w-auto max-w-full rounded-lg object-contain shadow-2xl" />
        <figcaption class="text-center text-sm text-white/80">
          <span data-lb-caption></span>
          <span data-lb-counter class="ml-2 whitespace-nowrap text-white/50"></span>
        </figcaption>
      </figure>
    `;

    document.body.appendChild(root);

    picture = root.querySelector<HTMLImageElement>("[data-lb-image]")!;
    caption = root.querySelector<HTMLElement>("[data-lb-caption]")!;
    counter = root.querySelector<HTMLElement>("[data-lb-counter]")!;
    prevBtn = root.querySelector<HTMLButtonElement>("[data-lb-prev]")!;
    nextBtn = root.querySelector<HTMLButtonElement>("[data-lb-next]")!;

    root.querySelector("[data-lb-close]")?.addEventListener("click", close);
    prevBtn.addEventListener("click", () => show(index - 1));
    nextBtn.addEventListener("click", () => show(index + 1));

    // Клик по подложке (не по самому фото и не по кнопкам) закрывает просмотр.
    root.addEventListener("click", (event) => {
      if (event.target === root) close();
    });

    return root;
  }

  function show(next: number): void {
    if (!items.length) return;
    index = (next + items.length) % items.length;

    const img = items[index].querySelector("img");
    if (!img) return;

    picture.src = largestSrc(img);
    picture.alt = img.alt;
    caption.textContent = img.alt;
    counter.textContent = items.length > 1 ? `${index + 1} / ${items.length}` : "";

    const many = items.length > 1;
    prevBtn.hidden = !many;
    nextBtn.hidden = !many;
  }

  function open(group: HTMLElement, button: HTMLButtonElement): void {
    overlay ??= build();
    items = Array.from(group.querySelectorAll<HTMLButtonElement>("[data-gallery-item]"));
    lastFocused = button;

    show(items.indexOf(button));
    overlay.classList.remove("hidden");
    overlay.classList.add("flex");
    // Скролл под оверлеем увёл бы страницу, пока человек листает фото.
    document.body.style.overflow = "hidden";
    overlay.querySelector<HTMLButtonElement>("[data-lb-close]")?.focus();
  }

  function close(): void {
    if (!overlay) return;
    overlay.classList.add("hidden");
    overlay.classList.remove("flex");
    document.body.style.overflow = "";
    picture.removeAttribute("src");
    lastFocused?.focus();
    lastFocused = null;
  }

  groups.forEach((group) => {
    group.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const button = target.closest<HTMLButtonElement>("[data-gallery-item]");
      if (button) open(group, button);
    });
  });

  document.addEventListener("keydown", (event) => {
    if (!overlay || overlay.classList.contains("hidden")) return;
    if (event.key === "Escape") close();
    else if (event.key === "ArrowLeft") show(index - 1);
    else if (event.key === "ArrowRight") show(index + 1);
  });
}
