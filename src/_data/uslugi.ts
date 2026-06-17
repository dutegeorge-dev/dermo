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
  sposobyUrl: `${DELIVERY}/sposoby/`,
  tovaryUrl: `${DELIVERY}/tovary/`,
  gorodaUrl: `${DELIVERY}/goroda/`,
  torgovlyaUrl: `${BASE}/torgovlya/`,

  // По способу — простые карточки (иконка + название).
  methods: [
    { slug: "avto", icon: "truck", nameKey: "method.avto", url: `${DELIVERY}/sposoby/avto/` },
    { slug: "zhd", icon: "train-front", nameKey: "method.zhd", url: `${DELIVERY}/sposoby/zhd/` },
    { slug: "more", icon: "ship", nameKey: "method.more", url: `${DELIVERY}/sposoby/more/` },
    { slug: "avia", icon: "plane", nameKey: "method.avia", url: `${DELIVERY}/sposoby/avia/` },
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

  // Торговые услуги (10) — простые карточки витрины /uslugi/torgovlya/.
  torgovlyaServices: [
    { slug: "poisk-postavshchika", icon: "search", nameKey: "uslugi.torgovlya.services.search", url: `${BASE}/torgovlya/poisk-postavshchika/` },
    { slug: "audit-proizvodstva", icon: "factory", nameKey: "uslugi.torgovlya.services.audit", url: `${BASE}/torgovlya/audit-proizvodstva/` },
    { slug: "peregovory", icon: "messages-square", nameKey: "uslugi.torgovlya.services.negotiations", url: `${BASE}/torgovlya/peregovory/` },
    { slug: "kontrol-proizvodstva", icon: "camera", nameKey: "uslugi.torgovlya.services.control", url: `${BASE}/torgovlya/kontrol-proizvodstva/` },
    { slug: "inspekciya", icon: "scan-search", nameKey: "uslugi.torgovlya.services.inspection", url: `${BASE}/torgovlya/inspekciya/` },
    { slug: "upakovka-markirovka", icon: "package", nameKey: "uslugi.torgovlya.services.packaging", url: `${BASE}/torgovlya/upakovka-markirovka/` },
    { slug: "sertifikaciya", icon: "badge-check", nameKey: "uslugi.torgovlya.services.certification", url: `${BASE}/torgovlya/sertifikaciya/` },
    { slug: "vykup-tovara", icon: "landmark", nameKey: "uslugi.torgovlya.services.buyout", url: `${BASE}/torgovlya/vykup-tovara/` },
    { slug: "vozvrat-nds", icon: "receipt", nameKey: "uslugi.torgovlya.services.vat", url: `${BASE}/torgovlya/vozvrat-nds/` },
    { slug: "proverka-zavoda", icon: "shield-check", nameKey: "uslugi.torgovlya.services.factoryCheck", url: `${BASE}/torgovlya/proverka-zavoda/` },
  ],
};

export default uslugi;
