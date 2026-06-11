/**
 * Типы данных сайта ООО ТЛК БАРС.
 * Используются для типизации глобальных данных (_data) и front matter.
 */

export interface AnalyticsConfig {
  /** ID счётчика Яндекс.Метрики. Пусто — счётчик не рендерится. */
  yandexMetrika: string;
  /** Measurement ID Google Analytics 4 (G-XXXXXXX). Пусто — тег не рендерится. */
  ga4: string;
}

export interface VerificationConfig {
  /** Содержимое meta yandex-verification. */
  yandex: string;
  /** Содержимое meta google-site-verification. */
  google: string;
}

export interface SiteConfig {
  /** Короткое название бренда. */
  name: string;
  /** Юридическое наименование. */
  legalName: string;
  /** Абсолютный базовый URL сайта без завершающего слеша. */
  url: string;
  /** Локаль для og:locale. */
  locale: string;
  /** Язык сайта (атрибут lang). */
  lang: string;
  /** Заголовок по умолчанию (фолбэк для <title>). */
  defaultTitle: string;
  /** Описание по умолчанию (фолбэк для description). */
  defaultDescription: string;
  /** Путь к OG-картинке по умолчанию (относительный). */
  defaultOgImage: string;
  /** Телефон РФ в человекочитаемом виде. */
  phone: string;
  /** Телефон РФ для href (tel:). */
  phoneHref: string;
  /** Телефон в Китае в человекочитаемом виде. */
  phoneCn: string;
  /** Телефон в Китае для href (tel:). */
  phoneCnHref: string;
  /** URL формы/секции расчёта (на старте — якорь-заглушка). */
  calculateUrl: string;
  /** Ссылка на Telegram. */
  telegram: string;
  /** E-mail для связи. */
  email: string;
  /** Юридический адрес (заглушка). */
  address: string;
  /** ИНН (заглушка). */
  inn: string;
  /** ОГРН (заглушка). */
  ogrn: string;
  analytics: AnalyticsConfig;
  verification: VerificationConfig;
}

/**
 * Пункт основной навигации (ярус 2 хедера).
 * Тексты не хардкодятся: подпись берётся по ключу словаря (`titleKey`).
 */
export interface MainNavItem {
  /** Ключ перевода подписи (например, "nav.services"). */
  titleKey: string;
  /** URL пункта. У пункта-меги (Услуги) ссылки нет — раскрывается панель. */
  url?: string;
  /** true — пункт с мега-меню «Услуги». */
  mega?: boolean;
}

/** Ссылка с иконкой Lucide (способы доставки, торговые услуги). */
export interface MegaLink {
  /** Ключ перевода названия. */
  titleKey: string;
  /** URL ссылки. */
  url: string;
  /** Имя иконки Lucide (см. partials/icon.njk). */
  icon?: string;
}

/** Подгруппа левого крыла с кликабельным подзаголовком-хабом. */
export interface MegaGroup {
  /** Ключ перевода подзаголовка группы. */
  titleKey: string;
  /** URL хаба-раздела (кликабельный подзаголовок). */
  url: string;
  /** Ссылки внутри группы. */
  items: MegaLink[];
}

/** Кликабельные «ворота» крыла — вход на экспертную страницу. */
export interface MegaGate {
  /** Ключ перевода заголовка ворот. */
  titleKey: string;
  /** Ключ перевода подписи под заголовком. */
  subtitleKey: string;
  /** URL целевой страницы крыла. */
  url: string;
}

/** Мега-меню «Услуги»: два крыла — логистика (шире) и торговля. */
export interface MegaMenu {
  /** Левое крыло — Логистика (подгруппы). */
  logistics: {
    gate: MegaGate;
    groups: MegaGroup[];
  };
  /** Правое крыло — Торговля (список услуг). */
  trade: {
    gate: MegaGate;
    services: MegaLink[];
  };
}

