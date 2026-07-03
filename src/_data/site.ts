import type { SiteConfig } from "./types.js";

/**
 * Глобальные данные сайта.
 * Аналитика и верификация берутся из переменных окружения, чтобы не хранить
 * реальные ID в репозитории. Если переменная не задана — значение пустое,
 * и соответствующий блок (счётчик/мета) не рендерится.
 */
const site: SiteConfig = {
  name: "ТЛК БАРС",
  legalName: "ООО ТЛК БАРС",
  fullLegalName:
    "ОБЩЕСТВО С ОГРАНИЧЕННОЙ ОТВЕТСТВЕННОСТЬЮ ТОРГОВО-ЛОГИСТИЧЕСКАЯ КОМПАНИЯ БАРС",
  director: "Фотин Евгений Петрович",
  url: process.env.SITE_URL || "https://tlkbars.ru",
  locale: "ru_RU",
  lang: "ru",
  defaultTitle: "ООО ТЛК БАРС — торгово-логистическая компания",
  defaultDescription:
    "Торгово-логистическая компания ООО ТЛК БАРС: доставляем и закупаем товары из Китая под ключ. Белая доставка с полным пакетом документов, команда в Гуанчжоу.",
  defaultOgImage: "/assets/img/og-default.svg",
  phone: "+7 985 967 3614",
  phoneHref: "+79859673614",
  phoneCn: "+86 156 2617 0598",
  phoneCnHref: "+8615626170598",
  calculateUrl: "/kontakty/#raschet",
  telegram: "https://t.me/tlkbars",
  email: "info@tlkbars.ru",
  privacyEmail: "barslogistics@yandex.com",
  address:
    "143408, Московская область, г.о. Красногорск, г. Красногорск, б-р Космонавтов, д. 7, кв. 189",
  addressCn:
    "广东省广州市番禺区 汇智三路66号(德舜大厦C塔)ITC国际科创中心19F1913 单元",
  workingHours:
    "Отвечаем в течение рабочего дня. Команда работает по китайскому времени (UTC+8) — это +5 часов к Москве.",
  // Google Maps embed по координатам офиса. Именно maps.google.com/maps?...
  // &output=embed допускает встраивание в iframe (современный www.google.com/maps
  // фреймить запрещает).
  mapEmbedSrc:
    "https://maps.google.com/maps?q=23.005932295280612,113.34675192492686&z=17&hl=ru&output=embed",
  inn: "5024256988",
  kpp: "502401001",
  ogrn: "1255000095778",
  analytics: {
    yandexMetrika: process.env.YM_COUNTER_ID || "",
    ga4: process.env.GA4_ID || "",
  },
  verification: {
    yandex: process.env.YANDEX_VERIFICATION || "",
    google: process.env.GOOGLE_VERIFICATION || "",
  },
};

export default site;
