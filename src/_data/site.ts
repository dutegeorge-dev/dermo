import type { SiteConfig } from "./types.js";

/**
 * Глобальные данные сайта.
 * Аналитика и верификация берутся из переменных окружения, чтобы не хранить
 * реальные ID в репозитории. Если переменная не задана — значение пустое,
 * и соответствующий блок (счётчик/мета) не рендерится.
 */
const site: SiteConfig = {
  name: "ТЛК БАРС",
  legalName: "ООО «ТЛК БАРС»",
  url: process.env.SITE_URL || "https://tlk-bars.ru",
  locale: "ru_RU",
  lang: "ru",
  defaultTitle: "ООО ТЛК БАРС — транспортно-логистическая компания",
  defaultDescription:
    "Транспортно-логистическая компания ООО ТЛК БАРС: доставка грузов автотранспортом, ЖД, морем и авиа по России.",
  defaultOgImage: "/assets/img/og-default.svg",
  phone: "+7 (000) 000-00-00",
  phoneHref: "+70000000000",
  phoneCn: "+86 000 0000 0000",
  phoneCnHref: "+8600000000000",
  calculateUrl: "/kontakty/#raschet",
  telegram: "https://t.me/tlkbars",
  email: "info@tlk-bars.ru",
  address: "Россия, г. Москва (адрес уточняется)",
  inn: "0000000000",
  ogrn: "0000000000000",
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
