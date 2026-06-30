# Сайт ООО ТЛК БАРС — каркас

Статический сайт-каркас торгово-логистической компании на **Eleventy (11ty) + Tailwind CSS + TypeScript**.

> Это **каркас**: страницы созданы как пустые шаблоны с корректными URL, мета-тегами, разметкой, sitemap/robots, аналитикой и формами-заглушками. Контентное наполнение — отдельный этап (через Decap CMS).

## Технологии

- **Eleventy 3** — генератор статики (конфиг на TypeScript).
- **Tailwind CSS 3** — стили, сборка через PostCSS (autoprefixer + cssnano на проде).
- **Nunjucks** (`.njk`) — шаблонизатор.
- **TypeScript** (`strict: true`) — конфиг 11ty, дата-файлы, клиентский JS. Серверный TS исполняется через `tsx`, клиентский компилируется в JS через **esbuild**.
- **Decap CMS** — админка по `/admin/`.

## Требования

- Node.js LTS (см. `.nvmrc` — версия 20).

## Установка

```bash
nvm use          # при наличии nvm
npm install
cp .env.example .env   # заполнить при необходимости (можно оставить пустым для dev)
```

## Команды

| Команда             | Назначение                                                                 |
|---------------------|----------------------------------------------------------------------------|
| `npm run dev`       | Локальная разработка с hot-reload (11ty serve + watch Tailwind + watch TS). |
| `npm run build`     | Продакшн-сборка в `_site/` (минификация, purge CSS, sitemap/robots).        |
| `npm run typecheck` | Проверка типов `tsc --noEmit` (без ошибок).                                 |
| `npm run clean`     | Очистка каталога сборки `_site/`.                                           |
| `npm run cms`       | Локальный сервер Decap CMS (`decap-server`) для админки без хостинга.        |

После `npm run dev` сайт доступен на `http://localhost:8080`.

## Переменные окружения

Реальные ID не хранятся в репозитории — задаются через `.env` (см. `.env.example`):

- `SITE_URL` — базовый URL (canonical/OG/sitemap).
- `YM_COUNTER_ID` — Яндекс.Метрика (пусто → счётчик не подключается).
- `GA4_ID` — Google Analytics 4 (пусто → тег не подключается).
- `YANDEX_VERIFICATION`, `GOOGLE_VERIFICATION` — мета-теги верификации.

## Структура

```
src/
  _includes/
    layouts/      base, page, landing, article
    partials/     header, footer, breadcrumbs, формы, schema-блоки, аналитика
    components/   переиспользуемые макросы (card, empty-state)
  assets/
    css/          входной файл Tailwind
    ts/           клиентский TypeScript (меню, заглушка формы)
    img/          лого, favicon, OG-плейсхолдер
  _data/          глобальные данные на TS (site.ts, navigation.ts) + типы
  pages/          страницы сайта (URL задаются через permalink в данных папок)
  blog/, kejsy/   коллекции контента (на старте пустые, наполняются через CMS)
  robots.njk      генерация robots.txt
  sitemap.njk     генерация sitemap.xml
admin/            Decap CMS (config.yml + index.html)
eleventy.config.ts
tailwind.config.ts
postcss.config.js
tsconfig.json
```

## SEO-слой

- `title` / `description` / `canonical` / Open Graph на каждой странице (фолбэки в `src/_data/site.ts`).
- JSON-LD `Organization` (все страницы), `BreadcrumbList` (вложенные), `Article` (статьи/кейсы).
- `robots.txt` и `sitemap.xml` генерируются автоматически.
- Страницы `/r/` — `noindex, nofollow` и **исключены из sitemap** (защита от каннибализации с `/uslugi/dostavka/tovary/`).

## Формы

Формы-заявки — **визуальные заглушки**: клиентская валидация + подтверждение + событие в аналитику. Реальной отправки нет. Точка интеграции реального обработчика помечена в `src/assets/ts/main.ts` (`TODO(integration)`).

## Контент: блог и кейсы (Markdown, мультиязычно)

Статьи блога и кейсы пишутся в Markdown и рендерятся на читательском шаблоне (правое sticky-оглавление строится автоматически из заголовков `##`/`###`).

- Файлы: `src/blog/<slug>.<lang>.md` и `src/kejsy/<slug>.<lang>.md`, где `lang` ∈ `ru`/`en`/`zh`.
- **Русский обязателен**; `en`/`zh` опциональны. Если перевода нет — на языковой версии показывается русский контент (фолбэк, без 404). URL: `/blog/<slug>/`, `/en/blog/<slug>/`, `/zh/blog/<slug>/` (аналогично `/kejsy/`).
- Front matter статьи: `title`, `date`, `description`, `cover`, `related_service`, `draft`; у кейса дополнительно `result`. Черновики (`draft: true`) не публикуются и скрыты из витрин.
- Чтение и рендер Markdown собраны в `src/_data/library.ts` (фолбэк, автоякоря заголовков, списки витрин, обратная связка услуга→статья). Сырые `.md` исключены из обработки шаблонов; страницы генерируются пагинацией (`src/blog-pages.njk`, `src/kejsy-pages.njk`).
- **Перелинковка**: `related_service` в статье/кейсе → блок «закажите у нас» со ссылкой на услугу; обратно на странице услуги — ссылка на привязанную статью. Ссылки на ненаписанное скрыты.
- Витрины `/blog/` и `/kejsy/` (локализованные) — карточки с обложкой, датой/итогом, новые сверху.

## Фото: оптимизация и lazy-loading

Подключён `@11ty/eleventy-img`. Шорткод `{% image "путь", "alt", "sizes", "css" %}` на сборке делает ресайз, конвертацию в **AVIF + WebP + исходный формат** и отдаёт `<picture>` с `srcset`, `loading="lazy"` и `width`/`height` (без сдвига layout — CLS). Применяется к обложкам блога/кейсов и доступен для любых фото по сайту. Источник — `src/assets/img/` (загруженные через CMS — в `src/assets/img/uploads/`).

## Decap CMS

Админка — `/admin/`.

**Локальный режим (без хостинга):** в конфиге включён `local_backend: true`. Запуск:

```bash
npm run dev      # dev-сервер сайта
npm run cms      # в отдельном терминале: npx decap-server
```

Открыть `http://localhost:8080/admin/` — правки пишутся прямо в файлы проекта без логина.

Коллекции: блог, кейсы (мультиязычные — `i18n: multiple_files`, отдельный файл на язык), товарные страницы. Загруженные фото попадают в `media_folder` (`src/assets/img/uploads`), откуда их подхватывает система оптимизации. Боевой бэкенд (`git-gateway`) оставлен заглушкой; после деплоя — Netlify Identity + Git Gateway либо `github`/`gitlab` backend (структура коллекций совместима).

## Хостинг

Любая статика/CDN (Netlify, Vercel и т.д.). Каталог сборки — `_site/`. Команда сборки — `npm run build`.
