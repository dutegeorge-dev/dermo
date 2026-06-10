import type { Dictionary } from "../types.js";
import ru from "./ru.js";

/**
 * Китайский словарь — ЗАГЛУШКИ. Структура полная (тот же интерфейс Dictionary),
 * значения помечены префиксом [ZH] и заполняются реальными переводами позже.
 * Переключатель языка и сборка работают технически уже сейчас.
 */
const zh: Dictionary = {
  nav: {
    services: "[ZH] Услуги",
    cases: "[ZH] Кейсы",
    blog: "[ZH] Блог",
    about: "[ZH] О компании",
    contacts: "[ZH] Контакты",
  },
  cta: {
    request: "[ZH] Оставить заявку",
    calculate: "[ZH] Рассчитать",
    telegram: "Telegram",
  },
  mega: {
    logistics: {
      title: "[ZH] Логистика",
      subtitle: "[ZH] Как мы возим из Китая: способы, сроки, документы",
    },
    trade: {
      title: "[ZH] Торговля",
      subtitle: "[ZH] Находим, проверяем и закупаем товар в Китае",
    },
    byMethod: "[ZH] По способу",
    byGoods: "[ZH] По товару",
    byCity: "[ZH] По городу",
  },
  method: {
    avto: "[ZH] Авто",
    zhd: "[ZH] ЖД",
    more: "[ZH] Море",
    avia: "[ZH] Авиа",
  },
  goods: {
    flooring: "[ZH] Напольные покрытия",
    building: "[ZH] Стройматериалы",
    ceramics: "[ZH] Керамика и плитка",
    electronics: "[ZH] Электроника",
    parts: "[ZH] Запчасти",
    textile: "[ZH] Текстиль",
    equipment: "[ZH] Оборудование",
  },
  city: {
    moscow: "[ZH] Москва",
    spb: "[ZH] Санкт-Петербург",
    ekb: "[ZH] Екатеринбург",
    nsk: "[ZH] Новосибирск",
    kazan: "[ZH] Казань",
  },
  trade: {
    search: "[ZH] Поиск товара / поставщика",
    purchase: "[ZH] Закупка товара под ключ",
    inspection: "[ZH] Проверка товара / завода",
    quality: "[ZH] Контроль качества на производстве",
    samples: "[ZH] Образцы и переговоры",
  },
  lang: {
    ru: "RU",
    en: "EN",
    zh: "中文",
    switch: "[ZH] Выбрать язык",
  },
  a11y: {
    openMenu: "[ZH] Открыть меню",
    closeMenu: "[ZH] Закрыть меню",
    toggleServices: "[ZH] Раскрыть меню «Услуги»",
    mainNav: "[ZH] Основная навигация",
    utilityNav: "[ZH] Сервисная панель",
    phoneRu: "[ZH] Телефон в России",
    phoneCn: "[ZH] Телефон в Китае",
    telegram: "[ZH] Написать в Telegram",
  },
  // Заглушка: большой контент страницы «Логистика» пока берётся из ru —
  // ZH-страница физически не генерируется. Заменим на реальный перевод позже.
  logistika: ru.logistika,
};

export default zh;
