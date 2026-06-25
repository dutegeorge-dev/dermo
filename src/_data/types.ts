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
  /** Юридическое наименование (короткая форма). */
  legalName: string;
  /** Полное юридическое наименование (для юридических документов). */
  fullLegalName: string;
  /** ФИО генерального директора (для юридических документов). */
  director: string;
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
  /** E-mail для обращений по вопросам обработки персональных данных. */
  privacyEmail: string;
  /** Юридический адрес РФ. */
  address: string;
  /** Адрес офиса в Гуанчжоу (текст для блока контактов и карты). */
  addressCn: string;
  /** Строка о времени ответа с учётом разницы РФ/Китай. */
  workingHours: string;
  /** URL встраиваемой карты (виджет Яндекс.Карт) с меткой офиса в Гуанчжоу. */
  mapEmbedSrc: string;
  /** ИНН. */
  inn: string;
  /** КПП. */
  kpp: string;
  /** ОГРН. */
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
  /** Колонка раскладки левого крыла (1 — левая, 2 — правая). По умолчанию 2. */
  column?: number;
  /** Выводить пункты группы в одну колонку (по умолчанию — в две). */
  singleCol?: boolean;
  /** Прижать группу к низу колонки (выравнивание нижнего края крыла). */
  pinBottom?: boolean;
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
    /** URL витрины «все услуги доставки» (кнопка под группами). */
    allUrl: string;
  };
  /** Правое крыло — Торговля (список услуг). */
  trade: {
    gate: MegaGate;
    services: MegaLink[];
    /** URL витрины «все услуги торговли» (кнопка под списком). */
    allUrl: string;
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
  /** Цветовой код направления: "cyan" (бирюза, логистика) или
   *  "accent" (оранжевый, торговля) — для визуального разделения. */
  tone: "cyan" | "accent";
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
  /** Направления специализации — горизонтальные карточки с фото (3). */
  specDirections: SpecDirection[];
  /** Частые вопросы — 8 пар вопрос/ответ. */
  faq: FaqEntry[];
}

/**
 * Направление специализации — цельная горизонтальная карточка с фото.
 * Фото чередует сторону (photoRight), контент компактный: заголовок + бейдж +
 * строка сути + короткие буллеты + ссылка. Тексты — по ключам словаря.
 */
