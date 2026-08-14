import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import Image from "@11ty/eleventy-img";
import { loadDotEnv } from "./server/dotenv.ts";
import type { Breadcrumb, Dictionary } from "./src/_data/types.js";
import ruDict from "./src/_data/i18n/ru.js";
import enDict from "./src/_data/i18n/en.js";
import zhDict from "./src/_data/i18n/zh.js";

// Переменные из .env должны попасть в process.env ДО того, как 11ty
// вычислит глобальные данные: site.ts читает SITE_URL, LEAD_API_URL и ID
// счётчиков именно оттуда, и их значения вшиваются в готовый HTML.
loadDotEnv();

/** Поддерживаемые локали. ru — дефолт (в корне), en/zh — с URL-префиксом. */
const LOCALES = ["ru", "en", "zh"] as const;
type Locale = (typeof LOCALES)[number];

const DICTS: Record<Locale, Dictionary> = {
  ru: ruDict,
  en: enDict,
  zh: zhDict,
};

/** Достаёт значение по dot-path ("nav.services") из словаря. */
function resolveKey(dict: Dictionary, key: string): string | undefined {
  const value = key.split(".").reduce<unknown>((acc, part) => {
    if (acc && typeof acc === "object" && part in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[part];
    }
    return undefined;
  }, dict);
  return typeof value === "string" ? value : undefined;
}

/** Перевод ключа в локали с фолбэком на ru, затем на сам ключ. */
function translate(key: string, locale: string): string {
  const loc = (LOCALES as readonly string[]).includes(locale)
    ? (locale as Locale)
    : "ru";
  return resolveKey(DICTS[loc], key) ?? resolveKey(DICTS.ru, key) ?? key;
}

/** Локаль из URL: /en/... → en, /zh/... → zh, иначе ru. */
function localeFromUrl(url: string): Locale {
  const match = /^\/(en|zh)(\/|$)/.exec(url || "/");
  return match ? (match[1] as Locale) : "ru";
}

/** Канонический (ru) путь без языкового префикса. */
function stripLocale(path: string): string {
  return (path || "/").replace(/^\/(en|zh)(\/|$)/, "/");
}

/** Тот же путь в указанной локали (ru — без префикса, en/zh — с префиксом). */
function localizedUrl(path: string, locale: string): string {
  const base = stripLocale(path);
  if (locale === "ru") return base;
  return `/${locale}${base}`.replace(/\/{2,}/g, "/");
}

/**
 * Карта слаг → человекочитаемая подпись.
 * Используется для генерации заголовков-заглушек и хлебных крошек,
 * чтобы не дублировать тексты в каждом шаблоне.
 */
const LABELS: Record<string, string> = {
  logistika: "Логистика",
  torgovlya: "Торговля",
  "o-kompanii": "О компании",
  kontakty: "Контакты",
  "politika-konfidencialnosti": "Политика конфиденциальности",
  spasibo: "Заявка принята",
  dostavka: "Доставка",
  sposoby: "Способы",
  "dop-uslugi": "Дополнительные услуги",
  "tamozhennoe-oformlenie": "Таможенное оформление",
  "sbornye-gruzy": "Сборные грузы",
  avto: "Автодоставка",
  zhd: "Железнодорожная доставка",
  more: "Морская доставка",
  avia: "Авиадоставка",
  tovary: "Товары",
  uslugi: "Услуги",
  "poisk-postavshchika": "Поиск поставщика",
  "audit-proizvodstva": "Аудит производства",
  peregovory: "Переговоры",
  "kontrol-proizvodstva": "Контроль производства",
  inspekciya: "Инспекция",
  "upakovka-markirovka": "Упаковка и маркировка",
  "vykup-tovara": "Выкуп товара",
  "vozvrat-nds": "Возврат экспортного НДС",
  "proverka-zavoda": "Проверка завода",
  sertifikaciya: "Сертификация",
  "napolnye-pokrytiya": "Напольные покрытия",
  stroymaterialy: "Стройматериалы",
  elektronika: "Электроника",
  zapchasti: "Запчасти для грузовиков",
  tekstil: "Текстиль",
  oborudovanie: "Оборудование",
  goroda: "Города",
  moskva: "Москва",
  "sankt-peterburg": "Санкт-Петербург",
  ekaterinburg: "Екатеринбург",
  novosibirsk: "Новосибирск",
  kazan: "Казань",
  blagoveshchensk: "Благовещенск",
  kejsy: "Кейсы",
  "poisk-postavshchika-gazon": "Поиск поставщика искусственного газона",
  "kontrol-proizvodstva-7000": "Контроль производства: предотвращённый убыток $7000",
  "zapchasti-gruzoviki": "Запчасти для китайского грузовика",
  blog: "Блог",
  r: "Акция",
  "belaya-dostavka": "Белая доставка",
};

/**
 * Строит список хлебных крошек из URL страницы.
 * Всегда начинается с «Главная». Последняя крошка помечается last (без ссылки).
 */
