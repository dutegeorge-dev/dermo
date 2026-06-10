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

/** Карточка «иконка + заголовок + описание» (безопасность, оплата, услуги). */
export interface LogiCard {
  /** Имя иконки Lucide (см. partials/icon.njk). */
  icon: string;
  title: string;
  desc: string;
}

/** Пункт «заголовок + описание» без иконки (анти-кейсы). */
export interface LogiPoint {
  title: string;
  desc: string;
}

/** Способ доставки: иконка, название, срок и назначение. */
export interface LogiMethod {
  icon: string;
  title: string;
  /** Срок доставки (акцент). */
  time: string;
  desc: string;
}

/** Строка таблицы сравнения «белая доставка / карго». */
export interface LogiTableRow {
  criterion: string;
  white: string;
  cargo: string;
}

/** Строка структуры стоимости: иконка + текст. */
export interface LogiCostItem {
  icon: string;
  text: string;
}

/** Карточка-ссылка примера расчёта. */
export interface LogiLink {
  text: string;
  url: string;
}

/** Вопрос-ответ FAQ. */
export interface LogiQA {
  q: string;
  a: string;
}

/**
 * Контент страницы «Логистика» (/logistika/).
 * Тексты — финальные в ru, заглушки в en/zh. Доступ из шаблонов через
 * глобальные данные `dict.logistika` (вычисляются по локали страницы).
 */
export interface Logistika {
  meta: { title: string; description: string };
  hero: {
    h1: string;
    subtitle: string;
    ctaPrimary: string;
    ctaSecondary: string;
  };
  methods: {
    title: string;
    items: LogiMethod[];
    note: string;
  };
  cargo: {
    title: string;
    intro: string;
    head: { criterion: string; white: string; cargo: string };
    rows: LogiTableRow[];
    antiTitle: string;
    antiCases: LogiPoint[];
    antiNote: string;
  };
  ctaInline1: { text: string; button: string };
  safety: {
    title: string;
    subtitle: string;
    items: LogiCard[];
  };
  payment: {
    title: string;
    intro: string;
    items: LogiCard[];
  };
  cost: {
    title: string;
    intro: string;
    structureTitle: string;
    structure: LogiCostItem[];
    needTitle: string;
    need: string;
  };
  ctaInline2: { text: string; button: string };
  notAgent: { title: string; p1: string; p2: string };
  quote: { text: string; author: string; role: string; photoAlt: string };
  audience: {
    title: string;
    intro: string;
    items: LogiCard[];
  };
  trade: {
    title: string;
    intro1: string;
    intro2: string;
    servicesTitle: string;
    services: LogiCard[];
    cta: string;
  };
  examples: {
    title: string;
    items: LogiLink[];
  };
  faq: {
    title: string;
    items: LogiQA[];
  };
  contacts: {
    title: string;
    text: string;
    phoneRuLabel: string;
    phoneCnLabel: string;
    telegramLabel: string;
    emailLabel: string;
  };
  finalCta: { title: string; subtitle: string; button: string };
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
  /** Контент страницы «Логистика» (/logistika/). */
  logistika: Logistika;
}
