import type { MegaMenu, MegaLink } from "./types.js";
import uslugi from "./uslugi.js";

/**
 * Названия/иконки/URL торговых услуг — единый источник в _data/uslugi.ts
 * (torgovlyaServices). В меню показываем не все, а четыре ключевые, в порядке
 * логики процесса — меню должно быть коротким. Остальные услуги никуда не
 * делись: они на витрине /uslugi/torgovlya/, куда ведёт «Посмотреть все
 * услуги», и в хлебных крошках своих страниц. Так названия в меню, на витрине
 * и в перелинковке не расходятся.
 */
const TRADE_MENU_SLUGS = [
  "poisk-postavshchika",
  "vykup-tovara",
  "kontrol-proizvodstva",
  "inspekciya",
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
 * Левое крыло (Логистика) — шире: две подгруппы с кликабельными хабами.
 * Правое крыло (Торговля) — уже: список услуг с иконками.
 * Разбивки «По товару» и «По городу» в меню нет — она делала его высоким;
 * эти страницы доступны с витрины /uslugi/dostavka/ и из хлебных крошек.
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
        // Доп. услуги логистики — вторая колонка, в один столбец (singleCol):
        // названия длинные и в два столбца переносятся. Источник пунктов —
        // uslugi.dopUslugi, заголовок ведёт на хаб /uslugi/dostavka/dop-uslugi/.
        titleKey: "logiExtra.groupTitle",
        url: uslugi.dopUslugiUrl,
        column: 2,
        singleCol: true,
        items: dopUslugiLinks,
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
