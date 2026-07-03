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
    "广东省广州市番禺区 汇智三路66号(德舜大厦C塔)ITC国际科创中心19F1913 单元 (офис в Гуанчжоу)",
  workingHours:
    "Отвечаем в течение рабочего дня. Команда работает по китайскому времени (UTC+8) — это +5 часов к Москве.",
  // Google Maps embed (без API-ключа, через q=…&output=embed) по адресу офиса.
  mapEmbedSrc:
    "https://www.google.com/maps?q=%E5%B9%BF%E4%B8%9C%E7%9C%81%E5%B9%BF%E5%B7%9E%E5%B8%82%E7%95%AA%E7%A6%BA%E5%8C%BA%20%E6%B1%87%E6%99%BA%E4%B8%89%E8%B7%AF66%E5%8F%B7(%E5%BE%B7%E8%88%9C%E5%A4%A7%E5%8E%A6C%E5%A1%94)ITC%E5%9B%BD%E9%99%85%E7%A7%91%E5%88%9B%E4%B8%AD%E5%BF%8319F1913%20%E5%8D%95%E5%85%83&output=embed&hl=ru&z=17",
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
