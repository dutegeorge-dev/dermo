# Карта проекта — сайт ООО ТЛК БАРС

> Рабочий справочник по кодовой базе. Цель — понять устройство проекта без чтения кода.
> Документ описывает только то, что реально есть в репозитории на момент аудита.
> Аудит проведён в режиме «только чтение»; код не изменялся.

---

## ⚠️ Важно прежде всего: посторонний файл `main.ts` в корне

В корне репозитория лежит файл **`main.ts` (~70 КБ, 1568 строк)**, который **не имеет отношения к сайту** и к остальному проекту. Это самостоятельный скрипт-бот для **массовой автоматической регистрации аккаунтов на стороннем сайте `subito.it`** (итальянская доска объявлений) через Puppeteer.

Факты, подтверждающие, что файл чужеродный и потенциально опасный:

- **Не подключён к сборке.** Ни `package.json`, ни `eleventy.config.ts`, ни шаблоны на него не ссылаются. Все упоминания «main.ts» в проекте указывают на **другой** файл — клиентский `src/assets/ts/main.ts` (скрипт хедера/форм), а не на корневой.
- **Явно исключён из проверки типов:** `tsconfig.json → exclude` содержит `"main.ts"`.
- **Его зависимостей нет в `package.json`** (`puppeteer`, `node-fetch`, `https-proxy-agent`). То есть он даже не запустится в рамках этого проекта без отдельной установки.
- **Добавлен одним коммитом первичного каркаса** (`53bdfd5`, merge PR #1) и с тех пор не менялся — выглядит как случайно/намеренно занесённый посторонний файл.
- **Содержит захардкоженные секреты прямо в коде:** токен Telegram-бота, API-ключи SMS-сервисов (SimSms, Spanch) и email-сервиса (anymessage.shop) с дефолтными значениями.
- По сути реализует обход антибот-защиты (подмена fingerprint/`navigator.webdriver`, ротация прокси, эмуляция «человеческого» ввода), одноразовые почты и приём SMS-кодов через платные сервисы, управление через Telegram-бота (`/start`, `/stop`, `/status`).

**Рекомендация владельцу (организационная, не правка кода):** удалить `main.ts` из репозитория, считать **скомпрометированными и отозвать** все ключи/токены, которые в нём захардкожены (Telegram bot token, SMS/email API-ключи), и проверить историю git на предмет других утечек. В настоящей карте этот файл далее **не документируется по существу** (его внутренняя механика — вне задач сайта); он отражён только в разделе «Потенциальные проблемы» как security-находка.

Всё остальное в репозитории — легитимный статический сайт. Ниже описывается именно он.

---

## 1. Обзор проекта

**Что это.** Статический сайт-**каркас** торгово-логистической компании «ООО ТЛК БАРС» (закупка и доставка товаров из Китая «под ключ», офис-команда в Гуанчжоу). По состоянию репозитория это именно каркас: страницы с корректными URL, мета-тегами, разметкой, SEO-слоем, рабочими формами заявок (лиды уходят в Bitrix24 и Telegram через бэкенд `server/`); контент наполняется отдельно через CMS.

**Стек:**

| Слой | Технология |
|---|---|
| Генератор статики | **Eleventy 3** (`@11ty/eleventy ^3.1.2`), конфиг на TypeScript |
| Шаблонизатор | **Nunjucks** (`.njk`); Markdown через `markdown-it` (вне пайплайна 11ty) |
| Язык | **TypeScript** (`strict: true`). Серверный TS исполняется через `tsx` (`node --import tsx`), клиентский собирается **esbuild** в IIFE |
| Стили | **Tailwind CSS 3**, сборка через **PostCSS** (`autoprefixer` всегда, `cssnano` только на проде) |
| Картинки | **`@11ty/eleventy-img`** (AVIF/WebP/исходный формат, srcset, lazy) |
| CMS | **Decap CMS** (`/admin/`), локальный режим через `decap-server` |
| Шрифт | **Onest** (self-hosted woff2, `@fontsource/onest`, лицензия OFL) |
| Иконки | **Lucide** как инлайновый SVG (макрос, без рантайм-зависимости) |
| Node | `>=20` (см. `.nvmrc` → `20`) |

**Скрипты `package.json`** (что делает каждый):

| Скрипт | Назначение |
|---|---|
| `clean` | `rimraf _site` — очистка каталога сборки |
| `build:css` | PostCSS: `src/assets/css/tailwind.css` → `_site/assets/css/styles.css` |
| `build:js` | esbuild: бандл `src/assets/ts/main.ts` → `_site/assets/js/main.js` (IIFE, target es2018) |
| `build:js:prod` | то же с `--minify` |
| `build:11ty` | запуск Eleventy через `tsx` с конфигом `eleventy.config.ts` |
| `build` | прод-сборка: `clean` → CSS → JS(min) → 11ty, всё с `NODE_ENV=production` (включает purge CSS и cssnano) |
| `watch:css` / `watch:js` / `watch:11ty` | вотчеры по отдельности (11ty — с `--serve`/browsersync) |
| `dev` | разовая сборка CSS+JS, затем `concurrently` всех трёх вотчеров (hot-reload, `http://localhost:8080`) |
| `preview` | полный `build` + раздача `_site` через `http-server` на :8080 |
| `preview:fast` | как preview, но без минификации/прод-флагов (быстрее) |
| `cms` | `decap-server` — локальный бэкенд Decap CMS (правки пишутся прямо в файлы без логина) |
| `typecheck` | `tsc --noEmit` |
| `server` / `watch:server` | обработчик заявок `server/index.ts` через `tsx` (порт 3000, Bitrix24 + Telegram); `watch:server` входит в `dev` |

**Особенность сборки:** CSS и JS собираются **вне** Eleventy (PostCSS и esbuild пишут напрямую в `_site/`), а `eleventy.config.ts` лишь добавляет `addWatchTarget` на эти выходные файлы, чтобы browsersync перезагружал страницу при их изменении.

**Переменные окружения** (`.env`, пример — `.env.example`; реальные значения в репозиторий не коммитятся):
`SITE_URL` (база для canonical/OG/sitemap), `YM_COUNTER_ID` (Яндекс.Метрика), `GA4_ID` (Google Analytics 4), `YANDEX_VERIFICATION`, `GOOGLE_VERIFICATION`. Пустое значение → соответствующий счётчик/мета-тег просто не рендерится. Отдельная группа — бэкенд заявок: `BITRIX_WEBHOOK_URL` (**секрет**, вебхук Bitrix24), `LEAD_API_URL`, `LEAD_PORT`, `LEAD_PATH`, `LEAD_ALLOWED_ORIGINS`, `LEAD_RATE_LIMIT`, `BITRIX_SOURCE_ID`, `BITRIX_ASSIGNED_BY_ID`, а также `TELEGRAM_BOT_TOKEN` (**секрет**) и `TELEGRAM_CHAT_ID` для дубля заявок в Telegram (см. раздел 14).

---

## 2. Структура каталогов

```
/
├── eleventy.config.ts      # конфиг 11ty: i18n-фильтры, шорткод image, breadcrumbs, eleventyComputed
├── tailwind.config.ts      # дизайн-токены бренда (цвета, шрифт), content для purge
├── postcss.config.js       # tailwind + autoprefixer (+ cssnano на проде)
├── tsconfig.json           # strict; исключает node_modules, _site, main.ts
├── package.json / -lock    # зависимости и скрипты
├── .env.example            # шаблон переменных окружения
├── .nvmrc                  # Node 20
├── README.md               # описание каркаса
├── main.ts                 # ⚠️ ПОСТОРОННИЙ ФАЙЛ (см. раздел выше) — не часть сайта
├── admin/                  # Decap CMS
│   ├── config.yml          #   коллекции (блог/кейсы/товары), i18n, media_folder
│   └── index.html          #   загрузчик decap-cms из CDN, noindex
├── types/
│   └── eleventy-img.d.ts   # минимальные типы для @11ty/eleventy-img
├── deploy/                 # прод-конфиги: nginx (сайт + /api/lead) и systemd-юнит
├── server/                 # бэкенд заявок → Bitrix24 + Telegram (без зависимостей)
│   ├── index.ts            #   HTTP-сервер: маршруты, CORS, антиспам, лимиты
│   ├── config.ts           #   .env-загрузчик, нормализация вебхука, настройки
│   ├── lead.ts             #   разбор/валидация заявки, сборка полей лида
│   ├── bitrix.ts           #   вызов crm.lead.add (таймаут, ретраи, ошибки)
│   └── telegram.ts         #   дубль заявки в чат менеджера (Bot API)
└── src/
    ├── _data/              # глобальные данные на TS (доступны во всех шаблонах)
    │   ├── site.ts           # реквизиты, контакты, аналитика/верификация из env
    │   ├── navigation.ts     # пункты верхней навигации (5 шт.)
    │   ├── megaMenu.ts       # структура мега-меню «Услуги»
    │   ├── uslugi.ts         # ЕДИНЫЙ источник структуры раздела «Услуги»
    │   ├── services.ts       # конфиг торговых услуг (иконки, перелинковка, i18nBase)
    │   ├── serviceIndex.ts   # плоский индекс slug→{url,labelKey,icon} для перелинковки
    │   ├── goroda.ts         # уникальные поля городских страниц (падежи, маршруты)
    │   ├── torgovlya.ts      # структура страницы /torgovlya/
    │   ├── home.ts           # секции главной (полоса доверия, шаги, крылья)
    │   ├── homeBlog.ts       # ПЛЕЙСХОЛДЕРЫ карточек блога для главной
    │   ├── homeCases.ts      # ПЛЕЙСХОЛДЕРЫ карточек кейсов для главной
    │   ├── library.ts        # КОНТЕНТНЫЙ ДВИЖОК: чтение/рендер Markdown блога и кейсов
    │   ├── types.ts          # все TypeScript-интерфейсы данных и front matter (~1340 строк)
    │   └── i18n/             # словари локалей
    │       ├── ru.ts           # реальный контент (~2780 строк) — источник
    │       ├── en.ts           # СТАБ ([EN]-префиксы + stubBranch)
    │       └── zh.ts           # СТАБ ([ZH]-префиксы + stubBranch)
    ├── _includes/
    │   ├── layouts/          # base, page, landing, article, reading
    │   ├── partials/         # header, footer, breadcrumbs, mega-services, формы,
    │   │                     #   schema-*, analytics-*, icon, logo, *-content
    │   └── components/       # ~25 макросов/инклюдов (hero, faq, card, cta, …)
    ├── _data/i18n/…          # (см. выше)
    ├── pages/                # страницы сайта (URL — через permalink в *.json папок)
    │   ├── *.json            # директорные данные: permalink/layout по папкам
    │   ├── index.njk, kontakty.njk, logistika.njk, torgovlya.njk,
    │   │   o-kompanii.njk, politika-konfidencialnosti.njk, spasibo.njk,
    │   │   calculator.njk, calculator-spasibo.njk
    │   ├── blog/index.njk, kejsy/index.njk      # витрины (локализованные)
    │   ├── r/                # рекламные посадочные (noindex, вне sitemap)
    │   └── uslugi/           # дерево услуг (dostavka/{sposoby,tovary,goroda,…}, torgovlya)
    ├── blog/                 # .md статьи блога (ru/en/zh), вне пайплайна 11ty
    ├── kejsy/                # .md кейсы (ru), вне пайплайна 11ty
    ├── blog-pages.njk        # генератор страниц статей (пагинация library.renderBlog)
    ├── kejsy-pages.njk       # генератор страниц кейсов (пагинация library.renderKejsy)
    ├── sitemap.njk           # /sitemap.xml (opt-in по sitemap==true)
    ├── robots.njk            # /robots.txt
    ├── 404.njk               # страница 404
    └── assets/
        ├── css/tailwind.css  # @tailwind + @font-face Onest + кастомные компоненты
        ├── ts/               # клиентский TS: main, header, toc, slider, cookie
        ├── fonts/            # Onest woff2 (4 веса × 4 подсета) + README
        └── img/              # logo.svg, favicon.svg, og-default.svg, partners/, uploads/
```

**Генерируемые/служебные каталоги** (не входят в аудит): `node_modules/`, `_site/` (выход сборки), `.git/`. Кэш 11ty — в `.gitignore`.

---

## 3. Архитектура страниц и маршрутов

### Локали и URL

Три локали: **`ru`** (по умолчанию, без префикса), **`en`**, **`zh`** (с префиксом `/en/`, `/zh/`). Локаль страницы вычисляется из URL (`localeFromUrl`) и доступна в шаблонах как `locale`, словарь — как `dict`.

**Важно:** полноценная i18n-машинерия (фильтры `t`, `localizedUrl`, hreflang, словари en/zh) есть, **но `/en/` и `/zh/`-версии физически генерируются только для блога и кейсов**. Все остальные страницы (`/uslugi/...`, `/logistika/`, `/torgovlya/`, `/o-kompanii/` и т. д.) существуют только в `ru`. Переключатель языка и hreflang на этих страницах ведут на несуществующие локализованные URL (см. раздел 13).

### Директорные данные (`src/pages/**/*.json`)

URL задаются не во front matter каждой страницы, а в JSON-файлах папок (Eleventy directory data). `*.11tydata.*` в проекте нет вообще.

| Файл | permalink | layout | прочее |
|---|---|---|---|
| `pages/pages.json` | `/{{ page.fileSlug }}/` | `layouts/page.njk` | `sitemap: true` |
| `pages/r/r.json` | `/r/{{ page.fileSlug }}/` | `layouts/landing.njk` | `robots: noindex,nofollow`, `sitemap: false` |
| `pages/uslugi/uslugi.json` | `/uslugi/{{ page.fileSlug }}/` | — | — |
| `pages/uslugi/dostavka/dostavka.json` | `/uslugi/dostavka/{{ fileSlug }}/` | — | — |
| `…/sposoby/sposoby.json` | `/uslugi/dostavka/sposoby/{{ fileSlug }}/` | — | — |
| `…/tovary/tovary.json` | `/uslugi/dostavka/tovary/{{ fileSlug }}/` | — | — |
| `…/goroda/goroda.json` | `/uslugi/dostavka/goroda/{{ fileSlug }}/` | — | — |
| `pages/uslugi/torgovlya/torgovlya.json` | `/uslugi/torgovlya/{{ fileSlug }}/` | — | — |

JSON задают только URL. Лейаут для листовых страниц услуг прописан в самих `.njk` (`layout: layouts/reading.njk`). Глобальный `eleventyComputed` (в `eleventy.config.ts`) вычисляет `title`, `description`, `locale`, `dict`.

### Полный перечень маршрутов (ru)

**Самостоятельные страницы:** `/`, `/logistika/`, `/torgovlya/`, `/o-kompanii/`, `/kontakty/`, `/politika-konfidencialnosti/`, `/spasibo/`, `/calculator/` (калькулятор доставки и таможенных платежей) и `/calculator/spasibo/` (благодарность после отправки расчёта, `noindex`, вне sitemap).

**Раздел «Услуги»:**
- хабы: `/uslugi/`, `/uslugi/dostavka/`, `/uslugi/dostavka/sposoby/`, `/uslugi/dostavka/tovary/`, `/uslugi/dostavka/goroda/`, `/uslugi/dostavka/dop-uslugi/`, `/uslugi/torgovlya/`;
- способы доставки (4): `…/sposoby/{avto,zhd,more,avia}/`;
- товарные категории (7 файлов): `…/tovary/{elektronika,keramika-plitka,napolnye-pokrytiya,oborudovanie,stroymaterialy,tekstil,zapchasti}/`;
- города (6): `…/goroda/{moskva,sankt-peterburg,ekaterinburg,novosibirsk,kazan,blagoveshchensk}/`;
- отдельные логистические: `…/dostavka/sbornye-gruzy/`, `…/dostavka/tamozhennoe-oformlenie/`;
- торговые услуги (10): `/uslugi/torgovlya/{poisk-postavshchika,audit-proizvodstva,peregovory,kontrol-proizvodstva,inspekciya,upakovka-markirovka,sertifikaciya,vykup-tovara,vozvrat-nds,proverka-zavoda}/`.

**Рекламные посадочные:** `/r/belaya-dostavka/`, `/r/napolnye-pokrytiya/`, `/r/stroymaterialy/` (см. раздел 9).

**Локализованные (ru + en + zh):** `/blog/`, `/kejsy/` (витрины) и `/blog/<slug>/`, `/kejsy/<slug>/` (статьи), с префиксами `/en/…`, `/zh/…`.

**Служебное:** `/404.html`, `/sitemap.xml`, `/robots.txt`, passthrough `/admin/`, `/assets/…`.

### Лейауты и их наследование

Корень цепочки — `base.njk`. Все прочие лейауты наследуются от него (`layout: layouts/base.njk`) и вставляют контент в `{{ content | safe }}`.

```
base.njk  (весь <head>, SEO, Organization JSON-LD, аналитика, cookie-banner, main.js)
 ├── page.njk      — простая контентная страница (header → breadcrumbs → H1 → content → footer)
 ├── landing.njk   — рекламная посадочная (без основной навигации, noindex, sitemap:false)
 ├── article.njk   — простой шаблон статьи (⚠️ судя по всему, легаси — никто не использует)
 └── reading.njk   — флагманский «читательский» шаблон (услуги, города, блог, кейсы, политика)
```

- **`reading.njk`** — самый сложный шаблон: hero (сервисный/городской/произвольный) → двухколоночное тело (контент + правое sticky-оглавление, строится из `section[id]` на клиенте при 3+ разделах) → блоки перелинковки/продажи (back-link на услугу, `service-related`, `city-related`, обратная связка услуга→статья через `library.byService`, `related`, `faq`, финальные CTA) → JSON-LD Article (если `ogType == article`).
- Флагманские посадочные (`/`, `/logistika/`, `/torgovlya/`) `reading.njk` **не** используют — это самостоятельные страницы со своей секционной вёрсткой.
- `blog-pages.njk` / `kejsy-pages.njk` рендерятся на `reading.njk` с `ogType: article`.
- `article.njk` существует, но `layout: layouts/article.njk` **не задаёт ни одна страница** — вероятный мёртвый код (раздел 13).

---

## 4. Данные и контент

### Глобальные данные (`src/_data/*.ts`)

Все данные строго типизированы по `types.ts`. Тексты в разметку **не хардкодятся** — данные хранят слаги, иконки Lucide, URL и **ключи** словаря (i18n); сами строки лежат в `i18n/*.ts`.

- **`site.ts`** — единый объект `site`: бренд/реквизиты (`name`, `legalName`, `director="Фотин Евгений Петрович"`, `inn=5024256988`, `kpp`, `ogrn`, адрес в Красногорске + офис в Гуанчжоу), контакты (RU/CN телефоны, Telegram, `email`, отдельный `privacyEmail` для запросов по ПДн), `mapEmbedSrc` (виджет Яндекс.Карт на Гуанчжоу), блоки `analytics`/`verification` целиком из env, `calculateUrl` → `/calculator/` (страница калькулятора), `leadApiUrl`/`ratesApiUrl` — эндпоинты бэкенда. **Плейсхолдеры:** телефоны `+7 (000) …`/`+86 000 …`, адрес CN «уточняется».
- **`navigation.ts`** — 5 пунктов верхнего меню по `titleKey`: `nav.services` (с `mega:true`, без url — открывает мега-меню), `nav.cases`→`/kejsy/`, `nav.blog`→`/blog/`, `nav.about`→`/o-kompanii/`, `nav.contacts`→`/kontakty/`.
- **`uslugi.ts`** — **единый источник** структуры раздела «Услуги»: `methods` (4 способа), `tovary` (5 категорий), `goroda` (6 городов), `dopUslugi` (3, причём «Сертификация» ведёт на страницу торговли — без дубля), `torgovlyaServices` (10). Из него строятся витрины, списки, мега-меню и хлебные крошки.
- **`megaMenu.ts`** — структура мега-меню «Услуги»: левое крыло «Логистика» (подгруппы «по способу»/«доп. услуги»/«по товару»/«по городу» с раскладкой по колонкам, `pinBottom`, `singleCol`), правое «Торговля» (7 ключевых услуг из единого источника + «все услуги»). Списки берутся из `uslugi.ts`, чтобы названия нигде не расходились.
- **`services.ts`** — конфиг 10 торговых услуг (`ServicesData`): `slug`, `i18nBase` (ветка словаря), `heroIcon`, `requestUrl`, `related` (2 ссылки-перелинковки), `fullCycleUrl`, опциональные `articleUrl`/`caseUrl` (заданы только там, где статья/кейс реально существуют — иначе блок скрыт). «Поиск поставщика» — эталонная страница.
- **`serviceIndex.ts`** — плоский индекс `slug → {url, labelKey, icon}`, собираемый из `uslugi.ts` (methods+tovary+torgovlyaServices+dopUslugi, первое вхождение выигрывает). Используется для обратной связки `related_service` (во front matter статьи/кейса) → блок «Закажите у нас».
- **`goroda.ts`** — уникальные поля городских страниц: падежи названия (`acc`/`prep`/`gen`, авто-склонения нет), **маршрут** до города (ядро уникальности — защита от дублей), вывод-акцент, уникальный вопрос FAQ, релевантный способ доставки.
- **`home.ts`** / **`torgovlya.ts`** — структурные данные главной и страницы «Торговля» (иконки + ключи i18n).
- **`homeBlog.ts`** / **`homeCases.ts`** — **плейсхолдеры** карточек для главной (имитируют будущие записи Decap-коллекций; остаются фолбэком, когда появится реальный контент).

### i18n: организация переводов

- Три файла-словаря, каждый типизирован общим контрактом `Dictionary` из `types.ts` → **отсутствие любого ключа в любой локали ловится `tsc --noEmit`**.
- **`ru.ts`** (~2780 строк) — реальный исходный контент. Топ-ключи: `nav`, `cta`, `mega`, `method`, `methodFull`, `logiExtra`, `goods`, `city`, `trade`, `lang`, `content`, `home`, `torgovlya`, `forms`, `cookie`, `logistika`, `oKompanii`, `uslugi` (самая большая ветка — все услуги/товары/города/FAQ/таблицы). Многие строки содержат инлайн-HTML с Tailwind-классами (перелинковка, шаги).
- **`en.ts`** / **`zh.ts`** (~11.5 КБ каждый) — **стабы**, не реальные переводы:
  - функция **`stubBranch<T>(value, prefix)`** рекурсивно префиксует каждую строку-лист (`[EN] ` / `[ZH] `), сохраняя структуру и типы;
  - крупные ветки (`methodFull`, `logiExtra`, `torgovlya`, `uslugi`, `forms`, `cookie`) делегированы в `stubBranch(ru.<x>, …)`;
  - часто видимые мелкие ключи (`nav`, `cta`, `mega`, `home`, `a11y`…) выписаны вручную, но содержат **русский текст с маркером** (`"[EN] Услуги"`);
  - реально локализованы только ветка `content` (en: «Contents/Read», zh: «目录/阅读») и коды языков (`lang`);
  - ветки `logistika` и `oKompanii` проброшены как **сырой `ru.*` без префикса** (содержат URL и пути к логотипам, которые нельзя слепо префиксовать; en/zh-версии этих страниц физически не генерируются).
- Итог: сайт **фактически одноязычный по контенту**, несмотря на трёхъязычную маршрутизацию (намеренное состояние каркаса).

### Markdown-контент (блог и кейсы)

- Сырые `.md` файлы блога/кейсов **исключены из пайплайна 11ty** (`ignores` в `eleventy.config.ts`). Их читает и рендерит `library.ts` (см. раздел 8).
- Файлы: `src/blog/<slug>.<lang>.md`, `src/kejsy/<slug>.<lang>.md`, где `lang ∈ ru|en|zh`. Суффикс языка опционален (без него — `ru`).
- **Front matter:** `title`, `date`, `description`, `cover`, `alt`, `related_service`, `draft`; у кейса дополнительно `result`.
- **Русский обязателен**; если `ru`-версии нет или `draft:true` — slug пропускается целиком. Для каждого языка при отсутствии перевода берётся `ru`-документ (фолбэк, флаг `isFallback`), 404 не возникает. Канонический `date` — из ru-версии.

**Реальный контент на момент аудита:**
- Блог: `kak-my-rabotaem` (ru + **en** — единственный настоящий перевод), `napravleniya-zakupok` (ru, `related_service: poisk-postavshchika`), `sposoby-dostavki-iz-kitaya` (ru, с обложкой). Все `draft:false`.
- Кейсы (все ru, `draft:false`, дата 2026-06-17): `kontrol-proizvodstva-7000` (`related_service: kontrol-proizvodstva`, `result: «Предотвратили убыток более $7000»`), `poisk-postavshchika-gazon` (`related_service: poisk-postavshchika`), `zapchasti-gruzoviki` (`related_service: zapchasti`).
- zh-файлов нет; часть описаний — «Материал готовится», но страницы всё равно публикуются.

---

## 5. Компоненты и переиспользуемые блоки

### Партиалы (`src/_includes/partials/`)

| Файл | Назначение |
|---|---|
| `header.njk` | Двухъярусный sticky-хедер: ярус 1 (utility — переключатель языка, «Рассчитать», 2 телефона, Telegram; сворачивается при скролле) + ярус 2 (логотип, десктоп-навигация, пункт «Услуги» открывает мега-меню, янтарный CTA). Мобайл: бургер → off-canvas с аккордеоном «Услуги» (два крыла). Поведение — `header.ts`. |
| `footer.njk` | Трёхколоночный футер: компания (реквизиты-заглушки), «Разделы», «Контакты», нижняя полоса (копирайт, ссылка на политику). ⚠️ Свёрстан в старой палитре `gray-*` и использует `<img logo.svg>` вместо макроса `logo()` (раздел 13). |
| `mega-services.njk` | Десктоп-оверлей мега-меню «Услуги» (2 крыла, раскладка из `megaMenu`). |
| `breadcrumbs.njk` | Хлебные крошки из `page.url \| breadcrumbs(title)` (рендер при `crumbs.length>1`); синяя полоса; последняя крошка `aria-current`. Подключает `schema-breadcrumbs.njk`. |
| `goroda-content.njk` | Общее тело городских страниц; уникален только блок «Маршрут» (`cityData.route`). Эмитит JSON-LD `FAQPage` + `Service`. |
| `tovar-content.njk` | Общее тело товарных страниц (`dict.uslugi.tovary[tovarKey]`): сетка продуктов, таблица качества, доп. секции, FAQ. JSON-LD `FAQPage` + `Service`. |
| `lead-form.njk` | Форма-заявка (используется в `landing.njk`). **Заглушка** без бэкенда; явный `TODO(integration)`. Тексты захардкожены (не i18n). |
| `icon.njk` | Макрос `icon(name, class)` — Lucide-иконки инлайновым SVG (`currentColor`), цепочка `if/elif` по ~55 именам. |
| `logo.njk` | Макрос `logo(variant)` — текстовый логотип-плейсхолдер (badge «Б» + «ТЛК БАРС»), варианты `light`/`dark`. |
| `schema-organization.njk` | JSON-LD `Organization` (на каждой странице через base). |
| `schema-breadcrumbs.njk` | JSON-LD `BreadcrumbList`. |
| `schema-article.njk` | JSON-LD `Article`. |
| `analytics-yandex.njk` | Яндекс.Метрика (clickmap/webvisor/trackForms) — только если задан `YM_COUNTER_ID`. |
| `analytics-ga.njk` | GA4 gtag — только если задан `GA4_ID`. |
| `cookie-banner.njk` | Глобальный баннер согласия на cookies (тексты `dict.cookie`); логика — `cookie.ts`. |

### Компоненты (`src/_includes/components/`)

**Макросы** (`{% from … import … %}`): `card(title,url,text)`, `emptyState(text)`, `faq(items,title)` (аккордеон + JSON-LD FAQPage), `related(items,title)` (сетка из `linkCard`), `linkCard(icon,label,url)`, `formConsent(locale,id)` (чекбокс согласия 152-ФЗ, блокирует submit), `leadFormMini(locale,id)` (компактная форма заявки), `partners(data)`, `photoPlaceholder(caption,tone)` (явное место под фото), `teamSlider(team)` (карусель на `slider.ts`).

**Инклюды** (`{% include %}`, читают данные напрямую): `hero.njk` (hero главной + `leadFormMini`), `about-short.njk`, `blog.njk`/`cases.njk` (последние 3 записи; данные `library.*[locale]` с фолбэком на `homeBlog`/`homeCases`), `content-list.njk` (сетка витрины блога/кейсов), `steps.njk` (процесс «как работаем»), `trust-bar.njk` (полоса доверия), `wings.njk` (два крыла «Логистика/Торговля»), `cta-final.njk`/`cta-band.njk` (полосы призыва), `service-hero.njk`/`service-related.njk`/`service-cta.njk` (для страниц услуг, данные из `svc`), `city-hero.njk`/`city-related.njk`/`city-cta.njk` (для городских страниц, ⚠️ текст захардкожен по-русски).

---

## 6. Стили и дизайн-система

**Tailwind-конфиг (`tailwind.config.ts`).**
- `content` сканирует `src/**/*.{njk,md,html}`, `src/assets/ts/**`, **`src/_data/**/*.ts`** (важно: словари i18n содержат HTML-классы в строках — иначе purge их вырежет), `admin/**`.
- `container` центрирован, кастомные паддинги/брейкпоинты (xl = 1200px).
- **Дизайн-токены бренда** (меняются здесь — отражаются везде):
  - `brand` — ультрамарин `#1E3FD0` (`dark #15269C`, `light` оставлен для совместимости): фон хедера, акценты;
  - `accent` — янтарь `#F5A623` (`hover/dark #D98E0B`): **только** главные CTA;
  - `cyan` — бирюза `#22B8CF`: мелкие акценты, активные состояния, перелинковка;
  - `telegram` — `#229ED9`: кнопки Telegram;
  - `ink #0F172A` (текст), `muted #64748B` (вторичный), `surface #FFFFFF`, `surface-alt #F1F5F9`;
  - `success`/`danger` — служебные статусные цвета (только для ✓/✗ и таблиц, не часть бренд-палитры).
- Шрифт: `sans` → `Onest, system-ui, …`.

**PostCSS (`postcss.config.js`):** `tailwindcss` + `autoprefixer` всегда; `cssnano` (preset default) — **только** при `NODE_ENV=production` (в dev не минифицируем, чтобы не тормозить hot-reload).

**Входной CSS (`src/assets/css/tailwind.css`):**
- `@tailwind base/components/utilities`;
- `@font-face` Onest (4 веса × 4 подсета woff2, `font-display: swap`, `unicode-range`);
- `scroll-behavior: smooth` с уважением `prefers-reduced-motion`;
- **компоненты-утилиты:** `.btn`/`.btn-primary`/`.btn-accent`/`.btn-outline`, `.container-narrow`, `.link-inline`, `.section`, поля форм (`.field-*`);
- **типографика статей:** `.prose` (лёгкая замена typography-плагина, т. к. Preflight сбрасывает заголовки) и `.prose-reading` (крупнее текст, ритм между `section`, `scroll-margin-top: 7rem` под липкий хедер, врезка `.reading-takeaway`);
- **хедер/мега-меню:** `.utility-bar` (сворачивание по `data-scrolled`), `.mega-panel` (оверлей с «мостиком» `::before` против потери hover), индикатор-стрелка;
- утилиты: `.scrollbar-none`, отключение анимаций при `prefers-reduced-motion`.

**Шрифты:** Onest self-hosted (`src/assets/fonts/`, копируются passthrough в `/assets/fonts/`), preload ключевых начертаний в `base.njk` (`crossorigin` обязателен даже на своём домене). Self-hosting выбран намеренно (скорость, приватность).

---

## 7. Клиентский JS/TS

Собирается esbuild из единой точки входа `src/assets/ts/main.ts` в `_site/assets/js/main.js` (подключается с `defer` в `base.njk`). Все скрипты — прогрессивное улучшение (работают поверх рабочего без-JS каркаса).

| Модуль | Что делает | Где |
|---|---|---|
| `main.ts` | Точка входа: импортирует `header`, `slider`, `cookie`; на `DOMContentLoaded` запускает `initForms()`, `initToc()` и `initCalculator()`. **`initForms`** — валидация форм-заявок (телефон/Telegram-ник), обязательный чекбокс согласия 152-ФЗ, затем отправка через `sendLead` из `lead.ts`; на время запроса кнопка блокируется, при успехе — подтверждение, сброс формы и событие `lead_form_submit` в аналитику, при сбое — блок `[data-form-error]`. | формы `[data-lead-form]` |
| `lead.ts` | Общий модуль отправки заявок: `sendLead(form, extra)` (сбор полей формы + UTM из URL/`sessionStorage` + honeypot → `POST` JSON на `data-lead-endpoint`), `isValidContact`, `trackEvent` (`ym`/`gtag`). Используется и обычными формами, и калькулятором. | все формы заявок |
| `calculator.ts` | `initCalculator` — калькулятор `/calculator/`: мгновенный пересчёт на каждый ввод, мультитоварность (`<template>` + «Добавить товар»), курсы ЦБ из `GET data-rates-endpoint` (флаг `stale` и сообщение при недоступности), детализация расчёта, отправка расчёта заявкой через `sendLead` и редирект на `/calculator/spasibo/`. Формулы и тарифы импортируются из `server/calc.ts` — общего с бэкендом модуля. | `[data-calculator]` |
| `header.ts` | `initStickyHeader` (сворачивание utility-полосы с гистерезисом COLLAPSE_AT=64/EXPAND_AT=8 против «дрожания»), `initMegaMenu` (тап/клик + Esc + клик-вне + focusout; hover — на CSS), `initAccordions` (универсальные `[data-accordion-toggle]`), `initMobilePanel` (off-canvas: бургер, оверлей, блокировка скролла, Esc, фокус). | хедер |
| `toc.ts` | `initToc` — sticky-оглавление читательского шаблона: собирает разделы (`section[id]` или `h2/h3[id]`), показывает **только при 3+ разделах**, десктоп — правое sticky со scroll-spy (`IntersectionObserver`, активный — бирюза), мобайл — аккордеон «Содержание», плавная прокрутка + перевод фокуса для доступности. | `[data-reading]` |
| `slider.ts` | `initSliders` — карусель без зависимостей (нативный скролл-трек + стрелки на ширину карточки, блокировка на краях). | `[data-slider]` (команда на «О компании») |
| `cookie.ts` | `initCookieBanner` — показ баннера, пока согласие не сохранено; хранилище `localStorage` с фолбэком на cookie (приватный режим), анимация появления/скрытия. | `[data-cookie-banner]` |

Аналитические `window.ym`/`window.gtag` типизированы как опциональные (могут отсутствовать в dev).

---

## 8. Функции и утилиты

### `eleventy.config.ts`

- **Дата-расширение `ts`** — `addDataExtension("ts", { read:false, parser })`: динамический `import()` `.ts`-дата-файлов через tsx-загрузчик (с `cacheBust`).
- **Passthrough:** `src/assets/img`, `src/assets/fonts`, `admin` → в `_site`.
- **`ignores`:** `src/blog/**/*.md`, `src/kejsy/**/*.md` (рендерит `library.ts`).
- **Шорткод `image`** (`imageShortcode(src, alt, sizes, className)`) — async, через `@11ty/eleventy-img`: ресайз `[400,800,1200]`, форматы `[avif, webp, null]` (null = исходный, сохраняет PNG-прозрачность), вывод `<picture>` с srcset/lazy/decoding. Если файла нет — **возвращает пустую строку** (сборка не падает).
- **Фильтры:** `breadcrumbs(url, title?)` (строит крошки от «Главная», использует карту `LABELS` слаг→подпись, для контента — `title`), `absoluteUrl(path, base)`, `t(key, locale)` (перевод по dot-path с фолбэком ru→ключ), `localizedUrl(path, locale)` (тот же путь в другой локали), `isoDate`, `readableDate` (рус. формат).
- **Глобальные данные:** `locales` (для hreflang), `eleventyComputed` (`title`/`description`/`locale`/`dict` — см. раздел 3).
- Внутренние хелперы: `resolveKey`, `translate`, `localeFromUrl`, `stripLocale`, `localizedUrl`, `buildBreadcrumbs`.

### `library.ts` (контентный движок)

- `parseName(file) → {slug, lang}` — разбор имени `<slug>.<lang>.md` (без суффикса → ru).
- `toISO(value)` — нормализация YAML-даты/строки в ISO.
- `urlFor(collection, slug, lang)` — ru→`/<col>/<slug>/`, en/zh→`/<lang>/<col>/<slug>/`.
- `slugify(value)` — Unicode-aware (`\p{L}\p{N}`, флаг `u`), **сохраняет кириллицу** (читаемые якоря рус. заголовков). Передаётся в `markdown-it-anchor` (уровни h2/h3).
- Сборка: `docs[collection][slug][lang]` через `fs.readFileSync` + `gray-matter` + `markdown-it` (`html, linkify, typographer`). Фолбэк ru, пропуск без ru / при `draft`. Канонический date из ru.
- Экспорт (глобально `library`): `renderBlog`/`renderKejsy` (плоские `RenderUnit[]` для пагинации), `blog`/`kejsy` (`{ru,en,zh}` карточки витрин, сортировка `byDateDesc` — новые сверху), `byService` (slug услуги → карточка статьи для обратной связки).

---

## 9. SEO и метаданные

- **`title` / `description` / `robots` / `canonical`** — все в `base.njk`. `title`/`description` приходят из front matter или ключей (`titleKey`/`descriptionKey`) через `eleventyComputed`. `canonical = site.url + page.url`. `robots` по умолчанию `index, follow`, переопределяется (landing и 404 — noindex).
- **hreflang** — в `base.njk` для каждой локали из `locales` + `x-default`→ru (⚠️ для не-блоговых страниц ведёт на несуществующие /en//zh/, раздел 13).
- **Open Graph** — `og:type` (`ogType` или `website`), title/description/url/image/locale; `ogType: article` пробрасывается на статьях/кейсах/услугах.
- **JSON-LD:** `Organization` (каждая страница), `BreadcrumbList` (где есть крошки), `Article` (читательский шаблон/блог/кейсы), `FAQPage` (компонент `faq`, городские и товарные страницы), `Service` (городские и товарные страницы).
- **Верификация:** мета Яндекс/Google (условно по env). **Аналитика:** GA4 + Метрика (условно по env).
- **`sitemap.njk`** (`/sitemap.xml`) — **opt-in**: выводит только `collections.all` с `item.data.sitemap == true`, по каждому `loc` + `lastmod` (`item.date | isoDate`).
- **`robots.njk`** (`/robots.txt`) — allow всё; `Disallow: /admin/`, `Disallow: /r/`; `Sitemap: <site.url>/sitemap.xml`.
- **Хлебные крошки** — `breadcrumbs`-фильтр + карта `LABELS`; видимые крошки и JSON-LD строятся из одного источника (но с нюансом аргумента `title`, см. раздел 13).
- **Страницы `/r/`** — `noindex, nofollow` и `sitemap:false`: их URL намеренно зеркалят реальные (напр. `/r/napolnye-pokrytiya/` ↔ `/uslugi/dostavka/tovary/napolnye-pokrytiya/`), исключение из индекса/sitemap защищает от **каннибализации** запросов рекламными посадочными.
- **`/spasibo/`** — `noindex, follow` + `eleventyExcludeFromCollections: true` (страница-«спасибо», намеренно вне sitemap/коллекций).

---

## 10. Изображения

- Обработка — шорткод `{% image "путь", "alt", "sizes", "css" %}` через `@11ty/eleventy-img` (см. раздел 8): на сборке ресайз (400/800/1200), конвертация в **AVIF + WebP + исходный формат**, вывод `<picture>` с `srcset`, `loading="lazy"`, `decoding="async"` и `width`/`height` (защита от сдвига layout — CLS). Выход — `_site/assets/img/optimized/`.
- Источник — `src/assets/img/` (копируется passthrough). Загруженные через CMS фото — `src/assets/img/uploads/` (`media_folder` в `admin/config.yml`); на момент аудита там 2 обложки (`cover-kontrol-proizvodstva.jpg`, `cover-sposoby-dostavki.jpg`).
- Прочие ассеты: `logo.svg`, `favicon.svg`, `og-default.svg` (SVG-плейсхолдер OG), `partners/placeholder-logo.svg`.
- Применяется к обложкам блога/кейсов; доступен для любых фото. Если файл не найден — шорткод тихо возвращает пустую строку (без ссылок на несуществующее).

---

## 11. Важные решения и нестандартные места

- **CSS/JS вне 11ty.** Стили и скрипты собираются PostCSS и esbuild напрямую в `_site`; 11ty лишь следит за выходными файлами (`addWatchTarget`) для перезагрузки. Поэтому `dev` = три параллельных вотчера (`concurrently`).
- **Дата-файлы на TypeScript.** `addDataExtension("ts", …)` с динамическим импортом и `cacheBust` — позволяет писать `_data` на строгом TS и исполнять через tsx.
- **Markdown в обход пайплайна 11ty.** Блог/кейсы намеренно `ignores`-ятся и читаются `library.ts` вручную — чтобы реализовать ru-фолбэк, авто-якоря с кириллицей, единые витрины и обратную связку услуга↔статья.
- **Единый источник структуры услуг** (`uslugi.ts`) → витрины, мега-меню, крошки и перелинковка не расходятся в названиях/URL. Все пути — под `/uslugi/`, чтобы не плодить дубли со старыми разделами.
- **Контракт `Dictionary`** заставляет все три локали реализовывать один интерфейс — пропущенный ключ ловится `tsc`. Стабы en/zh строятся `stubBranch`, чтобы не дублировать вручную большие ветки.
- **i18n-классы в purge.** В `content` Tailwind добавлен `src/_data/**/*.ts` — иначе классы из HTML-строк словаря были бы вырезаны.
- **Защита от дублей в SEO.** Городские/товарные страницы имеют уникальное ядро (маршрут города, спецификации товара); рекламные `/r/` — noindex + вне sitemap против каннибализации.
- **Гистерезис хедера** (`header.ts`): мёртвая зона 8↔64px против «дрожания» при scroll anchoring (изменение высоты хедера возвращало бы scrollY за порог).
- **«Мостик» мега-меню** (`.mega-panel::before`): невидимая зона перекрывает зазор между кнопкой и панелью, чтобы курсор не терял `:hover`.
- **Порог оглавления** (`toc.ts`): TOC выводится только при 3+ разделах — иначе «огрызок», контент занимает всю колонку.
- **Перелинковка «без ссылок на ненаписанное».** `articleUrl`/`caseUrl` и `byService` заполнены только там, где контент существует; пустое значение → блок не рендерится.
- **`image`-шорткод не валит сборку** при отсутствии файла (возвращает пустую строку) — удобно для каркаса с плейсхолдерами.
- **Self-hosted шрифт и инлайновые SVG-иконки** — без сторонних CDN на рантайме (скорость, приватность, отсутствие рантайм-зависимостей).
- **Decap CMS в локальном режиме** (`local_backend: true`) — правки пишутся прямо в файлы без логина/хостинга; боевой `git-gateway` оставлен заглушкой. Коллекции мультиязычные (`i18n: multiple_files`, отдельный файл на язык).

---

## 12. TODO / незавершённое / заглушки

- **Плейсхолдеры данных:** телефоны и адрес CN в `site.ts`; реквизиты в футере («Реквизиты-заглушки»); текстовый логотип (`logo.njk` — «Логотип-плейсхолдер»); `photo-placeholder.njk`; логотипы партнёров; фото команды; `homeBlog.ts`/`homeCases.ts` (видимые на старте плейсхолдеры карточек главной).
- **Пустые посадочные `/r/`:** `belaya-dostavka.njk`, `napolnye-pokrytiya.njk`, `stroymaterialy.njk` содержат только комментарий, без контента.
- **Переводы en/zh не написаны** — стабы с `[EN]`/`[ZH]`-маркерами на русском тексте; en/zh-страницы вне блога/кейсов не генерируются; `logistika`/`oKompanii` в en/zh — сырой ru.
- **Описания части контента** — «Материал готовится».

---

## 13. Потенциальные проблемы / расхождения

> Только фиксация для владельца; правки не вносились.

1. **🔴 Посторонний `main.ts` с захардкоженными секретами.** Бот авто-регистрации на subito.it (см. блок в начале документа). Не относится к сайту, не подключён к сборке, содержит реальные токен Telegram-бота и API-ключи SMS/email-сервисов. Рекомендация: удалить файл, **отозвать/перевыпустить все ключи**, проверить историю git. Это security-находка №1.

2. **🟠 Весь раздел `/uslugi/` отсутствует в `sitemap.xml`.** `sitemap.njk` выводит только страницы с `sitemap == true`. Ни `uslugi/*.json`, ни сами страницы услуг этого флага не ставят. В результате в sitemap **не попадают**: `/uslugi/` и все хабы, 6 городов, 7 товарных, 4 способа, 10 торговых услуг, `sbornye-gruzy`, `tamozhennoe-oformlenie`. В sitemap есть только `/`, `/logistika/`, `/torgovlya/`, `/o-kompanii/`, `/kontakty/`, `/politika-konfidencialnosti/` и блог/кейсы. Расходится с обещанием README, что sitemap покрывает сайт.

3. **🟠 Хаб-страницы рендерятся без лейаута.** `uslugi/index.njk`, `uslugi/dostavka/index.njk`, `…/sposoby/index.njk`, `…/tovary/index.njk`, `…/goroda/index.njk`, `…/dop-uslugi/index.njk`, `uslugi/torgovlya/index.njk` не задают `layout` ни во front matter, ни в JSON папки (там только `permalink`). Листовые страницы лейаут прописывают сами, а хабы — нет → они выводятся как **голые HTML-фрагменты** (сетка карточек без `<html>`, `<head>`, хедера, футера, крошек, SEO). Подтверждено на `uslugi/index.njk` (только `<p>` + grid). Вероятный баг — JSON папок должны задавать `layout`.

4. **🟡 i18n полу-подключена.** Машинерия (LOCALES, словари, `t`, `localizedUrl`, hreflang, `dict`) есть, но `/en/`,`/zh/`-URL генерируются только для блога/кейсов. На остальных страницах переключатель языка и hreflang ведут на несуществующие локализованные адреса. Скорее всего, осознанное состояние каркаса, но это живое расхождение.

5. **🟡 `library.byService` строится только по блогу.** Карта обратной связки `related_service → карточка` заполняется при условии `collection === "blog"` и только из ru-версии. При этом все три кейса тоже задают `related_service`, но **связки от кейсов не регистрируются**. Поле-дискриминатор `& { collection }` поэтому всегда `"blog"` (несёт нулевую информацию) — выглядит как частичная/мёртвая логика. Если у услуги есть только связанный кейс и нет статьи — обратный блок будет пуст.

6. **🟡 Осиротевшие товарные страницы.** Файлы `tovary/keramika-plitka.njk` и `tovary/stroymaterialy.njk` существуют и получают URL через `tovary.json`, но в `_data/uslugi.ts` список `tovary` содержит только 5 категорий (без них). Эти страницы **не линкуются** ни с витрины `/uslugi/dostavka/tovary/`, ни из мега-меню (доступны только по прямому URL). По git это сделано намеренно (коммит `517d46a` «убрать стройматериалы и керамику из витрины и мега-меню»), но сами файлы остались — стоит решить, удалять их или возвращать в витрину.

7. **🟡 `article.njk` — вероятный мёртвый лейаут.** `layouts/article.njk` существует, но `layout: layouts/article.njk` не задаёт ни одна страница (блог/кейсы используют `reading.njk`). Подтверждено grep'ом. Кандидат на удаление или это легаси.

8. **🟡 Две «эпохи» дизайна сосуществуют.** `footer.njk`, `404.njk`, `components/card.njk` свёрстаны в старой палитре (`gray-*`, `btn-primary`), а хедер и новые компоненты — на дизайн-токенах (`ink`/`muted`/`surface`/`cyan`/`accent`). Кроме того, футер вставляет `<img src="/assets/img/logo.svg">` вместо макроса `logo()`, поэтому обещание «логотип меняется в одном месте» (`logo.njk`) футером **не соблюдается**.

9. **🟡 Возможное расхождение названия последней крошки в Schema.** Видимые крошки строятся `page.url | breadcrumbs(title)` (последняя крошка может брать `title` страницы), а `schema-breadcrumbs.njk` вызывает `breadcrumbs` **без** `title`. Для контентных страниц (блог/кейсы), чьи слаги не описаны в `LABELS`, имя последней крошки в видимой навигации и в JSON-LD может различаться (в Schema подставится сырой слаг).

10. **🟡 Захардкоженный русский в части компонентов.** `lead-form.njk` и все три `city-*` компонента содержат русские строки напрямую, минуя `t(locale)`/словарь. На en/zh-страницах (если бы они генерировались) эти блоки были бы по-русски.

11. **🟡 Несоответствие «8 vs 7 шагов».** `Dictionary.home.steps` описывает 8 шагов (`s1`–`s8`), а комментарий к `ProcessStep` (`types.ts`) и процесс «Торговли» говорят про «01–07»/7 шагов — комментарий устарел относительно 8-шагового блока главной. Не баг рантайма, но рассогласование.

12. **🟢 `pages.json` хрупкий по `permalink`.** Правило `/{{ page.fileSlug }}/` для index-файлов подпапок дало бы коллизию на `/index/`, но это замаскировано тем, что каждая страница в подпапках переопределяет `permalink`. Добавление нового «плоского» файла в подпапку без своего permalink сломает URL.

---

*Конец карты. Документ отражает состояние репозитория на ветке `claude/codebase-audit-project-map-a8oh9c` на дату аудита.*

---

## 14. Бэкенд заявок → Bitrix24 CRM + Telegram (`server/`)

Заявки со всех форм сайта уходят в Bitrix24 через собственный обработчик на Node без внешних зависимостей. Запуск — `npm run server` (в `npm run dev` поднимается автоматически вместе с 11ty).

**Поток данных:** форма `[data-lead-form]` → `initForms()` в `src/assets/ts/main.ts` (валидация, согласие 152-ФЗ, honeypot) → `POST` JSON на `data-lead-endpoint` (`site.leadApiUrl` ← `LEAD_API_URL`) → `server/index.ts` (`/api/lead`, порт 3000) → `server/lead.ts` (разбор и валидация) → `server/bitrix.ts` (`crm.lead.add` по входящему вебхуку) → лид в CRM, ID возвращается в браузер, а `server/telegram.ts` дублирует заявку в чат менеджера.

| Файл | Роль |
|---|---|
| `server/config.ts` | Загрузка `.env` (свой мини-парсер), нормализация `BITRIX_WEBHOOK_URL` до `/rest/<user>/<token>/` (принимает и полную ссылку на метод с query), маскирование токена для логов, CORS-allowlist, лимиты. |
| `server/lead.ts` | Разбор полезной нагрузки, определение типа контакта (телефон / e-mail / Telegram), валидация (контакт, предмет заявки, согласие), сборка полей `crm.lead.add`: `TITLE`, `PHONE`/`EMAIL`/`IM`, `SOURCE_ID`, `SOURCE_DESCRIPTION`, `UTM_*`, `COMMENTS`. |
| `server/bitrix.ts` | HTTP-вызов метода REST: таймаут (`AbortSignal.timeout`), ретраи только на временных ошибках (сеть, `QUERY_LIMIT_EXCEEDED`, 5xx), повтор без поля `IM`, если портал его не принял. |
| `server/calc.ts` | Единый источник тарифов и формул калькулятора (`CALC_CONFIG`, `computeCalculation`): им пользуются и бэкенд, и `src/_data/calculator.ts`, и клиентский `src/assets/ts/calculator.ts`. Доставка = разовый сбор `billList` (150 $) + тариф за расчётный куб (ЖД 160 $, авто 330 $), поэтому первый кубометр стоит 310/480 $. Таможенная стоимость = товар + половина перевозки (доля делится между товарами пропорционально цене — ставки пошлины и НДС у каждого свои), от неё считаются пошлина и НДС. Комиссия ТЛК БАРС фиксированная: 700 $ при стоимости товара меньше 10 000 $, иначе 1000 $. Города: только Москва, остальные направления считает менеджер (примечание под селектом). |
| `server/rates.ts` | Курсы ЦБ РФ для калькулятора: `cbr-xml-daily.ru` с фолбэком на XML `cbr.ru`, кэш в памяти (`RATES_TTL_MS`) + файл последних известных курсов, отдача устаревших значений с флагом `stale` вместо ошибки. |
| `server/index.ts` | Маршруты (`POST /api/lead`, `GET /api/rates`, `GET /healthz`), CORS, ограничение частоты по IP (тратится только на заявках, уходящих в CRM), honeypot, лимит размера тела, резервный `logs/leads-failed.jsonl` при недоступности CRM. |
| `server/telegram.ts` | Уведомление в чат через Bot API (`parse_mode: HTML`, экранирование, ретрай): на успехе — данные заявки + ссылка на карточку лида, на сбое CRM — предупреждение с теми же данными. Отправляется после ответа браузеру и никогда не бросает исключение: упавший Telegram не должен ломать принятую заявку. |

**Калькулятор.** Заявка со страницы `/calculator/` приходит тем же `POST /api/lead`, но с блоком `calc`: обработчик **пересчитывает суммы сам** (`server/calc.ts` + текущие курсы ЦБ) — в лид попадают наши числа, а не пришедшие из браузера. Заголовок такого лида — «Заявка с калькулятора», детализация расчёта уходит в `COMMENTS`, краткая сводка — в Telegram. Тарифы и ставки правятся только в `server/calc.ts`.

**Прод:** `server/` запускается рядом со статикой и проксируется на тот же домен по `/api/lead` и `/api/rates`; тогда `LEAD_API_URL=/api/lead` и CORS не требуется. Готовые конфиги — `deploy/nginx/tlkbars.ru.conf` (+ сниппет заголовков) и `deploy/systemd/bars-lead.service`; порядок развёртывания — в README, раздел «Хостинг». Две грабли зафиксированы в самих конфигах: `add_header` внутри `location` отменяет унаследованные заголовки (поэтому сниппет включается в каждый блок), а `LEAD_API_URL` вшивается в HTML на сборке, а не читается в рантайме.
