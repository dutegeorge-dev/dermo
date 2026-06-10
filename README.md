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
- Страницы `/r/` — `noindex, nofollow` и **исключены из sitemap** (защита от каннибализации с `/tovary/`).

## Формы

Формы-заявки — **визуальные заглушки**: клиентская валидация + подтверждение + событие в аналитику. Реальной отправки нет. Точка интеграции реального обработчика помечена в `src/assets/ts/main.ts` (`TODO(integration)`).

## Decap CMS

Админка — `/admin/`. Бэкенд (`git-gateway`) задан заглушкой; для работы нужно настроить провайдера авторизации (Netlify Identity + Git Gateway либо `github`/`gitlab` backend). Коллекции: блог, кейсы, товарные страницы.

## Хостинг

Любая статика/CDN (Netlify, Vercel и т.д.). Каталог сборки — `_site/`. Команда сборки — `npm run build`.
