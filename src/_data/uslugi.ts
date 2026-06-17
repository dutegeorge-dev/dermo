import type { UslugiData } from "./types.js";

/**
 * Единый источник структуры раздела «Услуги» (/uslugi/).
 * Из этих данных строятся три витрины (/uslugi/, /uslugi/dostavka/,
 * /uslugi/torgovlya/), простые списки (товары, города) и — через URL —
 * хлебные крошки. Тексты не хардкодятся: здесь слаги, иконки Lucide, URL и
 * ключи словаря (i18n); сами строки лежат в _data/i18n/*.ts (ветка `uslugi`,
 * а названия способов/категорий/городов переиспользуют существующие ветки
 * `method`/`goods`/`city`).
 *
 * Меняется состав/порядок — отражается на витринах и в списках без правок
 * шаблонов. Все пути — под /uslugi/, чтобы не было дублей со старыми разделами.
 */
const BASE = "/uslugi";
const DELIVERY = `${BASE}/dostavka`;

const uslugi: UslugiData = {
  dostavkaUrl: `${DELIVERY}/`,
  tovaryUrl: `${DELIVERY}/tovary/`,
  gorodaUrl: `${DELIVERY}/goroda/`,
  torgovlyaUrl: `${BASE}/torgovlya/`,

  // По способу — карточки с иконкой, сроком и описанием (как на /logistika/).
  methods: [
    {
      slug: "avto",
      icon: "truck",
      nameKey: "method.avto",
      timeKey: "uslugi.methods.avto.time",
      descKey: "uslugi.methods.avto.desc",
      url: `${DELIVERY}/avto/`,
    },
    {
      slug: "zhd",
      icon: "train-front",
      nameKey: "method.zhd",
      timeKey: "uslugi.methods.zhd.time",
      descKey: "uslugi.methods.zhd.desc",
      url: `${DELIVERY}/zhd/`,
    },
    {
      slug: "more",
      icon: "ship",
      nameKey: "method.more",
      timeKey: "uslugi.methods.more.time",
      descKey: "uslugi.methods.more.desc",
      url: `${DELIVERY}/more/`,
    },
    {
      slug: "avia",
      icon: "plane",
      nameKey: "method.avia",
      timeKey: "uslugi.methods.avia.time",
      descKey: "uslugi.methods.avia.desc",
      url: `${DELIVERY}/avia/`,
    },
  ],

  // По товару — категории грузов (названия из ветки `goods`).
  tovary: [
    { slug: "napolnye-pokrytiya", nameKey: "goods.flooring", icon: "layers", url: `${DELIVERY}/tovary/napolnye-pokrytiya/` },
    { slug: "zapchasti", nameKey: "goods.parts", icon: "package-check", url: `${DELIVERY}/tovary/zapchasti/` },
    { slug: "keramika-plitka", nameKey: "goods.ceramics", icon: "package", url: `${DELIVERY}/tovary/keramika-plitka/` },
    { slug: "elektronika", nameKey: "goods.electronics", icon: "scan-barcode", url: `${DELIVERY}/tovary/elektronika/` },
    { slug: "tekstil", nameKey: "goods.textile", icon: "store", url: `${DELIVERY}/tovary/tekstil/` },
    { slug: "oborudovanie", nameKey: "goods.equipment", icon: "factory", url: `${DELIVERY}/tovary/oborudovanie/` },
    { slug: "stroymaterialy", nameKey: "goods.building", icon: "warehouse", url: `${DELIVERY}/tovary/stroymaterialy/` },
  ],

  // По городу — города присутствия (названия из ветки `city`).
  goroda: [
    { slug: "moskva", nameKey: "city.moscow", icon: "map-pin", url: `${DELIVERY}/goroda/moskva/` },
    { slug: "sankt-peterburg", nameKey: "city.spb", icon: "map-pin", url: `${DELIVERY}/goroda/sankt-peterburg/` },
    { slug: "ekaterinburg", nameKey: "city.ekb", icon: "map-pin", url: `${DELIVERY}/goroda/ekaterinburg/` },
    { slug: "novosibirsk", nameKey: "city.nsk", icon: "map-pin", url: `${DELIVERY}/goroda/novosibirsk/` },
    { slug: "kazan", nameKey: "city.kazan", icon: "map-pin", url: `${DELIVERY}/goroda/kazan/` },
  ],

  // Торговые услуги (10) — карточки витрины /uslugi/torgovlya/.
  torgovlyaServices: [
    { slug: "poisk-postavshchika", icon: "search", titleKey: "uslugi.torgovlya.services.search.title", descKey: "uslugi.torgovlya.services.search.desc", url: `${BASE}/torgovlya/poisk-postavshchika/` },
    { slug: "audit-proizvodstva", icon: "factory", titleKey: "uslugi.torgovlya.services.audit.title", descKey: "uslugi.torgovlya.services.audit.desc", url: `${BASE}/torgovlya/audit-proizvodstva/` },
    { slug: "peregovory", icon: "messages-square", titleKey: "uslugi.torgovlya.services.negotiations.title", descKey: "uslugi.torgovlya.services.negotiations.desc", url: `${BASE}/torgovlya/peregovory/` },
    { slug: "kontrol-proizvodstva", icon: "camera", titleKey: "uslugi.torgovlya.services.control.title", descKey: "uslugi.torgovlya.services.control.desc", url: `${BASE}/torgovlya/kontrol-proizvodstva/` },
    { slug: "inspekciya", icon: "scan-search", titleKey: "uslugi.torgovlya.services.inspection.title", descKey: "uslugi.torgovlya.services.inspection.desc", url: `${BASE}/torgovlya/inspekciya/` },
    { slug: "upakovka-markirovka", icon: "package", titleKey: "uslugi.torgovlya.services.packaging.title", descKey: "uslugi.torgovlya.services.packaging.desc", url: `${BASE}/torgovlya/upakovka-markirovka/` },
    { slug: "sertifikaciya", icon: "badge-check", titleKey: "uslugi.torgovlya.services.certification.title", descKey: "uslugi.torgovlya.services.certification.desc", url: `${BASE}/torgovlya/sertifikaciya/` },
    { slug: "vykup-tovara", icon: "landmark", titleKey: "uslugi.torgovlya.services.buyout.title", descKey: "uslugi.torgovlya.services.buyout.desc", url: `${BASE}/torgovlya/vykup-tovara/` },
    { slug: "vozvrat-nds", icon: "receipt", titleKey: "uslugi.torgovlya.services.vat.title", descKey: "uslugi.torgovlya.services.vat.desc", url: `${BASE}/torgovlya/vozvrat-nds/` },
    { slug: "proverka-zavoda", icon: "shield-check", titleKey: "uslugi.torgovlya.services.factoryCheck.title", descKey: "uslugi.torgovlya.services.factoryCheck.desc", url: `${BASE}/torgovlya/proverka-zavoda/` },
  ],
};

export default uslugi;
