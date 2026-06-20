import type { ServicesData } from "./types.js";

/**
 * Структура страниц торговых услуг (/uslugi/torgovlya/<slug>/) на читательском
 * шаблоне: иконки, URL, перелинковка. Тексты не хардкодятся — здесь только
 * ссылки на i18n-словарь (i18nBase → ветка uslugi.torgovlya.<slug>).
 *
 * «Поиск поставщика» — эталонная страница; по её образцу добавляются остальные
 * 9 торговых услуг (тем же конфигом + ветка текстов в i18n).
 *
 * Опциональные ссылки (articleUrl/caseUrl) намеренно НЕ заданы, пока статья/кейс
 * не написаны — соответствующие блоки перелинковки не выводятся (без ссылок на
 * ненаписанное).
 */
const BASE = "/uslugi/torgovlya";

const services: ServicesData = {
  "poisk-postavshchika": {
    slug: "poisk-postavshchika",
    i18nBase: "uslugi.torgovlya.poisk",
    heroIcon: "search",
    requestUrl: "/kontakty/",
    related: [
      { icon: "landmark", labelKey: "uslugi.torgovlya.services.buyout", url: `${BASE}/vykup-tovara/` },
      { icon: "shield-check", labelKey: "uslugi.torgovlya.services.factoryCheck", url: `${BASE}/proverka-zavoda/` },
    ],
    fullCycleUrl: "/torgovlya/",
    // Связанный кейс есть → строка-ссылка в перелинковке. Статья ещё не написана
    // (articleUrl не задан) → блок статьи скрыт.
    caseUrl: "/kejsy/poisk-postavshchika-gazon/",
  },
};

export default services;