export interface SpecDirection {
  /** Имя иконки Lucide для плейсхолдера фото. */
  photoIcon: string;
  /** true — фото справа на десктопе (для ритма чередования сторон). */
  photoRight: boolean;
  /** Ключ перевода заголовка направления. */
  titleKey: string;
  /** Ключ перевода бейджа-акцента (напр. «25–40% дешевле»). */
  badgeKey: string;
  /** Ключ перевода строки сути (одна строка, не абзац). */
  leadKey: string;
  /** Ключи перевода коротких буллетов (3–4). */
  bulletKeys: string[];
  /** Ключ перевода подписи ссылки «Подробнее…». */
  linkKey: string;
  /** URL целевой страницы направления. */
  url: string;
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
 * Запись-карточка раздела «Услуги»: способ доставки, категория товара, город,
 * торговая услуга или подраздел витрины. Единый простой формат — иконка Lucide,
 * название по ключу словаря и URL. Из него строятся все сетки карточек.
 */
export interface UslugiEntry {
  /** Слаг (для якорей/отладки; опц. для составных карточек витрины). */
  slug?: string;
  /** Имя иконки Lucide (см. partials/icon.njk). */
  icon: string;
  /** Ключ перевода названия. */
  nameKey: string;
  /** URL страницы. */
  url: string;
}

/**
 * Единый источник структуры раздела «Услуги» (/uslugi/): способы доставки,
 * категории товаров, города и торговые услуги. Из этих данных строятся витрины
 * (сетки карточек), списки и (через URL) хлебные крошки. Тексты — по ключам
 * словаря (i18n).
 */
export interface UslugiData {
  /** URL витрины доставки. */
  dostavkaUrl: string;
  /** URL списка способов доставки. */
  sposobyUrl: string;
  /** URL списка категорий товаров. */
  tovaryUrl: string;
  /** URL списка городов. */
  gorodaUrl: string;
  /** URL хаба дополнительных услуг логистики. */
  dopUslugiUrl: string;
  /** URL витрины торговли. */
  torgovlyaUrl: string;
  /** Способы доставки (4). */
  methods: UslugiEntry[];
  /** Категории товаров. */
  tovary: UslugiEntry[];
  /** Города. */
  goroda: UslugiEntry[];
  /** Дополнительные услуги логистики (хаб dop-uslugi). */
  dopUslugi: UslugiEntry[];
  /** Торговые услуги (10). */
  torgovlyaServices: UslugiEntry[];
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
  /** URL раздела способа доставки (перелинковка). */
  url: string;
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

/** Карточка сотрудника в слайдере команды (имя и фото — плейсхолдеры). */
export interface AboutTeamMember {
  /** Имя сотрудника (плейсхолдер «[Имя]» до наполнения). */
  name: string;
  /** Должность/роль. */
  role: string;
  /** Alt фото-плейсхолдера (для доступности). */
  photoAlt: string;
}

/**
 * Карточка блока «Документы и легальность».
 * Сам документ — плейсхолдер скана; для российского юрлица вместо скана
 * выводятся реквизиты из общих данных сайта (флаг requisites).
 */
export interface AboutDoc {
  /** Имя иконки Lucide. */
  icon: string;
  title: string;
  desc: string;
  /** Подпись к плейсхолдеру скана/фото документа. */
  scanLabel: string;
  /** true — вместо скана показать реквизиты РФ (ИНН/ОГРН/адрес из site). */
  requisites?: boolean;
}

/** Карточка «иконка + заголовок + описание» (отличия «Почему БАРС»). */
export interface AboutWhyItem {
  /** Имя иконки Lucide. */
  icon: string;
  title: string;
  desc: string;
}

/** Карточка партнёра: лого-плейсхолдер + название + подпись + ссылка на сайт. */
export interface AboutPartner {
  name: string;
  desc: string;
  /** Путь к логотипу (плейсхолдер, lazy-load; заменяется реальным лого). */
  logo: string;
  /** URL сайта партнёра (открывается в новой вкладке). */
  url: string;
}

/**
 * Контент страницы «О компании» (/o-kompanii/).
 * Тексты — финальные в ru, заглушки в en/zh. Доступ из шаблонов через
 * глобальные данные `dict.oKompanii` (вычисляются по локали страницы).
 * Принцип честности: НЕТ цифр «N лет / N клиентов / N поставок» —
 * опора на личный опыт руководителя и прозрачность.
 */
export interface OKompanii {
  meta: { title: string; description: string };
  hero: { h1: string; subtitle: string };
  /** Цитата руководителя (личная история, фото-плейсхолдер). */
  quote: { text: string; author: string; role: string; photoAlt: string };
  /** Блок «Кто мы / суть» — 3 абзаца. */
  who: { title: string; p1: string; p2: string; p3: string };
  /** Команда — слайдер карточек с ролями. */
  team: {
    title: string;
    subtitle: string;
    members: AboutTeamMember[];
    /** aria-label стрелок навигации слайдера. */
    prevLabel: string;
    nextLabel: string;
  };
  /** Документы и легальность. */
  docs: {
    title: string;
    subtitle: string;
    items: AboutDoc[];
    /** Подписи реквизитов РФ (значения — из общих данных сайта). */
    legalNameLabel: string;
    innLabel: string;
    ogrnLabel: string;
    addressLabel: string;
  };
  /** «Почему работают с нами» — 5 отличий. */
  why: { title: string; items: AboutWhyItem[] };
  /** Партнёры. */
  partners: { title: string; linkLabel: string; items: AboutPartner[] };
  /** Финальный CTA. */
  finalCta: { title: string; subtitle: string; button: string };
}

/**
 * Тексты простой страницы раздела «Услуги».
 * `title` — заголовок (layout page.njk использует его и как <title>, и как H1);
 * `description` — meta-описание; `subtitle` — вводная строка под заголовком.
 */
export interface UslugiPageText {
  title: string;
  description: string;
  subtitle: string;
}

/** Шаг процесса «Как мы это делаем»: короткий заголовок + пояснение. */
export interface ServiceStep {
  title: string;
  text: string;
  /** Вложенный маркированный список внутри шага (опц.). */
  items?: string[];
}

/** Пункт-боль «Зачем это нужно»: жирный зачин + пояснение. */
export interface ServicePainPoint {
  lead: string;
  text: string;
}

/** Пара «вопрос — ответ» FAQ страницы услуги (уже строки, не ключи). */
export interface ServiceFaqItem {
  q: string;
  a: string;
}

/** Раздел «Кому подходит / с какими товарами работаем» (опц. у услуги). */
export interface ServiceAudience {
  title: string;
  text: string;
  /** Категории товаров/задач, с которыми работаем. */
  categories: string[];
  /** Приписка «если вашей категории нет — напишите». */
  note: string;
}

/** Строка сравнения «Сам / Через агента / Через БАРС». */
export interface ServiceComparisonRow {
  criterion: string;
  self: string;
  agent: string;
  bars: string;
}

/** Раздел-сравнение «Сам, через агента или через БАРС» (опц. у услуги). */
export interface ServiceComparison {
  title: string;
  /** Подписи колонок. */
  columns: { self: string; agent: string; bars: string };
  rows: ServiceComparisonRow[];
}

/**
 * Универсальный раздел-список с жирными зачинами (напр. «Что мы проверяем»,
 * «С чем помогаем»): заголовок + опц. интро + пункты (lead+text) + опц. вывод.
 */
export interface ServiceBulletSection {
  title: string;
  intro?: string;
  items: ServicePainPoint[];
  closing?: string;
}

/**
 * Раздел-оговорка (напр. «Когда метода достаточно, а когда нужен выезд»):
 * заголовок + абзац-интро + вывод-акцент. closing может содержать HTML (ссылку).
 */
export interface ServiceNoteSection {
  title: string;
  intro: string;
  closing: string;
}

/**
 * Тексты страницы торговой услуги на читательском шаблоне (эталон —
 * «Поиск поставщика»). Все строки финальные для RU; en/zh — заглушки.
 * Структура страницы (иконки, URL, перелинковка) — в _data/services.ts.
 */
export interface ServicePageText {
  /** <title> и meta description страницы. */
  metaTitle: string;
  metaDescription: string;
  /** Hero: H1 под поисковый запрос + подзаголовок + подпись фото. */
  hero: { title: string; subtitle: string; photoCaption: string };
  /** Раздел 1 «Что это за услуга»: абзацы. */
  chtoEto: { title: string; paragraphs: string[] };
  /** Раздел «Зачем это нужно»: интро + боли + вывод (опц. — есть не у всех). */
  zachem?: {
    title: string;
    intro: string;
    pains: ServicePainPoint[];
    closing: string;
  };
  /** Раздел «В чём наше отличие»: боли конкурентов + наши преимущества + вывод. */
  otlichie?: {
    title: string;
    intro: string;
    /** Что делают конкуренты (минусы). */
    theirPains: ServicePainPoint[];
    /** Подводка к нашим преимуществам («Мы делаем наоборот:»). */
    oursIntro: string;
    /** Наши преимущества. */
    oursPoints: ServicePainPoint[];
    closing: string;
  };
  /** Раздел-список «Что мы проверяем» (опц.). */
  chtoProveryaem?: ServiceBulletSection;
  /** Раздел-список «С чем помогаем» (опц.). */
  sChem?: ServiceBulletSection;
  /** Раздел «Кому подходит» — опционален (есть не у каждой услуги). */
  komuPodhodit?: ServiceAudience;
  /** Раздел «Как мы это делаем» — опц. интро/вывод вокруг шагов + подпись фото. */
  kakDelaem: {
    title: string;
    /** Вводный абзац перед шагами (опц., может содержать HTML). */
    intro?: string;
    steps: ServiceStep[];
    /** Завершающий абзац после шагов (опц.). */
    outro?: string;
    photoCaption?: string;
  };
  /** Раздел-сравнение «Сам/Агент/БАРС» — опционален. */
  sravnenie?: ServiceComparison;
  /** Раздел «Важные оговорки»: интро + пункты + вывод (опц.). */
  ogovorki?: {
    title: string;
    intro: string;
    points: ServicePainPoint[];
    closing: string;
  };
  /** Раздел-оговорка «Когда метода достаточно, а когда нужен выезд» (опц.). */
  kogda?: ServiceNoteSection;
  /** Раздел «Что вы получаете»: пункты + вывод (опц. — есть не у всех). */
  chtoPoluchaete?: {
    title: string;
    items: string[];
    closing?: string;
  };
  /** Раздел 5 «Частые вопросы» — заголовок + пары вопрос/ответ. */
  faqTitle: string;
  faq: ServiceFaqItem[];
  /** Перелинковка: заголовок блока «вместе заказывают» + ссылка «полный цикл». */
  relatedTitle: string;
  fullCycle: { label: string; text: string };
  /** Подпись ссылки на связанный кейс (если у услуги есть кейс). */
  caseLink?: string;
  /** Финальный CTA. */
  cta: { title: string; subtitle: string; button: string };
}

/**
 * Тексты раздела «Услуги» (три витрины + два списка). Каждая страница —
 * простой шаблон: H1 + подзаголовок + сетка карточек. RU — финальный, en/zh —
 * заглушки (выводятся из ru). Структура карточек (иконки/URL/названия) — в
 * _data/uslugi.ts; здесь только строки страниц и названия торговых услуг,
 * резолвятся фильтром `t`.
 */
export interface UslugiDict {
  /** Витрина верхнего уровня /uslugi/. */
  index: UslugiPageText;
  /** Витрина доставки /uslugi/dostavka/. */
  dostavka: UslugiPageText;
  /** Список способов доставки /uslugi/dostavka/sposoby/. */
  sposobyList: UslugiPageText;
  /** Список категорий товаров /uslugi/dostavka/tovary/. */
  tovaryList: UslugiPageText;
  /** Список городов /uslugi/dostavka/goroda/. */
  gorodaList: UslugiPageText;
  /** Хаб дополнительных услуг /uslugi/dostavka/dop-uslugi/. */
  dopUslugiList: UslugiPageText;
  /** Витрина торговли /uslugi/torgovlya/ + названия 10 услуг. */
  torgovlya: UslugiPageText & {
    services: {
      search: string;
      audit: string;
      negotiations: string;
      control: string;
      inspection: string;
      packaging: string;
      certification: string;
      buyout: string;
      vat: string;
      factoryCheck: string;
    };
    /** Эталонная страница торговой услуги «Поиск поставщика». */
    poisk: ServicePageText;
    /** Страница торговой услуги «Выкуп товара». */
    vykup: ServicePageText;
    /** Страница торговой услуги «Проверка завода». */
    proverka: ServicePageText;
    /** Страница торговой услуги «Возврат экспортного НДС». */
    vozvrat: ServicePageText;
    /** Страница торговой услуги «Контроль производства». */
    kontrol: ServicePageText;
    /** Страница торговой услуги «Инспекция товара». */
    inspekciya: ServicePageText;
    /** Страница торговой услуги «Аудит поставщика». */
    audit: ServicePageText;
    /** Страница торговой услуги «Переговоры». */
    peregovory: ServicePageText;
  };
}

/** Карточка перелинковки «вместе заказывают»: иконка + название + URL. */
export interface ServiceRelatedCard {
  /** Имя иконки Lucide (см. partials/icon.njk). */
  icon: string;
  /** Ключ перевода названия (переиспользуем названия услуг). */
  labelKey: string;
  /** URL страницы услуги. */
  url: string;
}

/**
 * Структура страницы торговой услуги (иконки, URL, перелинковка). Тексты — в
 * i18n-словаре (ветка uslugi.torgovlya.<slug>), резолвятся по i18nBase. Эталон —
 * «Поиск поставщика»; по этому образцу добавляются остальные торговые услуги.
 */
export interface ServicePageConfig {
  /** Слаг страницы (для отладки/ключей). */
  slug: string;
  /** Базовый ключ i18n-ветки услуги (для фильтра t и dump). */
  i18nBase: string;
  /** Иконка-плейсхолдер hero-фото (Lucide). */
  heroIcon: string;
  /** URL CTA «Оставить заявку» (hero и финальный CTA). */
  requestUrl: string;
  /** «Вместе с этим заказывают» — связанные услуги. */
  related: ServiceRelatedCard[];
  /** Ссылка «нужен полный цикл?» (на витрину направления). */
  fullCycleUrl: string;
  /** Связанная статья блога. Пусто → блок не выводится. */
  articleUrl?: string;
  /** Связанный кейс. Пусто → блок не выводится. */
  caseUrl?: string;
}

/** Карта «слаг услуги → конфиг страницы» (глобальные данные `services`). */
export type ServicesData = Record<string, ServicePageConfig>;

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
    telegramWrite: string;
  };
  mega: {
    logistics: { title: string; subtitle: string };
    trade: { title: string; subtitle: string };
    byMethod: string;
    byGoods: string;
    byCity: string;
    allServices: string;
  };
  method: {
    avto: string;
    zhd: string;
    more: string;
    avia: string;
  };
  /** Доп. услуги логистики (группа мега-меню под «По способу»). */
  logiExtra: {
    groupTitle: string;
    customs: string;
    certification: string;
    consolidation: string;
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
        badge: string;
        lead: string;
        b1: string;
        b2: string;
        b3: string;
        link: string;
      };
      parts: {
        title: string;
        badge: string;
        lead: string;
        b1: string;
        b2: string;
        b3: string;
        link: string;
      };
      machines: {
        title: string;
        badge: string;
        lead: string;
        b1: string;
        b2: string;
        b3: string;
        link: string;
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
  /** Общие тексты форм: согласие на обработку ПДн (152-ФЗ). */
  forms: {
    /** Текст согласия до ссылки на политику. */
    consentPrefix: string;
    /** Подпись ссылки на политику конфиденциальности. */
    consentLink: string;
    /** Текст согласия после ссылки. */
    consentSuffix: string;
    /** Ошибка, если согласие не отмечено. */
    consentError: string;
  };
  /** Баннер согласия на использование cookies (глобальный). */
  cookie: {
    /** aria-label контейнера баннера. */
    aria: string;
    /** Текст до ссылки на политику. */
    text: string;
    /** Подпись ссылки на политику конфиденциальности. */
    link: string;
    /** Текст после ссылки (например, точка). */
    suffix: string;
    /** Подпись кнопки «Принять». */
    accept: string;
  };
  /** Контент страницы «Логистика» (/logistika/). */
  logistika: Logistika;
  /** Контент страницы «О компании» (/o-kompanii/). */
  oKompanii: OKompanii;
  /** Тексты раздела «Услуги» (/uslugi/ — три витрины и списки). */
  uslugi: UslugiDict;
}
