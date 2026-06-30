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

const SPOSOBY = "/uslugi/dostavka/sposoby";

const services: ServicesData = {
  avto: {
    slug: "avto",
    i18nBase: "uslugi.dostavkaServices.avto",
    heroIcon: "truck",
    requestUrl: "/kontakty/",
    related: [
      { icon: "train-front", labelKey: "methodFull.zhd", url: `${SPOSOBY}/zhd/` },
      { icon: "file-text", labelKey: "logiExtra.customs", url: "/uslugi/dostavka/tamozhennoe-oformlenie/" },
    ],
    fullCycleUrl: "/torgovlya/",
  },
  zhd: {
    slug: "zhd",
    i18nBase: "uslugi.dostavkaServices.zhd",
    heroIcon: "train-front",
    requestUrl: "/kontakty/",
    related: [
      { icon: "truck", labelKey: "methodFull.avto", url: `${SPOSOBY}/avto/` },
      { icon: "ship", labelKey: "methodFull.more", url: `${SPOSOBY}/more/` },
    ],
    fullCycleUrl: "/torgovlya/",
  },
  more: {
    slug: "more",
    i18nBase: "uslugi.dostavkaServices.more",
    heroIcon: "ship",
    requestUrl: "/kontakty/",
    related: [
      { icon: "train-front", labelKey: "methodFull.zhd", url: `${SPOSOBY}/zhd/` },
      { icon: "file-text", labelKey: "logiExtra.customs", url: "/uslugi/dostavka/tamozhennoe-oformlenie/" },
    ],
    fullCycleUrl: "/torgovlya/",
  },
  avia: {
    slug: "avia",
    i18nBase: "uslugi.dostavkaServices.avia",
    heroIcon: "plane",
    requestUrl: "/kontakty/",
    related: [
      { icon: "badge-check", labelKey: "uslugi.torgovlya.services.certification", url: `${BASE}/sertifikaciya/` },
      { icon: "truck", labelKey: "methodFull.avto", url: `${SPOSOBY}/avto/` },
    ],
    fullCycleUrl: "/torgovlya/",
  },
  "napolnye-pokrytiya": {
    slug: "napolnye-pokrytiya",
    i18nBase: "uslugi.tovary.napolnye",
    heroIcon: "layers",
    requestUrl: "/kontakty/",
    related: [
      { icon: "search", labelKey: "uslugi.torgovlya.services.search", url: `${BASE}/poisk-postavshchika/` },
      { icon: "train-front", labelKey: "methodFull.zhd", url: `${SPOSOBY}/zhd/` },
    ],
    fullCycleUrl: "/torgovlya/",
  },
  zapchasti: {
    slug: "zapchasti",
    i18nBase: "uslugi.tovary.zapchasti",
    heroIcon: "package-check",
    requestUrl: "/kontakty/",
    related: [
      { icon: "search", labelKey: "uslugi.torgovlya.services.search", url: `${BASE}/poisk-postavshchika/` },
      { icon: "landmark", labelKey: "uslugi.torgovlya.services.buyout", url: `${BASE}/vykup-tovara/` },
    ],
    fullCycleUrl: "/torgovlya/",
    // Кейс по запчастям — ссылкой в разделе «Что мы поставляем».
    caseUrl: "/kejsy/zapchasti-gruzoviki/",
  },
  elektronika: {
    slug: "elektronika",
    i18nBase: "uslugi.tovary.elektronika",
    heroIcon: "scan-barcode",
    requestUrl: "/kontakty/",
    related: [
      { icon: "badge-check", labelKey: "uslugi.torgovlya.services.certification", url: `${BASE}/sertifikaciya/` },
      { icon: "search", labelKey: "uslugi.torgovlya.services.search", url: `${BASE}/poisk-postavshchika/` },
    ],
    fullCycleUrl: "/torgovlya/",
  },
  tekstil: {
    slug: "tekstil",
    i18nBase: "uslugi.tovary.tekstil",
    heroIcon: "store",
    requestUrl: "/kontakty/",
    related: [
      { icon: "badge-check", labelKey: "uslugi.torgovlya.services.certification", url: `${BASE}/sertifikaciya/` },
      { icon: "package", labelKey: "uslugi.torgovlya.services.packaging", url: `${BASE}/upakovka-markirovka/` },
    ],
    fullCycleUrl: "/torgovlya/",
  },
  oborudovanie: {
    slug: "oborudovanie",
    i18nBase: "uslugi.tovary.oborudovanie",
    heroIcon: "factory",
    requestUrl: "/kontakty/",
    related: [
      { icon: "shield-check", labelKey: "uslugi.torgovlya.services.factoryCheck", url: `${BASE}/proverka-zavoda/` },
      { icon: "search", labelKey: "uslugi.torgovlya.services.search", url: `${BASE}/poisk-postavshchika/` },
    ],
    fullCycleUrl: "/torgovlya/",
  },
  "tamozhennoe-oformlenie": {
    slug: "tamozhennoe-oformlenie",
    i18nBase: "uslugi.dostavkaServices.tamozhnya",
    heroIcon: "file-text",
    requestUrl: "/kontakty/",
    related: [
      { icon: "package", labelKey: "logiExtra.consolidation", url: "/uslugi/dostavka/sbornye-gruzy/" },
      { icon: "badge-check", labelKey: "uslugi.torgovlya.services.certification", url: `${BASE}/sertifikaciya/` },
    ],
    fullCycleUrl: "/torgovlya/",
  },
  "sbornye-gruzy": {
    slug: "sbornye-gruzy",
    i18nBase: "uslugi.dostavkaServices.sbornye",
    heroIcon: "package",
    requestUrl: "/kontakty/",
    related: [
      { icon: "file-text", labelKey: "logiExtra.customs", url: "/uslugi/dostavka/tamozhennoe-oformlenie/" },
      { icon: "package", labelKey: "uslugi.torgovlya.services.packaging", url: `${BASE}/upakovka-markirovka/` },
    ],
    fullCycleUrl: "/torgovlya/",
  },
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
  "upakovka-markirovka": {
    slug: "upakovka-markirovka",
    i18nBase: "uslugi.torgovlya.upakovka",
    heroIcon: "package",
    requestUrl: "/kontakty/",
    related: [
      { icon: "scan-search", labelKey: "uslugi.torgovlya.services.inspection", url: `${BASE}/inspekciya/` },
      { icon: "file-text", labelKey: "logiExtra.customs", url: "/uslugi/dostavka/tamozhennoe-oformlenie/" },
    ],
    fullCycleUrl: "/torgovlya/",
  },
  sertifikaciya: {
    slug: "sertifikaciya",
    i18nBase: "uslugi.torgovlya.sertifikaciya",
    heroIcon: "badge-check",
    requestUrl: "/kontakty/",
    related: [
      { icon: "file-text", labelKey: "logiExtra.customs", url: "/uslugi/dostavka/tamozhennoe-oformlenie/" },
      { icon: "package", labelKey: "uslugi.torgovlya.services.packaging", url: `${BASE}/upakovka-markirovka/` },
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
