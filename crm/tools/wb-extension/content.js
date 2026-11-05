// Читает со страницы WB то, что видно человеку: артикулы товаров (ссылки /catalog/<артикул>/detail.aspx), число
// товаров продавца, и сообщает, если WB показал проверку «Подозрительная активность». В работу сайта не вмешивается:
// не перехватывает запросы и ничего не подменяет — только прокручивает страницу, чтобы подгрузилась выдача.
(() => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const blocked = () => location.pathname.includes("__wbaas") || /Подозрительная активность/i.test(`${document.title} ${(document.body?.innerText ?? "").slice(0, 3000)}`);

  /** Артикулы с карточек на странице. */
  const items = () => {
    const out = new Map();
    for (const a of document.querySelectorAll('a[href*="/catalog/"][href*="/detail.aspx"]')) {
      const m = /\/catalog\/(\d+)\/detail\.aspx/.exec(a.getAttribute("href") ?? "");
      if (!m) continue;
      const nm = Number(m[1]);
      if (out.has(nm)) continue;
      const card = a.closest("article, [class*='product-card']") ?? a;
      out.set(nm, {
        nm,
        name: (card.querySelector("[class*='name']")?.textContent ?? a.getAttribute("aria-label") ?? "").replace(/\s+/g, " ").trim().slice(0, 300),
        brand: (card.querySelector("[class*='brand']")?.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 100),
      });
    }
    return [...out.values()];
  };

  /** Число товаров продавца из текста страницы («1 234 товара»); null — не нашлось. */
  const count = () => {
    const text = (document.querySelector("main") ?? document.body)?.innerText ?? "";
    const m = /(\d[\d\s ]{0,8})\s*товар(?:ов|а)?(?![а-я])/i.exec(text);
    const n = m ? Number(m[1].replace(/\D/g, "")) : NaN;
    return Number.isFinite(n) && n > 0 && n < 1_000_000 ? n : null;
  };

  /**
   * Прокрутка вниз, пока подгружаются карточки: WB не листает выдачу по страницам, только подгружает при прокрутке.
   * Артикулы копятся по ходу — даже если WB убирает верхние карточки со страницы, они не теряются.
   * Стоп: набрали want, или новых нет ~5 с, а страница уже внизу, или прошло 3 минуты.
   */
  async function collect(want) {
    const seen = new Map();
    const started = Date.now();
    let idle = 0;
    while (!blocked() && Date.now() - started < 180_000) {
      const before = seen.size;
      for (const it of items()) if (!seen.has(it.nm)) seen.set(it.nm, it);
      if (seen.size >= want) break;
      const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 50;
      idle = seen.size === before && atBottom ? idle + 1 : 0;
      if (idle >= 7 && seen.size > 0) break;
      if (idle >= 15) break; // пусто и не грузится
      window.scrollBy(0, Math.round(window.innerHeight * 0.9));
      await sleep(700);
    }
    window.scrollTo(0, 0);
    return { blocked: blocked(), items: [...seen.values()].slice(0, want), count: count(), title: document.title, url: location.href };
  }

  chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
    if (msg?.kind !== "inspect") return;
    collect(msg.want ?? 100).then(reply, () => reply(null));
    return true; // ответ асинхронный
  });
})();