/**
 * Факт «полосы доверия» на главной. Текст — по ключам словаря (i18n),
 * иконка — Lucide (см. partials/icon.njk). Данные в _data/home.ts.
 */
export interface TrustFact {
  /** Имя иконки Lucide. */
  icon: string;
  /** Ключ перевода крупного числа/короткой фразы. */
  valueKey: string;
  /** Ключ перевода подписи (серый текст). */
  labelKey: string;
}

/** Шаг процесса «Как мы работаем» (01–07). */
export interface ProcessStep {
  /** Порядковый номер с ведущим нулём ("01"…"07"). */
  num: string;
  /** Имя иконки Lucide. */
  icon: string;
  /** Ключ перевода заголовка шага. */
  titleKey: string;
  /** Ключ перевода текста шага (может содержать разметку — рендерится как safe). */
  textKey: string;
}

/** Крупный парный блок-крыло на главной (Логистика / Торговля). */
export interface HomeWing {
  /** Имя иконки Lucide. */
  icon: string;
  /** Ключ перевода заголовка. */
  titleKey: string;
  /** Ключ перевода описания. */
  descKey: string;
  /** Ключ перевода CTA-ссылки. */
  ctaKey: string;
  /** URL целевой экспертной страницы крыла. */
  url: string;
  /** Ключи перевода тизер-списка (короткие подписи). */
  teaserKeys: string[];
}

/** Данные секций главной (полоса доверия, шаги, крылья). */
export interface HomeData {
  trust: TrustFact[];
  steps: ProcessStep[];
  wings: {
    logistics: HomeWing;
    trade: HomeWing;
  };
}

/**
 * Карточка-услуга с иконкой Lucide и текстом по ключам словаря (i18n).
 * Используется в секциях страницы «Торговля» (услуги полного цикла,
 * отдельные услуги, пункты «что нужно для прямой работы»).
 */
export interface IconCard {
  /** Имя иконки Lucide (см. partials/icon.njk). */
  icon: string;
  /** Ключ перевода заголовка карточки. */
  titleKey: string;
  /** Ключ перевода текста карточки. */
  textKey: string;
}

/** Заголовок + текст по ключам словаря (пункты-преимущества направлений). */
export interface TitleTextKeys {
  titleKey: string;
  textKey: string;
}

/** Услуга-карточка со ссылкой на отдельную страницу услуги (/uslugi/<slug>/). */
export interface ServiceLink {
  /** Имя иконки Lucide (см. partials/icon.njk). */
  icon: string;
  /** Ключ перевода заголовка услуги. */
  titleKey: string;
  /** Ключ перевода текста услуги. */
  textKey: string;
  /** URL страницы услуги. */
  url: string;
}

/** Пара «вопрос — ответ» FAQ по ключам словаря (для аккордеона и FAQPage). */
export interface FaqEntry {
  questionKey: string;
  answerKey: string;
}

/**
 * Структурные данные страницы «Торговля» (/torgovlya/): иконки, номера шагов
 * и ключи словаря. Тексты не хардкодятся — здесь только ссылки на i18n-словарь.
 * Меняется состав/порядок — отражается на странице без правок шаблона.
 */
export interface TorgovlyaData {
  /** «Что нужно для прямой работы с заводом» — 4 пункта. */
  directPoints: IconCard[];
  /** Провинции выезда — ключи словаря. */
  provinces: string[];
  /** «Что даёт выезд на завод» — ключи словаря (3 пункта). */
  guangzhouBenefits: string[];
  /** Единый блок услуг (полный цикл + отдельные) — карточки-ссылки на /uslugi/. */
  services: ServiceLink[];
  /** Этапы работы (процесс закупки) — 7 шагов с номерами. */
  process: ProcessStep[];
  /** Преимущества направления «Напольные покрытия» — 3 пункта. */
  flooringPoints: TitleTextKeys[];
  /** Марки китайских грузовиков — ключи словаря (6). */
  partsBrands: string[];
  /** «Что поставляем» по запчастям — ключи словаря (4). */
  partsSupply: string[];
  /** Преимущества направления «Запчасти» — ключи словаря (3). */
  partsAdvantages: string[];
  /** Типы станков — ключи словаря (4). */
  machineTypes: string[];
  /** «Как работаем» по станкам — ключи словаря (3). */
  machineHow: string[];
  /** Частые вопросы — 8 пар вопрос/ответ. */
  faq: FaqEntry[];
}

