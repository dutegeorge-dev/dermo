import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import MarkdownIt from "markdown-it";
import anchor from "markdown-it-anchor";
import Image from "@11ty/eleventy-img";

/**
 * Контентная библиотека блога и кейсов из Markdown (мультиязычная).
 *
 * Источник — файлы `src/blog/<slug>.<lang>.md` и `src/kejsy/<slug>.<lang>.md`,
 * где lang ∈ ru|en|zh. Русский обязателен; en/zh — опциональны.
 *
 * Этот файл-данные сам читает файлы, парсит front matter (gray-matter) и
 * рендерит тело Markdown (markdown-it + автоякоря на h2/h3), а не отдаёт это
 * стандартному конвейеру 11ty. Так контролируется фолбэк на русский и единый
 * рендер для всех языковых версий. Сырые .md из коллекций исключены из обработки
 * шаблонов (см. eleventy.config.ts → ignores).
 *
 * Что отдаётся шаблонам (глобально как `library`):
 *   - renderBlog / renderKejsy — плоские списки «единиц рендера»: по одной на
 *     каждую пару (slug × язык ru/en/zh) с фолбэком на ru. По ним пагинацией
 *     генерируются страницы /blog/<slug>/, /en/blog/<slug>/, /zh/blog/<slug>/ и
 *     аналогично /kejsy/. Черновики (draft) исключены.
 *   - blog / kejsy — карточки для витрин по языкам: { ru:[…], en:[…], zh:[…] },
 *     новые сверху, без черновиков.
 *   - byService — обратная связка услуга→статья: slug услуги → карточка статьи
 *     (для блока «связанная статья» на странице услуги).
 */

const LANGS = ["ru", "en", "zh"] as const;
type Lang = (typeof LANGS)[number];

const COLLECTIONS = [
  { name: "blog", dir: "src/blog" },
  { name: "kejsy", dir: "src/kejsy" },
] as const;

/** Единица рендера одной языковой версии статьи/кейса. */
export interface RenderUnit {
  collection: string;
  slug: string;
  lang: Lang;
  /** Локализованный URL страницы (ru — без префикса). */
  url: string;
  title: string;
  description: string;
  /** Путь к обложке (как задан во front matter), пусто — обложки нет. */
  cover: string;
  /** Alt обложки (из front matter `alt` или заголовка). */
  alt: string;
  /** Slug связанной услуги (для блока «Закажите у нас»), пусто — нет. */
  relatedService: string;
  /** Короткий итог кейса (только кейсы), пусто — нет. */
  result: string;
  /** Дата публикации (ISO, по русской версии — каноническая). */
  date: string;
  /** Отрендеренный HTML тела статьи. */
  html: string;
  /** true — перевода на этот язык нет, показывается русский контент (фолбэк). */
  isFallback: boolean;
  /** Соседи в витрине (та же коллекция и язык, порядок «новые сверху»):
   *  prev — предыдущая (более новая) запись, next — следующая (более старая). */
  prev?: NavLink;
  next?: NavLink;
}

/** Ссылка на соседнюю статью/кейс (для навигации в конце страницы). */
export interface NavLink {
  url: string;
  title: string;
}

/** Карточка для витрин и перелинковки. */
export interface ContentCard {
  url: string;
  title: string;
  description: string;
  cover: string;
  alt: string;
  result: string;
  date: string;
}

/** Якорь-совместимый slug: сохраняет кириллицу, схлопывает разделители. */
function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
}

const md = new MarkdownIt({ html: true, linkify: true, typographer: true });
md.use(anchor, { level: [2, 3], slugify });

/** Разбирает имя файла `<slug>.<lang>.md` → { slug, lang }. Без языка → ru. */
function parseName(file: string): { slug: string; lang: Lang } {
  const base = file.replace(/\.md$/, "");
  const match = /^(.*)\.(ru|en|zh)$/.exec(base);
  if (match) return { slug: match[1], lang: match[2] as Lang };
  return { slug: base, lang: "ru" };
}

/** Любую дату (Date из YAML или строку) приводит к ISO-строке. */
function toISO(value: unknown): string {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

/** URL языковой версии (ru — в корне, en/zh — с префиксом). */
function urlFor(collection: string, slug: string, lang: Lang): string {
  return lang === "ru"
    ? `/${collection}/${slug}/`
    : `/${lang}/${collection}/${slug}/`;
}

/**
 * Прогоняет одну картинку (из Markdown-тела) через eleventy-img: AVIF/WebP +
 * исходный формат, srcset, lazy, width/height (без CLS). Логика та же, что у
 * шорткода {% image %} в eleventy.config.ts — так фото, вставленные в тело
 * статьи/кейса (в т.ч. через Decap), тоже оптимизируются. Если файла нет —
 * возвращаем простой lazy-<img> (без падения сборки).
 */
async function optimizeContentImage(src: string, alt: string): Promise<string> {
  if (!src.startsWith("/")) {
    return `<img src="${src}" alt="${alt}" loading="lazy" decoding="async">`;
  }
  const inputPath = path.join(process.cwd(), "src", src.replace(/^\//, ""));
  if (!fs.existsSync(inputPath)) {
    return `<img src="${src}" alt="${alt}" loading="lazy" decoding="async">`;
  }
  const metadata = await Image(inputPath, {
    widths: [400, 800, 1200],
    formats: ["avif", "webp", null],
    outputDir: "./_site/assets/img/optimized/",
    urlPath: "/assets/img/optimized/",
  });
  return Image.generateHTML(metadata, {
    alt,
    sizes: "(min-width: 1024px) 45rem, 90vw",
    loading: "lazy",
    decoding: "async",
    class: "h-auto w-full rounded-xl border border-slate-200",
  });
}

/** Заменяет все <img> в отрендеренном HTML на оптимизированные <picture>. */
async function optimizeContentImages(html: string): Promise<string> {
  const matches = [...html.matchAll(/<img\b[^>]*>/g)];
  if (matches.length === 0) return html;
  let result = "";
  let last = 0;
  for (const m of matches) {
    const tag = m[0];
    const src = /src="([^"]*)"/.exec(tag)?.[1] ?? "";
    const alt = /alt="([^"]*)"/.exec(tag)?.[1] ?? "";
    result += html.slice(last, m.index) + (await optimizeContentImage(src, alt));
    last = (m.index ?? 0) + tag.length;
  }
  return result + html.slice(last);
}

