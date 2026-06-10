import { pathToFileURL } from "node:url";
import type { Breadcrumb, Dictionary } from "./src/_data/types.js";
import ruDict from "./src/_data/i18n/ru.js";
import enDict from "./src/_data/i18n/en.js";
import zhDict from "./src/_data/i18n/zh.js";

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
  dostavka: "Доставка",
  avto: "Доставка автотранспортом",
  zhd: "Доставка ЖД",
  more: "Доставка морем",
  avia: "Доставка авиа",
  tovary: "Товары",
  "napolnye-pokrytiya": "Напольные покрытия",
  stroymaterialy: "Стройматериалы",
  "keramika-plitka": "Керамика и плитка",
  elektronika: "Электроника",
  zapchasti: "Запчасти",
  tekstil: "Текстиль",
  oborudovanie: "Оборудование",
  goroda: "Города",
  moskva: "Москва",
  "sankt-peterburg": "Санкт-Петербург",
  ekaterinburg: "Екатеринбург",
  novosibirsk: "Новосибирск",
  kazan: "Казань",
  kejsy: "Кейсы",
  blog: "Блог",
  r: "Акция",
  "belaya-dostavka": "Белая доставка",
};

/**
 * Строит список хлебных крошек из URL страницы.
 * Всегда начинается с «Главная». Последняя крошка помечается last (без ссылки).
 */
function buildBreadcrumbs(url: string): Breadcrumb[] {
  const parts = url.split("/").filter(Boolean);
  const crumbs: Breadcrumb[] = [{ name: "Главная", url: "/" }];
  let acc = "";
  parts.forEach((part, index) => {
    acc += `/${part}`;
    crumbs.push({
      name: LABELS[part] || part,
      url: `${acc}/`,
      last: index === parts.length - 1,
    });
  });
  return crumbs;
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

  // CSS и JS собираются вне 11ty (postcss/esbuild) прямо в _site —
  // следим за изменениями, чтобы browsersync перезагружал страницу.
  eleventyConfig.addWatchTarget("./_site/assets/css/styles.css");
  eleventyConfig.addWatchTarget("./_site/assets/js/main.js");

  eleventyConfig.setTemplateFormats(["njk", "md"]);

  // Фильтр хлебных крошек (для партиалов навигации и JSON-LD BreadcrumbList).
  eleventyConfig.addFilter("breadcrumbs", (url: string) =>
    buildBreadcrumbs(url),
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
      page?: { fileSlug?: string };
      site?: { defaultTitle?: string };
    }) =>
      data.title ||
      (data.page?.fileSlug ? LABELS[data.page.fileSlug] : undefined) ||
      data.site?.defaultTitle ||
      "",
    // Текущая локаль страницы, выведенная из URL (ru по умолчанию).
    // Доступна во всех шаблонах как `locale` (хедер, base-layout, hreflang).
    locale: (data: { page?: { url?: string } }) =>
      localeFromUrl(data.page?.url || "/"),
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
