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
  "vykup-tovara": {
    slug: "vykup-tovara",
    i18nBase: "uslugi.torgovlya.vykup",
    heroIcon: "landmark",
    requestUrl: "/kontakty/",
    related: [
      { icon: "search", labelKey: "uslugi.torgovlya.services.search", url: `${BASE}/poisk-postavshchika/` },
      { icon: "file-text", labelKey: "logiExtra.customs", url: "/uslugi/dostavka/tamozhennoe-oformlenie/" },
    ],
    fullCycleUrl: "/torgovlya/",
    // Кейса/статьи пока нет → соответствующие блоки скрыты.
  },
  "vozvrat-nds": {
    slug: "vozvrat-nds",
    i18nBase: "uslugi.torgovlya.vozvrat",
    heroIcon: "receipt",
    requestUrl: "/kontakty/",
    related: [
      { icon: "landmark", labelKey: "uslugi.torgovlya.services.buyout", url: `${BASE}/vykup-tovara/` },
      { icon: "search", labelKey: "uslugi.torgovlya.services.search", url: `${BASE}/poisk-postavshchika/` },
    ],
    fullCycleUrl: "/torgovlya/",
    // Кейса/статьи пока нет → соответствующие блоки скрыты.
  },
  "kontrol-proizvodstva": {
    slug: "kontrol-proizvodstva",
    i18nBase: "uslugi.torgovlya.kontrol",
    heroIcon: "camera",
    requestUrl: "/kontakty/",
    related: [
      { icon: "shield-check", labelKey: "uslugi.torgovlya.services.factoryCheck", url: `${BASE}/proverka-zavoda/` },
      { icon: "scan-search", labelKey: "uslugi.torgovlya.services.inspection", url: `${BASE}/inspekciya/` },
    ],
    fullCycleUrl: "/torgovlya/",
    // Кейс −$7000 — ссылкой внутри раздела «Как контролируем» (см. страницу).
    caseUrl: "/kejsy/kontrol-proizvodstva-7000/",
  },
  inspekciya: {
    slug: "inspekciya",
    i18nBase: "uslugi.torgovlya.inspekciya",
    heroIcon: "scan-search",
    requestUrl: "/kontakty/",
    related: [
      { icon: "camera", labelKey: "uslugi.torgovlya.services.control", url: `${BASE}/kontrol-proizvodstva/` },
      { icon: "shield-check", labelKey: "uslugi.torgovlya.services.factoryCheck", url: `${BASE}/proverka-zavoda/` },
    ],
    fullCycleUrl: "/torgovlya/",
  },
  "audit-proizvodstva": {
    slug: "audit-proizvodstva",
    i18nBase: "uslugi.torgovlya.audit",
    heroIcon: "factory",
    requestUrl: "/kontakty/",
    related: [
      { icon: "shield-check", labelKey: "uslugi.torgovlya.services.factoryCheck", url: `${BASE}/proverka-zavoda/` },
      { icon: "search", labelKey: "uslugi.torgovlya.services.search", url: `${BASE}/poisk-postavshchika/` },
    ],
    fullCycleUrl: "/torgovlya/",
  },
  peregovory: {
    slug: "peregovory",
    i18nBase: "uslugi.torgovlya.peregovory",
    heroIcon: "messages-square",
    requestUrl: "/kontakty/",
    related: [
      { icon: "camera", labelKey: "uslugi.torgovlya.services.control", url: `${BASE}/kontrol-proizvodstva/` },
      { icon: "search", labelKey: "uslugi.torgovlya.services.search", url: `${BASE}/poisk-postavshchika/` },
    ],
    fullCycleUrl: "/torgovlya/",
  },
  "proverka-zavoda": {
    slug: "proverka-zavoda",
    i18nBase: "uslugi.torgovlya.proverka",
    heroIcon: "shield-check",
    requestUrl: "/kontakty/",
    related: [
      { icon: "search", labelKey: "uslugi.torgovlya.services.search", url: `${BASE}/poisk-postavshchika/` },
      { icon: "camera", labelKey: "uslugi.torgovlya.services.control", url: `${BASE}/kontrol-proizvodstva/` },
    ],
    fullCycleUrl: "/torgovlya/",
    // Кейса/статьи пока нет → соответствующие блоки скрыты.
  },
};

export default services;