function buildBreadcrumbs(url: string, title?: string): Breadcrumb[] {
  const parts = url.split("/").filter(Boolean);
  const crumbs: Breadcrumb[] = [{ name: "Главная", url: "/" }];
  let acc = "";
  parts.forEach((part, index) => {
    acc += `/${part}`;
    const last = index === parts.length - 1;
    // Последняя крошка для контента (блог/кейсы) — заголовок страницы, если
    // слаг не описан в LABELS (статьи/кейсы создаются динамически).
    crumbs.push({
      name: LABELS[part] || (last && title) || part,
      url: `${acc}/`,
      last,
    });
  });
  return crumbs;
}

/**
 * Замены фото-плейсхолдеров, заданные из админки (Decap-коллекция «Фотографии
 * сайта»). Файлы photos/<раздел>.json хранят карту «ключ плейсхолдера → путь к
 * загруженному фото». Ключ = имя файла-плейсхолдера без пути и расширения
 * (например usluga-poisk-postavshchika-hero-4x3). Читаем на каждом вызове —
 * чтобы правки из CMS подхватывались при пересборке (в т.ч. в dev).
 */
function loadPhotoOverrides(): Record<string, string> {
  const dir = path.join(process.cwd(), "photos");
  const map: Record<string, string> = {};
  if (!fs.existsSync(dir)) return map;
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith(".json")) continue;
    try {
      const obj = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
      for (const [key, value] of Object.entries(obj)) {
        if (typeof value === "string" && value) map[key] = value;
      }
    } catch {
      // повреждённый JSON игнорируем — используется исходный плейсхолдер.
    }
  }
  return map;
}

/**
 * eleventy-img: оптимизированная картинка (AVIF + WebP + исходный формат),
 * srcset, lazy-loading и width/height (защита от сдвига layout — CLS).
 * Источник — путь от корня сайта (например /assets/img/uploads/foo.jpg),
 * который резолвится в файл внутри src/. Если для плейсхолдера в админке задана
 * замена (photos/*.json) — берём её вместо исходного файла. Если файла нет —
 * возвращаем пустую строку (без падения сборки).
 */
