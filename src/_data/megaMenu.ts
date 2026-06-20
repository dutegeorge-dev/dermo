import type { MegaMenu, MegaLink } from "./types.js";
import uslugi from "./uslugi.js";

/**
 * Названия/иконки/URL торговых услуг — единый источник в _data/uslugi.ts
 * (torgovlyaServices, те же 10, что на витрине /uslugi/torgovlya/). В меню
 * показываем 7 ключевых услуг в порядке логики процесса; остальные доступны
 * по кнопке «Посмотреть все услуги». Так названия в меню, на витрине, в
 * хлебных крошках и перелинковке не расходятся.
 */
const TRADE_MENU_SLUGS = [
  "poisk-postavshchika",
  "vykup-tovara",
  "proverka-zavoda",
  "vozvrat-nds",
  "kontrol-proizvodstva",
  "inspekciya",
  "peregovory",
];

const bySlug = new Map(uslugi.torgovlyaServices.map((s) => [s.slug, s]));
const tradeServices: MegaLink[] = TRADE_MENU_SLUGS.flatMap((slug) => {
  const s = bySlug.get(slug);
  return s ? [{ titleKey: s.nameKey, url: s.url, icon: s.icon }] : [];
});

// Доп. услуги логистики — из того же канонического источника (uslugi.dopUslugi).
const dopUslugiLinks: MegaLink[] = uslugi.dopUslugi.map((s) => ({
  titleKey: s.nameKey,
  url: s.url,
  icon: s.icon,
}));


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
        url: "/uslugi/dostavka/sposoby/",
        column: 1,
        items: [
          { titleKey: "method.avto", url: "/uslugi/dostavka/sposoby/avto/", icon: "truck" },
          { titleKey: "method.zhd", url: "/uslugi/dostavka/sposoby/zhd/", icon: "train-front" },
          { titleKey: "method.more", url: "/uslugi/dostavka/sposoby/more/", icon: "ship" },
          { titleKey: "method.avia", url: "/uslugi/dostavka/sposoby/avia/", icon: "plane" },
        ],
      },
      {
        // Доп. услуги логистики — закреплены внизу колонки 1 (pinBottom), в одну
        // колонку (singleCol). Источник пунктов — uslugi.dopUslugi, заголовок
        // ведёт на хаб /uslugi/dostavka/dop-uslugi/.
        titleKey: "logiExtra.groupTitle",
        url: uslugi.dopUslugiUrl,
        column: 1,
        singleCol: true,
        pinBottom: true,
        items: dopUslugiLinks,
      },
      {
        titleKey: "mega.byGoods",
        url: "/uslugi/dostavka/tovary/",
        column: 2,
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
        column: 2,
        items: [
          { titleKey: "city.moscow", url: "/uslugi/dostavka/goroda/moskva/" },
          { titleKey: "city.spb", url: "/uslugi/dostavka/goroda/sankt-peterburg/" },
          { titleKey: "city.ekb", url: "/uslugi/dostavka/goroda/ekaterinburg/" },
          { titleKey: "city.nsk", url: "/uslugi/dostavka/goroda/novosibirsk/" },
          { titleKey: "city.kazan", url: "/uslugi/dostavka/goroda/kazan/" },
        ],
      },
    ],
    allUrl: uslugi.dostavkaUrl,
  },
  trade: {
    gate: {
      titleKey: "mega.trade.title",
      subtitleKey: "mega.trade.subtitle",
      url: "/torgovlya/",
    },
    // Список услуг и кнопка «все услуги» — из канонического источника (см. выше).
    services: tradeServices,
    allUrl: uslugi.torgovlyaUrl,
  },
};

export default megaMenu;