interface ParsedDoc {
  data: Record<string, unknown>;
  html: string;
}

// Чтение и парсинг всех файлов: docs[collection][slug][lang] = { data, html }.
const docs: Record<string, Record<string, Partial<Record<Lang, ParsedDoc>>>> = {};

for (const collection of COLLECTIONS) {
  docs[collection.name] = {};
  const dir = path.join(process.cwd(), collection.dir);
  if (!fs.existsSync(dir)) continue;

  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith(".md")) continue;
    const { slug, lang } = parseName(file);
    const raw = fs.readFileSync(path.join(dir, file), "utf8");
    const parsed = matter(raw);
    const byLang = (docs[collection.name][slug] ??= {});
    byLang[lang] = {
      data: parsed.data,
      // top-level await: оптимизируем вставленные в тело картинки на этапе данных.
      html: await optimizeContentImages(md.render(parsed.content)),
    };
  }
}

const renderBlog: RenderUnit[] = [];
const renderKejsy: RenderUnit[] = [];
const lists: Record<string, Record<Lang, ContentCard[]>> = {
  blog: { ru: [], en: [], zh: [] },
  kejsy: { ru: [], en: [], zh: [] },
};
const byService: Record<string, ContentCard & { collection: string }> = {};

for (const collection of COLLECTIONS) {
  const slugs = Object.keys(docs[collection.name]).sort();

  for (const slug of slugs) {
    const variants = docs[collection.name][slug];
    const ru = variants.ru;
    // Русский обязателен. Нет ru — пропускаем (контент неполный).
    if (!ru) continue;
    // Черновик — не публикуем вовсе (ни страниц, ни карточек).
    if (ru.data.draft === true) continue;

    const canonicalDate = toISO(ru.data.date);

    for (const lang of LANGS) {
      const source = variants[lang] ?? ru;
      const fm = source.data;
      const title = typeof fm.title === "string" ? fm.title : "";
      const cover = typeof fm.cover === "string" ? fm.cover : "";

      const unit: RenderUnit = {
        collection: collection.name,
        slug,
        lang,
        url: urlFor(collection.name, slug, lang),
        title,
        description: typeof fm.description === "string" ? fm.description : "",
        cover,
        alt: typeof fm.alt === "string" && fm.alt ? fm.alt : title,
        relatedService:
          typeof fm.related_service === "string" ? fm.related_service : "",
        result: typeof fm.result === "string" ? fm.result : "",
        date: canonicalDate,
        html: source.html,
        isFallback: !variants[lang],
      };

      (collection.name === "blog" ? renderBlog : renderKejsy).push(unit);

      const card: ContentCard = {
        url: unit.url,
        title: unit.title,
        description: unit.description,
        cover: unit.cover,
        alt: unit.alt,
        result: unit.result,
        date: unit.date,
      };
      lists[collection.name][lang].push(card);

      // Обратная связка услуга→статья строится по русским версиям блога.
      if (collection.name === "blog" && lang === "ru" && unit.relatedService) {
        if (!byService[unit.relatedService]) {
          byService[unit.relatedService] = { ...card, collection: "blog" };
        }
      }
    }
  }
}

// Новые сверху по дате публикации.
const byDateDesc = (a: ContentCard, b: ContentCard): number =>
  (b.date || "").localeCompare(a.date || "");
for (const collection of ["blog", "kejsy"]) {
  for (const lang of LANGS) lists[collection][lang].sort(byDateDesc);
}

// Навигация «предыдущий / следующий» — соседи в отсортированной витрине той же
// коллекции и языка. Проставляем на соответствующие единицы рендера по URL.
const unitByUrl = new Map<string, RenderUnit>();
for (const unit of [...renderBlog, ...renderKejsy]) unitByUrl.set(unit.url, unit);
for (const collection of ["blog", "kejsy"]) {
  for (const lang of LANGS) {
    const cards = lists[collection][lang];
    cards.forEach((card, i) => {
      const unit = unitByUrl.get(card.url);
      if (!unit) return;
      const prev = cards[i - 1];
      const next = cards[i + 1];
      if (prev) unit.prev = { url: prev.url, title: prev.title };
      if (next) unit.next = { url: next.url, title: next.title };
    });
  }
}

export default {
  renderBlog,
  renderKejsy,
  blog: lists.blog,
  kejsy: lists.kejsy,
  byService,
};
