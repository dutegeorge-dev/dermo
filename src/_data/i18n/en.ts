import type { Dictionary } from "../types.js";

/**
 * Английский словарь — ЗАГЛУШКИ. Структура полная (тот же интерфейс Dictionary),
 * значения помечены префиксом [EN] и заполняются реальными переводами позже.
 * Переключатель языка и сборка работают технически уже сейчас.
 */
const en: Dictionary = {
  nav: {
    services: "[EN] Услуги",
    cases: "[EN] Кейсы",
    blog: "[EN] Блог",
    about: "[EN] О компании",
    contacts: "[EN] Контакты",
  },
  cta: {
    request: "[EN] Оставить заявку",
    calculate: "[EN] Рассчитать",
    telegram: "Telegram",
  },
  mega: {
    logistics: {
      title: "[EN] Логистика",
      subtitle: "[EN] Как мы возим из Китая: способы, сроки, документы",
    },
    trade: {
      title: "[EN] Торговля",
      subtitle: "[EN] Находим, проверяем и закупаем товар в Китае",
    },
    byMethod: "[EN] По способу",
    byGoods: "[EN] По товару",
    byCity: "[EN] По городу",
  },
  method: {
    avto: "[EN] Авто",
    zhd: "[EN] ЖД",
    more: "[EN] Море",
    avia: "[EN] Авиа",
  },
  goods: {
    flooring: "[EN] Напольные покрытия",
    building: "[EN] Стройматериалы",
    ceramics: "[EN] Керамика и плитка",
    electronics: "[EN] Электроника",
    parts: "[EN] Запчасти",
    textile: "[EN] Текстиль",
    equipment: "[EN] Оборудование",
  },
  city: {
    moscow: "[EN] Москва",
    spb: "[EN] Санкт-Петербург",
    ekb: "[EN] Екатеринбург",
    nsk: "[EN] Новосибирск",
    kazan: "[EN] Казань",
  },
  trade: {
    search: "[EN] Поиск товара / поставщика",
    purchase: "[EN] Закупка товара под ключ",
    inspection: "[EN] Проверка товара / завода",
    quality: "[EN] Контроль качества на производстве",
    samples: "[EN] Образцы и переговоры",
  },
  lang: {
    ru: "RU",
    en: "EN",
    zh: "中文",
    switch: "[EN] Выбрать язык",
  },
  a11y: {
    openMenu: "[EN] Открыть меню",
    closeMenu: "[EN] Закрыть меню",
    toggleServices: "[EN] Раскрыть меню «Услуги»",
    mainNav: "[EN] Основная навигация",
    utilityNav: "[EN] Сервисная панель",
    phoneRu: "[EN] Телефон в России",
    phoneCn: "[EN] Телефон в Китае",
    telegram: "[EN] Написать в Telegram",
  },
};

export default en;