/**
 * Карточка-плейсхолдер для секций «Кейсы» и «Блог» на главной.
 * Имитирует будущую запись Decap CMS-коллекции (поэтому тексты — не i18n,
 * а локальные «фейковые записи»). При появлении реальной коллекции карточки
 * рендерятся из неё, а плейсхолдеры остаются фолбэком для дебага.
 */
export interface PlaceholderCard {
  /** Заголовок карточки. */
  title: string;
  /** Короткое описание/анонс. */
  description: string;
  /** Ссылка «Подробнее»/«Читать». */
  url: string;
  /** Дата-заглушка (для блога), ISO или человекочитаемая. */
  date?: string;
}

export interface Breadcrumb {
  name: string;
  url: string;
  /** Признак текущей (последней) крошки — без ссылки. */
  last?: boolean;
}

/**
 * Общий интерфейс словаря переводов.
 * Все три локали (ru/en/zh) реализуют один и тот же интерфейс — пропуск
 * любого ключа в любой локали ловится типчекером (`tsc --noEmit`).
 */
export interface Dictionary {
  nav: {
    services: string;
    cases: string;
    blog: string;
    about: string;
    contacts: string;
  };
  cta: {
    request: string;
    calculate: string;
    telegram: string;
  };
  mega: {
    logistics: { title: string; subtitle: string };
    trade: { title: string; subtitle: string };
    byMethod: string;
    byGoods: string;
    byCity: string;
  };
  method: {
    avto: string;
    zhd: string;
    more: string;
    avia: string;
  };
  goods: {
    flooring: string;
    building: string;
    ceramics: string;
    electronics: string;
    parts: string;
    textile: string;
    equipment: string;
  };
  city: {
    moscow: string;
    spb: string;
    ekb: string;
    nsk: string;
    kazan: string;
  };
  trade: {
    search: string;
    purchase: string;
    inspection: string;
    quality: string;
    samples: string;
  };
  lang: {
    ru: string;
    en: string;
    zh: string;
    switch: string;
  };
  home: {
    hero: {
      title: string;
      subtitle: string;
      /** Подпись вторичной CTA «Как мы работаем». */
      secondary: string;
    };
    heroForm: {
      title: string;
      note: string;
      cargoLabel: string;
      cargoError: string;
      contactLabel: string;
      contactError: string;
      success: string;
    };
    trust: {
      expValue: string;
      expLabel: string;
      teamValue: string;
      teamLabel: string;
      volumeValue: string;
      volumeLabel: string;
      whiteValue: string;
      whiteLabel: string;
      bankValue: string;
      bankLabel: string;
      suppliersValue: string;
      suppliersLabel: string;
    };
    about: {
      title: string;
      p1: string;
      p2: string;
      p3: string;
      link: string;
    };
    wings: {
      title: string;
      subtitle: string;
      logistics: {
        title: string;
        desc: string;
        cta: string;
        t1: string;
        t2: string;
        t3: string;
      };
      trade: {
        title: string;
        desc: string;
        cta: string;
        t1: string;
        t2: string;
        t3: string;
        t4: string;
      };
    };
    steps: {
      title: string;
      s1: { title: string; text: string };
      s2: { title: string; text: string };
      s3: { title: string; text: string };
      s4: { title: string; text: string };
      s5: { title: string; text: string };
      s6: { title: string; text: string };
      s7: { title: string; text: string };
      s8: { title: string; text: string };
    };
    cases: {
      title: string;
      all: string;
      more: string;
    };
    blog: {
      title: string;
      all: string;
      read: string;
    };
    ctaFinal: {
      title: string;
      subtitle: string;
    };
  };
  torgovlya: {
    hero: {
      title: string;
      subtitle: string;
      secondary: string;
    };
    heroForm: {
      title: string;
      note: string;
      cargoLabel: string;
      cargoError: string;
      contactLabel: string;
      contactError: string;
      success: string;
    };
    alibaba: {
      title: string;
      p1: string;
      p2: string;
      p3: string;
      accentValue: string;
      accentLabel: string;
    };
    direct: {
      title: string;
      subtitle: string;
      p1: { title: string; text: string };
      p2: { title: string; text: string };
      p3: { title: string; text: string };
      p4: { title: string; text: string };
      closing: string;
    };
    cta1: string;
    guangzhou: {
      title: string;
      p1: string;
      p2: string;
      provincesLabel: string;
      prov1: string;
      prov2: string;
      prov3: string;
      prov4: string;
      benefitsTitle: string;
      b1: string;
      b2: string;
      b3: string;
    };
    fullCycle: {
      title: string;
      s1: { title: string; text: string };
      s2: { title: string; text: string };
      s3: { title: string; text: string };
      s4: { title: string; text: string };
      s5: { title: string; text: string };
      s6: { title: string; text: string };
      s7: { title: string; text: string };
    };
    services: {
      title: string;
      intro: string;
      more: string;
      allLink: string;
    };
    process: {
      title: string;
      s1: { title: string; text: string };
      s2: { title: string; text: string };
      s3: { title: string; text: string };
      s4: { title: string; text: string };
      s5: { title: string; text: string };
      s6: { title: string; text: string };
      s7: { title: string; text: string };
    };
    cta2: string;
    quality: {
      title: string;
      p1: string;
      p2: string;
      p3: string;
    };
    separate: {
      title: string;
      intro: string;
      s1: { title: string; text: string };
      s2: { title: string; text: string };
      s3: { title: string; text: string };
      s4: { title: string; text: string };
      s5: { title: string; text: string };
      s6: { title: string; text: string };
    };
    cta3: string;
    spec: {
      title: string;
      subtitle: string;
      flooring: {
        title: string;
        lead: string;
        pt1: { title: string; text: string };
        pt2: { title: string; text: string };
        pt3: { title: string; text: string };
        link: string;
      };
      parts: {
        title: string;
        lead: string;
        brandsLabel: string;
        brand1: string;
        brand2: string;
        brand3: string;
        brand4: string;
        brand5: string;
        brand6: string;
        supplyTitle: string;
        supply1: string;
        supply2: string;
        supply3: string;
        supply4: string;
        advantagesTitle: string;
        adv1: string;
        adv2: string;
        adv3: string;
        link: string;
      };
      machines: {
        title: string;
        lead: string;
        typesTitle: string;
        type1: string;
        type2: string;
        type3: string;
        type4: string;
        howTitle: string;
        how1: string;
        how2: string;
        how3: string;
        note: string;
      };
    };
    partnership: {
      title: string;
      p1: string;
      p2: string;
      p3: string;
    };
    logistics: {
      title: string;
      text: string;
      cta: string;
    };
    contacts: {
      title: string;
      text: string;
      phoneRuLabel: string;
      phoneCnLabel: string;
      telegramLabel: string;
      emailLabel: string;
    };
    faq: {
      title: string;
      q1: { q: string; a: string };
      q2: { q: string; a: string };
      q3: { q: string; a: string };
      q4: { q: string; a: string };
      q5: { q: string; a: string };
      q6: { q: string; a: string };
      q7: { q: string; a: string };
      q8: { q: string; a: string };
    };
    ctaFinal: {
      title: string;
      subtitle: string;
      button: string;
    };
  };
  a11y: {
    openMenu: string;
    closeMenu: string;
    toggleServices: string;
    mainNav: string;
    utilityNav: string;
    phoneRu: string;
    phoneCn: string;
    telegram: string;
  };
}
