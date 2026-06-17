import type { MegaMenu } from "./types.js";

/**
 * Данные мега-меню «Услуги». Рендерится из этой структуры (partials/mega-services.njk),
 * без хардкода списков в шаблоне. Тексты — по ключам словаря (i18n), иконки — Lucide.
 *
 * Левое крыло (Логистика) — шире: трое подгрупп с кликабельными хабами.
 * Правое крыло (Торговля) — уже: список услуг с иконками.
 */
const megaMenu: MegaMenu = {
  logistics: {
    gate: {
      titleKey: "mega.logistics.title",
      subtitleKey: "mega.logistics.subtitle",
      url: "/logistika/",
    },
    groups: [
      {
        titleKey: "mega.byMethod",
        url: "/uslugi/dostavka/",
        items: [
          { titleKey: "method.avto", url: "/uslugi/dostavka/avto/", icon: "truck" },
          { titleKey: "method.zhd", url: "/uslugi/dostavka/zhd/", icon: "train-front" },
          { titleKey: "method.more", url: "/uslugi/dostavka/more/", icon: "ship" },
          { titleKey: "method.avia", url: "/uslugi/dostavka/avia/", icon: "plane" },
        ],
      },
      {
        titleKey: "mega.byGoods",
        url: "/uslugi/dostavka/tovary/",
        items: [
          { titleKey: "goods.flooring", url: "/uslugi/dostavka/tovary/napolnye-pokrytiya/" },
          { titleKey: "goods.building", url: "/uslugi/dostavka/tovary/stroymaterialy/" },
          { titleKey: "goods.ceramics", url: "/uslugi/dostavka/tovary/keramika-plitka/" },
          { titleKey: "goods.electronics", url: "/uslugi/dostavka/tovary/elektronika/" },
          { titleKey: "goods.parts", url: "/uslugi/dostavka/tovary/zapchasti/" },
          { titleKey: "goods.textile", url: "/uslugi/dostavka/tovary/tekstil/" },
          { titleKey: "goods.equipment", url: "/uslugi/dostavka/tovary/oborudovanie/" },
        ],
      },
      {
        titleKey: "mega.byCity",
        url: "/uslugi/dostavka/goroda/",
        items: [
          { titleKey: "city.moscow", url: "/uslugi/dostavka/goroda/moskva/" },
          { titleKey: "city.spb", url: "/uslugi/dostavka/goroda/sankt-peterburg/" },
          { titleKey: "city.ekb", url: "/uslugi/dostavka/goroda/ekaterinburg/" },
          { titleKey: "city.nsk", url: "/uslugi/dostavka/goroda/novosibirsk/" },
          { titleKey: "city.kazan", url: "/uslugi/dostavka/goroda/kazan/" },
        ],
      },
    ],
  },
  trade: {
    gate: {
      titleKey: "mega.trade.title",
      subtitleKey: "mega.trade.subtitle",
      url: "/torgovlya/",
    },
    // Ссылки ведут на отдельные страницы услуг под /uslugi/torgovlya/.
    services: [
      { titleKey: "trade.search", url: "/uslugi/torgovlya/poisk-postavshchika/", icon: "search" },
      { titleKey: "trade.purchase", url: "/uslugi/torgovlya/vykup-tovara/", icon: "package" },
      { titleKey: "trade.inspection", url: "/uslugi/torgovlya/inspekciya/", icon: "badge-check" },
      { titleKey: "trade.quality", url: "/uslugi/torgovlya/kontrol-proizvodstva/", icon: "factory" },
      { titleKey: "trade.samples", url: "/uslugi/torgovlya/peregovory/", icon: "clipboard-list" },
    ],
  },
};

export default megaMenu;