async function imageShortcode(
  src: string,
  alt = "",
  sizes = "100vw",
  className = "",
): Promise<string> {
  if (!src) return "";

  // Замена плейсхолдера фотографией, загруженной через админку.
  if (src.startsWith("/assets/img/uploads/")) {
    const key = path.basename(src).replace(/\.[^.]+$/, "");
    const override = loadPhotoOverrides()[key];
    if (override && override !== src) {
      const overridePath = override.startsWith("/")
        ? path.join("src", override.replace(/^\//, ""))
        : override;
      if (fs.existsSync(overridePath)) src = override;
    }
  }

  const inputPath = src.startsWith("/")
    ? path.join("src", src.replace(/^\//, ""))
    : src;
  if (!fs.existsSync(inputPath)) return "";

  const metadata = await Image(inputPath, {
    widths: [400, 800, 1200],
    // null — исходный формат как фолбэк (jpg/png), сохраняет прозрачность PNG.
    formats: ["avif", "webp", null],
    outputDir: "./_site/assets/img/optimized/",
    urlPath: "/assets/img/optimized/",
  });

  return Image.generateHTML(metadata, {
    alt,
    sizes,
    loading: "lazy",
    decoding: "async",
    ...(className ? { class: className } : {}),
  });
}

// Тип конфигуратора 11ty намеренно ослаблен: пакет не экспортирует строгий
// публичный тип для аргумента конфиг-функции в текущей версии.
type EleventyConfig = {
  addDataExtension: (ext: string, options: unknown) => void;
  addPassthroughCopy: (path: unknown) => void;
  addWatchTarget: (path: string) => void;
  setTemplateFormats: (formats: string[] | string) => void;
  addFilter: (name: string, fn: (...args: any[]) => unknown) => void;
  addGlobalData: (name: string, value: unknown) => void;
  addNunjucksAsyncShortcode: (
    name: string,
    fn: (...args: any[]) => Promise<string>,
  ) => void;
  ignores: Set<string>;
};

export default function (eleventyConfig: EleventyConfig) {
  // Поддержка дата-файлов на TypeScript (_data/*.ts и *.11tydata.ts).
  // tsx-загрузчик (node --import tsx) делает динамический import .ts рабочим.
  eleventyConfig.addDataExtension("ts", {
    read: false,
    parser: async (filePath: string) => {
      const mod = await import(
        `${pathToFileURL(filePath).href}?cacheBust=${Date.now()}`
      );
      return mod.default ?? mod;
    },
  });

  // Статика: картинки, self-hosted шрифты (Onest woff2) и Decap CMS-админка.
  eleventyConfig.addPassthroughCopy({ "src/assets/img": "assets/img" });
  eleventyConfig.addPassthroughCopy({ "src/assets/fonts": "assets/fonts" });
  eleventyConfig.addPassthroughCopy({ admin: "admin" });

  // Сырые Markdown-файлы блога и кейсов НЕ обрабатываются как шаблоны 11ty:
  // их читает и рендерит контентная библиотека (src/_data/library.ts), а
  // страницы генерируются пагинацией (src/blog-pages.njk, src/kejsy-pages.njk).
  eleventyConfig.ignores.add("src/blog/**/*.md");
  eleventyConfig.ignores.add("src/kejsy/**/*.md");

  // eleventy-img: единый шорткод вставки оптимизированных фото по всему сайту.
  // {% image "путь", "alt", "sizes", "css-классы" %}
  eleventyConfig.addNunjucksAsyncShortcode("image", imageShortcode);

  // CSS и JS собираются вне 11ty (postcss/esbuild) прямо в _site —
  // следим за изменениями, чтобы browsersync перезагружал страницу.
  eleventyConfig.addWatchTarget("./_site/assets/css/styles.css");
  eleventyConfig.addWatchTarget("./_site/assets/js/main.js");
  // Замены фото из админки (Decap) — пересобираемся при их изменении.
  eleventyConfig.addWatchTarget("./photos");

  eleventyConfig.setTemplateFormats(["njk", "md"]);

  // Фильтр хлебных крошек (для партиалов навигации и JSON-LD BreadcrumbList).
  // Опциональный title — подпись последней крошки для контента (блог/кейсы).
  eleventyConfig.addFilter("breadcrumbs", (url: string, title?: string) =>
    buildBreadcrumbs(url, title),
  );

  // Абсолютный URL из относительного пути.
  eleventyConfig.addFilter("absoluteUrl", (path: string, base: string) => {
    if (!path) return base;
    if (/^https?:\/\//.test(path)) return path;
    return `${base.replace(/\/$/, "")}${path}`;
  });

  // i18n: перевод ключа в локали — {{ "nav.services" | t(locale) }}.
  eleventyConfig.addFilter("t", (key: string, locale: string) =>
    translate(key, locale),
  );

  // i18n: тот же путь в другой локали (для переключателя языка и hreflang).
  eleventyConfig.addFilter("localizedUrl", (path: string, locale: string) =>
    localizedUrl(path, locale),
  );

  // Список локалей — для генерации hreflang в <head>.
  eleventyConfig.addGlobalData("locales", LOCALES);

  // Дата в ISO (для sitemap lastmod и <time datetime>).
  eleventyConfig.addFilter("isoDate", (value: Date | string) => {
    const date = value instanceof Date ? value : new Date(value);
    return date.toISOString();
  });

  // Дата в человекочитаемом русском формате (для шаблона статьи).
  eleventyConfig.addFilter("readableDate", (value: Date | string) => {
    const date = value instanceof Date ? value : new Date(value);
    return date.toLocaleDateString("ru-RU", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  });

  // Глобальные вычисляемые данные: заголовок-заглушка из карты LABELS,
  // если страница не задала свой title во front matter.
  eleventyConfig.addGlobalData("eleventyComputed", {
    title: (data: {
      title?: string;
      titleKey?: string;
      page?: { fileSlug?: string; url?: string };
      site?: { defaultTitle?: string };
    }) =>
      data.title ||
      (data.titleKey
        ? translate(data.titleKey, localeFromUrl(data.page?.url || "/"))
        : undefined) ||
      (data.page?.fileSlug ? LABELS[data.page.fileSlug] : undefined) ||
      data.site?.defaultTitle ||
      "",
    // Описание для <head>: из front matter (description) или из словаря
    // (descriptionKey), иначе — дефолт сайта.
    description: (data: {
      description?: string;
      descriptionKey?: string;
      page?: { url?: string };
      site?: { defaultDescription?: string };
    }) =>
      data.description ||
      (data.descriptionKey
        ? translate(data.descriptionKey, localeFromUrl(data.page?.url || "/"))
        : undefined) ||
      data.site?.defaultDescription ||
      "",
    // Текущая локаль страницы, выведенная из URL (ru по умолчанию).
    // Доступна во всех шаблонах как `locale` (хедер, base-layout, hreflang).
    locale: (data: { page?: { url?: string } }) =>
      localeFromUrl(data.page?.url || "/"),
    // Словарь текущей локали целиком — для секций со структурированным
    // контентом (массивы карточек/строк/FAQ), которые нельзя достать через
    // строковый фильтр `t`. Доступен в шаблонах как `dict` (например
    // `dict.logistika.faq.items`). Тексты по-прежнему живут в i18n-словаре.
    dict: (data: { page?: { url?: string } }) =>
      DICTS[localeFromUrl(data.page?.url || "/")],
  });

  return {
    dir: {
      input: "src",
      output: "_site",
      includes: "_includes",
      data: "_data",
    },
    // Завершающий слеш в URL обеспечивается permalink-шаблонами в данных папок.
    markdownTemplateEngine: "njk",
    htmlTemplateEngine: "njk",
  };
}
