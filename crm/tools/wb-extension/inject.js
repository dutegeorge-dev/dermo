// Работает внутри страницы wildberries.ru: копирует ответы поиска и каталога продавца, которые страница сама получила
// от WB, и передаёт их расширению (content.js). Ничего не запрашивает сверх того, что делает сайт, и ничего не подменяет.
(() => {
  const WANTED = /(^|\.)wb\.ru$|(^|\.)wildberries\.ru$/;
  const PATH = /\/search|\/catalog|\/sellers/;

  const report = (url, data) => {
    try {
      if (data && typeof data === "object" && (Array.isArray(data.products) || Array.isArray(data.data?.products))) {
        window.postMessage({ __irbis: "capture", url: String(url), data }, "*");
      }
    } catch {
      /* ответ не тот — пропускаем */
    }
  };

  const interesting = (url) => {
    try {
      const u = new URL(url, location.href);
      return WANTED.test(u.hostname) && PATH.test(u.pathname) && u.hostname !== "www.wildberries.ru";
    } catch {
      return false;
    }
  };

  const origFetch = window.fetch;
  window.fetch = function (...args) {
    const p = origFetch.apply(this, args);
    try {
      const url = typeof args[0] === "string" ? args[0] : args[0]?.url;
      if (url && interesting(url)) {
        p.then((res) => res.clone().json().then((d) => report(url, d))).catch(() => {});
      }
    } catch {
      /* не мешаем странице */
    }
    return p;
  };

  const origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    try {
      if (interesting(url)) {
        this.addEventListener("load", () => {
          try {
            const d = this.responseType === "json" ? this.response : JSON.parse(this.responseText);
            report(url, d);
          } catch {
            /* не JSON */
          }
        });
      }
    } catch {
      /* не мешаем странице */
    }
    return origOpen.call(this, method, url, ...rest);
  };
})();
