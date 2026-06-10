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
        url: "/dostavka/",
        items: [
          { titleKey: "method.avto", url: "/dostavka/avto/", icon: "truck" },
          { titleKey: "method.zhd", url: "/dostavka/zhd/", icon: "train-front" },
          { titleKey: "method.more", url: "/dostavka/more/", icon: "ship" },
          { titleKey: "method.avia", url: "/dostavka/avia/", icon: "plane" },
        ],
      },
      {
        titleKey: "mega.byGoods",
        url: "/tovary/",
        items: [
          { titleKey: "goods.flooring", url: "/tovary/napolnye-pokrytiya/" },
          { titleKey: "goods.building", url: "/tovary/stroymaterialy/" },
          { titleKey: "goods.ceramics", url: "/tovary/keramika-plitka/" },
          { titleKey: "goods.electronics", url: "/tovary/elektronika/" },
          { titleKey: "goods.parts", url: "/tovary/zapchasti/" },
          { titleKey: "goods.textile", url: "/tovary/tekstil/" },
          { titleKey: "goods.equipment", url: "/tovary/oborudovanie/" },
        ],
      },
      {
        titleKey: "mega.byCity",
        url: "/goroda/",
        items: [
          { titleKey: "city.moscow", url: "/goroda/moskva/" },
          { titleKey: "city.spb", url: "/goroda/sankt-peterburg/" },
          { titleKey: "city.ekb", url: "/goroda/ekaterinburg/" },
          { titleKey: "city.nsk", url: "/goroda/novosibirsk/" },
          { titleKey: "city.kazan", url: "/goroda/kazan/" },
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
    // На старте все ссылки ведут на /torgovlya/ (будущие подстраницы — заглушки).
    services: [
      { titleKey: "trade.search", url: "/torgovlya/", icon: "search" },
      { titleKey: "trade.purchase", url: "/torgovlya/", icon: "package" },
      { titleKey: "trade.inspection", url: "/torgovlya/", icon: "badge-check" },
      { titleKey: "trade.quality", url: "/torgovlya/", icon: "factory" },
      { titleKey: "trade.samples", url: "/torgovlya/", icon: "clipboard-list" },
    ],
  },
};

export default megaMenu;
