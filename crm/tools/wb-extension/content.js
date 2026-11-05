// Мост «страница → расширение»: пересылает перехваченные ответы WB, артикулы со страницы (если ответ не перехватился)
// и сообщает, если WB показал проверку «Подозрительная активность».
(() => {
  window.addEventListener("message", (e) => {
    if (e.source !== window || e.data?.__irbis !== "capture") return;
    chrome.runtime.sendMessage({ kind: "capture", url: e.data.url, data: e.data.data }).catch(() => {});
  });

  const blocked = () =>
    location.pathname.includes("__wbaas") || /Подозрительная активность/i.test(document.title + " " + (document.body?.innerText ?? "").slice(0, 2000));

  /** Артикулы с карточек на странице: ссылки вида /catalog/<артикул>/detail.aspx. */
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
        name: (card.querySelector("[class*='name']")?.textContent ?? a.getAttribute("aria-label") ?? "").trim().slice(0, 300),
        brand: (card.querySelector("[class*='brand']")?.textContent ?? "").trim().slice(0, 100),
      });
    }
    return [...out.values()];
  };

  chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
    if (msg?.kind === "inspect") reply({ blocked: blocked(), items: items(), title: document.title });
  });

  const check = () => {
    if (blocked()) chrome.runtime.sendMessage({ kind: "blocked" }).catch(() => {});
  };
  window.addEventListener("load", () => setTimeout(check, 3000));
})();
