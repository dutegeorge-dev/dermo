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
  url: process.env.SITE_URL || "https://tlkbars.ru",
  locale: "ru_RU",
  lang: "ru",
  defaultTitle: "ООО ТЛК БАРС — торгово-логистическая компания",
  defaultDescription:
    "Торгово-логистическая компания ООО ТЛК БАРС: доставляем и закупаем товары из Китая под ключ. Белая доставка с полным пакетом документов, команда в Гуанчжоу.",
  defaultOgImage: "/assets/img/og-default.svg",
  phone: "+7 (000) 000-00-00",
  phoneHref: "+70000000000",
  phoneCn: "+86 000 0000 0000",
  phoneCnHref: "+8600000000000",
  calculateUrl: "/kontakty/#raschet",
  telegram: "https://t.me/tlkbars",
  email: "info@tlkbars.ru",
  address: "Россия, г. Москва (адрес уточняется)",
  addressCn: "Китай, г. Гуанчжоу (адрес офиса уточняется)",
  workingHours:
    "Отвечаем в течение рабочего дня. Команда работает по китайскому времени (UTC+8) — это +5 часов к Москве.",
  mapEmbedSrc:
    "https://yandex.ru/map-widget/v1/?ll=113.264385%2C23.129163&z=11&mode=search&text=%D0%93%D1%83%D0%B0%D0%BD%D1%87%D0%B6%D0%BE%D1%83",
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
