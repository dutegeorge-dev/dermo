import type { Dictionary } from "../types.js";
import ru from "./ru.js";

/**
 * Рекурсивно префиксует все строковые листья объекта (для крупных секций-заглушек,
 * чтобы не дублировать структуру вручную). Тип сохраняется — typecheck сверяет
 * результат с интерфейсом Dictionary.
 */
function stubBranch<T>(value: T, prefix: string): T {
  if (typeof value === "string") return (prefix + value) as unknown as T;
  if (Array.isArray(value)) {
    return value.map((item) => stubBranch(item, prefix)) as unknown as T;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      out[key] = stubBranch(val, prefix);
    }
    return out as T;
  }
  return value;
}

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
  home: {
    hero: {
      title: "[EN] ООО ТЛК БАРС — торгово-логистическая компания",
      subtitle:
        "[EN] Доставляем и закупаем товары из Китая под ключ. Белая доставка с полным пакетом документов, команда в Гуанчжоу, прямая работа с заводами.",
      secondary: "[EN] Как мы работаем",
    },
    heroForm: {
      title: "[EN] Рассчитать стоимость",
      note: "[EN] Ответим в течение рабочего дня",
      cargoLabel: "[EN] Что везёте или что нужно закупить",
      cargoError: "[EN] Укажите товар или задачу.",
      contactLabel: "[EN] Телефон или Telegram",
      contactError: "[EN] Укажите корректный телефон или Telegram.",
      success: "[EN] Заявка отправлена! Свяжемся с вами в течение рабочего дня.",
    },
    trust: {
      expValue: "[EN] 18 лет",
      expLabel: "[EN] опыт работы с Китаем",
      teamValue: "[EN] Гуанчжоу",
      teamLabel: "[EN] собственная команда в Китае",
      volumeValue: "[EN] 100 тонн",
      volumeLabel: "[EN] объём отправок в месяц",
      whiteValue: "[EN] Белая",
      whiteLabel: "[EN] доставка и полный пакет документов",
      bankValue: "[EN] ВТБ",
      bankLabel: "[EN] банк-партнёр",
      suppliersValue: "[EN] Проверенные",
      suppliersLabel: "[EN] заводы и прямые контракты",
    },
    about: {
      title: "[EN] Кто мы",
      p1: "[EN] ТЛК БАРС — торгово-логистическая компания, которая соединяет две задачи импортёра в одном окне.",
      p2: "[EN] Команда физически находится в Гуанчжоу и работает с заводами напрямую.",
      p3: "[EN] Это позволяет клиенту получить заводскую цену без наценки посредников и белую доставку.",
      link: "[EN] Подробнее о компании →",
    },
    wings: {
      title: "[EN] Одна компания — два направления",
      subtitle: "[EN] Закупаем товар в Китае и доставляем его в Россию — в одном окне.",
      logistics: {
        title: "[EN] Логистика",
        desc: "[EN] Возим грузы из Китая всеми способами — авто, ЖД, море, авиа. Берём на себя таможенное оформление.",
        cta: "[EN] Почитать о доставке →",
        t1: "[EN] По способу",
        t2: "[EN] По товару",
        t3: "[EN] По городу",
      },
      trade: {
        title: "[EN] Торговля",
        desc: "[EN] Находим товар и проверенного поставщика, проверяем завод, контролируем качество и закупаем под ключ.",
        cta: "[EN] Почитать о поставках из Китая →",
        t1: "[EN] Поиск",
        t2: "[EN] Закупка",
        t3: "[EN] Проверка",
        t4: "[EN] Контроль качества",
      },
    },
    steps: {
      title: "[EN] Как мы работаем",
      s1: {
        title: "[EN] Заявка",
        text: '[EN] Вы оставляете <a href="/kontakty/#raschet" class="font-medium text-cyan-dark underline decoration-cyan/40 underline-offset-2 hover:decoration-cyan">заявку</a> — менеджер связывается и направляет КП.',
      },
      s2: {
        title: "[EN] Договор",
        text: "[EN] Заключаем договор с российским юрлицом. Оплата на расчётный счёт в рублях.",
      },
      s3: {
        title: "[EN] Склад в Китае",
        text: "[EN] Принимаем ваш груз на собственный склад в Китае.",
      },
      s4: {
        title: "[EN] Проверка и маркировка",
        text: "[EN] Проверяем товар на складе в Китае и наносим маркировку по требованиям РФ.",
      },
      s5: {
        title: "[EN] Документы",
        text: "[EN] Готовим полный пакет документов для таможенного оформления.",
      },
      s6: {
        title: "[EN] Отправка",
        text: "[EN] Грузим товар и отправляем выбранным способом доставки.",
      },
      s7: {
        title: "[EN] Таможня",
        text: "[EN] Проходим таможенный контроль на границе и доставляем груз.",
      },
      s8: {
        title: "[EN] Выдача",
        text: "[EN] Сообщаем о прибытии и передаём груз с полным комплектом документов.",
      },
    },
    cases: {
      title: "[EN] Кейсы",
      all: "[EN] Все кейсы",
      more: "[EN] Подробнее",
    },
    blog: {
      title: "[EN] Блог",
      all: "[EN] Все статьи",
      read: "[EN] Читать",
    },
    ctaFinal: {
      title: "[EN] Рассчитаем стоимость доставки или закупки",
      subtitle: "[EN] Опишите задачу — подготовим расчёт и предложение.",
    },
  },
  // Крупная экспертная секция — заглушка выводится из ru с префиксом [EN].
  torgovlya: stubBranch(ru.torgovlya, "[EN] "),
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
