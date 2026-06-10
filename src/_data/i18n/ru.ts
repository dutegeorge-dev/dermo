import type { Dictionary } from "../types.js";

/**
 * Русский словарь — дефолтная локаль, заполнен реальными строками.
 * en.ts и zh.ts повторяют этот интерфейс с заглушками (заполняются позже).
 */
const ru: Dictionary = {
  nav: {
    services: "Услуги",
    cases: "Кейсы",
    blog: "Блог",
    about: "О компании",
    contacts: "Контакты",
  },
  cta: {
    request: "Оставить заявку",
    calculate: "Рассчитать",
    telegram: "Telegram",
  },
  mega: {
    logistics: {
      title: "Логистика",
      subtitle: "Как мы возим из Китая: способы, сроки, документы",
    },
    trade: {
      title: "Торговля",
      subtitle: "Находим, проверяем и закупаем товар в Китае",
    },
    byMethod: "По способу",
    byGoods: "По товару",
    byCity: "По городу",
  },
  method: {
    avto: "Авто",
    zhd: "ЖД",
    more: "Море",
    avia: "Авиа",
  },
  goods: {
    flooring: "Напольные покрытия",
    building: "Стройматериалы",
    ceramics: "Керамика и плитка",
    electronics: "Электроника",
    parts: "Запчасти",
    textile: "Текстиль",
    equipment: "Оборудование",
  },
  city: {
    moscow: "Москва",
    spb: "Санкт-Петербург",
    ekb: "Екатеринбург",
    nsk: "Новосибирск",
    kazan: "Казань",
  },
  trade: {
    search: "Поиск товара / поставщика",
    purchase: "Закупка товара под ключ",
    inspection: "Проверка товара / завода",
    quality: "Контроль качества на производстве",
    samples: "Образцы и переговоры",
  },
  lang: {
    ru: "RU",
    en: "EN",
    zh: "中文",
    switch: "Выбрать язык",
  },
  a11y: {
    openMenu: "Открыть меню",
    closeMenu: "Закрыть меню",
    toggleServices: "Раскрыть меню «Услуги»",
    mainNav: "Основная навигация",
    utilityNav: "Сервисная панель",
    phoneRu: "Телефон в России",
    phoneCn: "Телефон в Китае",
    telegram: "Написать в Telegram",
  },
};

export default ru;
