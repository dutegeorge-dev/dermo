# «Ирбис» — внутренняя система ТЛК БАРС (tlkbars.ru/crm/)

Закрытый раздел для сотрудников ООО ТЛК БАРС: **база знаний** (как Confluence) и **CRM** (как Jira). Интерфейс на русском, вход по личному логину и паролю.

- Адрес: `https://tlkbars.ru/crm/` (SPA), API — `https://tlkbars.ru/crm/api/`.
- Есть: вход, пользователи и роли, журнал действий, база знаний, справочник для звонков, CRM — сделки `BARS-N` на канбан-доске и в таблице, этапы воронки, клиенты / поставщики / подрядчики, документы (договоры, инвойсы, накладные, ДТ…) со связями и оплатами, товары с историей цен, поручение на закупку по шаблону, план/факт по сделке.
- Дальше: заявки с сайта сразу в CRM (см. [что дальше](#crm-что-дальше)).

Все данные — в PostgreSQL. JSON в `crm/seed/` — только исходник для первичного импорта справочника; после импорта он не читается, правки из интерфейса пишутся в БД.

Публичный сайт (11ty) и его обработчик заявок (`server/`, amoCRM) раздел не затрагивает: это отдельный пакет со своими зависимостями и отдельной службой.

> Контекст проекта (бизнес, решения владельца и почему, карта файлов, подводные камни, бэклог) — [`CONTEXT.md`](CONTEXT.md). Этот файл — технический справочник.

## Содержание

- [Стек и структура](#стек-и-структура)
- [Локальный запуск](#локальный-запуск)
- [Команды](#команды)
- [Деплой на сервер](#деплой-на-сервер)
- [Бэкапы](#бэкапы)
- [Безопасность](#безопасность)
- [Схема БД](#схема-бд)
- [API](#api)
- [Справочник для звонков](#справочник-для-звонков)
- [CRM](#crm)
- [Сделки и календарь](#сделки-и-календарь)

## Стек и структура

| Слой | Что используется |
|---|---|
| Сервер | Node.js ≥ 20, TypeScript (через `tsx`, без сборки — как `server/` сайта), Fastify 5 |
| БД | PostgreSQL ≥ 14, Drizzle ORM, SQL-миграции в `crm/drizzle/` |
| Пароли | argon2id (`@node-rs/argon2`, готовые бинарники — компилятор не нужен) |
| Фронтенд | React 19, React Router 7, TanStack Query, Tailwind 3, Vite; редактор страниц — TipTap (хранится как JSON) |
| Поиск | PostgreSQL full-text search, словарь `russian` (морфология) + префиксы слов |

Почему отдельный сервис, а не расширение `server/`: обработчик заявок написан на голом `node:http` без зависимостей и обслуживает публичный сайт. Раздел с БД, сессиями и загрузкой файлов удобнее держать отдельно — сбой или обновление CRM не задевают приём заявок.

```
crm/
  package.json          свои зависимости и команды (npm --prefix crm …)
  .env.example          образец настроек → crm/.env (в git не попадает)
  drizzle.config.ts     настройки drizzle-kit
  drizzle/              SQL-миграции (генерируются, коммитятся)
  seed/
    kb-call-script.json данные справочника для звонков (11 тем)
  scripts/backup.sh     бэкап БД и вложений (cron), выгрузка в облако
  shared/deal-fields.ts поля сделки: подписи и варианты — общие для сервера и интерфейса
  server/
    index.ts            точка входа службы
    app.ts              Fastify: API под /crm/api, SPA под /crm/
    config.ts           настройки из окружения / crm/.env
    db/schema.ts        схема БД (этап 1 + таблицы этапа 2)
    lib/                сессии, пароли, CSRF, журнал, лимиты, поиск
    routes/             auth, users, kb, files, calls, search, audit, …, factories
    cli/                migrate, create-admin, seed
    test/api.test.ts    интеграционные тесты API
  web/
    index.html, vite.config.ts, tailwind.config.ts
    src/
      components/       каркас (Layout), поиск, редактор, дерево страниц, справочник
      pages/            экраны: kb/*, CallScript*, Users, Audit, Profile, Login
      lib/              API-клиент, авторизация, тема, форматирование
deploy/
  nginx/tlkbars.ru.conf, tlkbars.live.conf   location /crm/ → 127.0.0.1:3100
  systemd/bars-crm.service                   служба раздела
  deploy-crm.sh                              обновить только /crm/ (без пересборки сайта)
  cron/bars-crm-backup                       ежедневный бэкап
```

## Локальный запуск

Нужны Node 20+ и PostgreSQL.

```bash
# 1. База
sudo -u postgres psql -c "CREATE USER crm WITH PASSWORD 'crm';"
sudo -u postgres psql -c "CREATE DATABASE crm OWNER crm;"

# 2. Зависимости и настройки
npm --prefix crm install
cp crm/.env.example crm/.env
#   DATABASE_URL=postgres://crm:crm@127.0.0.1:5432/crm
#   CRM_COOKIE_SECURE=false        ← локально http, без этого cookie не выставится
#   CRM_TRUST_PROXY=false
#   CRM_ORIGIN=http://localhost:5173,http://localhost:3100

# 3. Миграции, первый админ, начальные данные
npm run crm:migrate
npm run crm:create-admin -- --login admin --name "Иван Петров"
npm run crm:seed

# 4. Разработка: API на :3100 + Vite на :5173 (проксирует /crm/api)
npm run crm:dev
# → http://localhost:5173/crm/
```

Проверить «как в проде» без Vite: `npm run crm:build && npm --prefix crm start` → `http://localhost:3100/crm/`.

## Команды

Из корня репозитория:

| Команда | Что делает |
|---|---|
| `npm run crm:dev` | API (с перезапуском) + Vite dev-сервер |
| `npm run crm:build` | Сборка фронтенда в `crm/web/dist` |
| `npm run crm:migrate` | Применить миграции из `crm/drizzle/` |
| `npm run crm:create-admin -- --login L --name "Имя" [--email E] [--reset]` | Создать администратора. Пароль спрашивается без отображения (или `CRM_ADMIN_PASSWORD=…`). `--reset` — задать новый пароль существующему и сделать его admin (если доступ потерян) |
| `npm run crm:seed [-- --file путь.json] [-- --force]` | Начальные данные (идемпотентно), см. [ниже](#импорт) |
| `npm run crm:seed -- --demo` / `-- --remove-demo` | Добавить / удалить демо-данные (метка «демо»): сделки на всех этапах, клиенты, поставщики и подрядчики с реквизитами, договоры, инвойсы с товарами, поручения, счета, накладная, ДТ, сертификат, доверенность, оплаты, страницы базы знаний. Справочник для звонков не трогается |
| `npm run crm:tnved [-- --if-empty] [-- --file x.xlsx]` | Обновить справочник ТН ВЭД со ставками пошлин (выгрузка tws.by, ~13 тыс. кодов). `--if-empty` — только если пуст (так делает `deploy-crm.sh`); раз в сутки — cron `deploy/cron/bars-crm-tnved` |
| `npm run crm:guide [-- --force]` | Инструкция для сотрудников в базу знаний (пространство «Компания», 12 страниц со скриншотами) из `crm/seed/guide/`. Без `--force` — только если её ещё нет (так делает `deploy-crm.sh`); `--force` — обновить из файлов (новые версии страниц, картинки заменяются) |
| `npm run crm:test` | Интеграционные тесты API — нужна **отдельная** БД: `CRM_TEST_DATABASE_URL=postgres://…/crm_test` (она очищается) |

В `crm/`: `npm run typecheck`, `npm run db:generate` (новая миграция после правки `server/db/schema.ts`), `npm start` (прод-запуск).

## Деплой на сервер

Раскладка как у сайта: репозиторий в `/var/www/tlkbars/repo`, владелец `www-data`.

### Первый раз

```bash
# 1. PostgreSQL
sudo apt install postgresql
sudo -u postgres psql -c "CREATE USER crm WITH PASSWORD '<длинный пароль>';"
sudo -u postgres psql -c "CREATE DATABASE crm OWNER crm;"

# 2. Код (ветка уже влита в main) и зависимости раздела
cd /var/www/tlkbars/repo
git pull
npm --prefix crm ci           # вместе с dev-зависимостями: они нужны для сборки фронтенда

# 3. Настройки
cp crm/.env.example crm/.env
nano crm/.env
#   DATABASE_URL=postgres://crm:<пароль>@127.0.0.1:5432/crm
#   CRM_ORIGIN=https://tlkbars.ru
#   CRM_UPLOAD_DIR=/var/lib/bars-crm/uploads
#   CRM_COOKIE_SECURE=true
#   CRM_TRUST_PROXY=true
#   ANTHROPIC_BASE_URL=…, ANTHROPIC_AUTH_TOKEN=…   # ИИ (необязательно)
sudo chown www-data:www-data crm/.env && sudo chmod 600 crm/.env

# 4. Сборка, миграции, первый админ, данные
npm run crm:build
npm run crm:migrate
npm run crm:create-admin -- --login admin --name "Имя Фамилия"
npm run crm:seed                 # пространства + справочник; добавьте -- --demo, чтобы попробовать CRM
sudo chown -R www-data:www-data /var/www/tlkbars/repo

# 5. Служба
sudo cp deploy/systemd/bars-crm.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now bars-crm
curl -s http://127.0.0.1:3100/crm/api/health      # {"ok":true}

# 6. nginx — в server{} для tlkbars.ru добавить блок location /crm/
#    (он уже есть в deploy/nginx/tlkbars.live.conf и tlkbars.ru.conf):
sudo cp /etc/nginx/sites-available/tlkbars /etc/nginx/sites-available/tlkbars.bak
sudo cp deploy/nginx/tlkbars.live.conf /etc/nginx/sites-available/tlkbars
sudo nginx -t && sudo systemctl reload nginx

# 7. Бэкапы и ежедневное обновление справочника ТН ВЭД
sudo cp deploy/cron/bars-crm-backup /etc/cron.d/bars-crm-backup
sudo cp deploy/cron/bars-crm-tnved /etc/cron.d/bars-crm-tnved
sudo chmod 644 /etc/cron.d/bars-crm-backup /etc/cron.d/bars-crm-tnved
sudo bash crm/scripts/backup.sh                   # проверить вручную
#    облако — см. «Бэкапы в облако» ниже

# 8. robots.txt с Disallow: /crm/ появится после пересборки сайта
npm run build
```

Блок nginx (для справки):

```nginx
location = /crm { return 301 /crm/; }

location ^~ /crm/ {
    proxy_pass http://127.0.0.1:3100;
    proxy_http_version 1.1;
    proxy_set_header Host              $host;
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    client_max_body_size 30m;
    proxy_connect_timeout 5s;
    proxy_send_timeout   300s;
    proxy_read_timeout   300s;   # ИИ-разбор документа и чат отвечают до 1–2 минут
    proxy_hide_header X-Robots-Tag;
    add_header X-Robots-Tag "noindex, nofollow" always;
}
```

### Обновления

- **Только CRM, без пересборки сайта:** `sudo bash deploy/deploy-crm.sh` — фиксирует правки CMS и подтягивает `main` (как `deploy.sh`), затем зависимости `crm/`, сборка фронтенда, миграции, перезапуск `bars-crm` и проверка `/crm/api/health`. Сайт (`_site`) и `bars-lead` не трогаются.
- **Всё вместе:** `sudo bash deploy/deploy.sh` — пересобирает сайт и после этого делает то же для `/crm/` (если служба `bars-crm` установлена; до установки шаг пропускается).

Если в обновлении менялись шаблоны сайта или `server/`, нужен полный `deploy.sh`.

Каталоги фабрик (миграция 0015): `deploy-crm.sh` сам ставит `poppler-utils` (pdftotext / pdftoppm — сканы). nginx менять не нужно: файлы идут кусками по 8 МБ (лимит тела `/crm/` — 30 МБ).

После обновления с документами (миграция 0003: `clients` → `counterparties`, документы, товары) один раз выполните `npm run crm:seed` — он заполнит «Реквизиты компании» для поручений, если они пусты (остальное `seed` не трогает).

### Проверка после деплоя

```bash
curl -sI https://tlkbars.ru/crm/ | grep -i x-robots       # noindex, nofollow
curl -s  https://tlkbars.ru/crm/api/kb/spaces              # {"error":"Требуется вход"} (401)
curl -s  https://tlkbars.ru/robots.txt | grep crm          # Disallow: /crm/
```

## Бэкапы

- `crm/scripts/backup.sh` — `pg_dump` в формате custom + архив каталога вложений, в `/var/backups/bars-crm/`. Дампы базы хранятся 14 дней (`CRM_BACKUP_DIR`, `CRM_BACKUP_KEEP_DAYS`), **архивов вложений — только 2 последних** (`CRM_BACKUP_UPLOADS_KEEP`): вложений бывает несколько ГБ (каталоги фабрик). Недокачанное (`partial/`) не архивируется; не хватает места на архив (+1 ГБ запаса) — архив вложений пропускается с предупреждением, дамп базы делается всегда. С облаком локальный архив вложений после выгрузки удаляется.
- `/etc/cron.d/bars-crm-backup` — каждый день в 00:40 по времени сервера (03:40 МСК при UTC), лог — `/var/log/bars-crm-backup.log`.
- Если задан `CRM_BACKUP_RCLONE_REMOTE`, копия сразу уходит в облако (хранение `CRM_BACKUP_CLOUD_KEEP_DAYS`, по умолчанию 30 дней), размер облачной копии сверяется с локальной.
- Если бэкап не удался (дамп, архив, выгрузка) — сообщение в Telegram при заданных `CRM_BACKUP_TELEGRAM_TOKEN` и `CRM_BACKUP_TELEGRAM_CHAT`, и ненулевой код в логе.

Чаще раза в сутки — поменяйте расписание в `/etc/cron.d/bars-crm-backup` (например `40 */6 * * *` — каждые 6 часов); скрипт рассчитан на любое число запусков в день.

### Бэкапы в облако

Выгрузка идёт через [rclone](https://rclone.org) — он умеет и S3-хранилища, и Яндекс Диск. В базе персональные данные клиентов (ФИО, телефоны), поэтому:

- храним в **российском** облаке (152-ФЗ) — рекомендуем **Яндекс Object Storage** (холодное хранилище — копейки за гигабайт) или Selectel;
- шифруем **до отправки** — слой `crypt` в rclone: в облаке лежат только зашифрованные файлы, без пароля их не прочитать даже владельцу аккаунта облака.

Настройка (один раз, от root — cron запускает бэкап от root):

```bash
sudo apt install rclone

# 1. Хранилище. Яндекс Cloud: создать бакет (например tlkbars-backups, класс «Холодное»),
#    сервисный аккаунт с ролью storage.uploader + storage.viewer и статический ключ доступа.
sudo rclone config create yandex s3 provider=Other env_auth=false \
  access_key_id=<ID ключа> secret_access_key=<секрет> \
  endpoint=https://storage.yandexcloud.net region=ru-central1 acl=private

#    (Вариант — Яндекс Диск: sudo rclone config, тип «yandex», войти в аккаунт в браузере.)

# 2. Шифрование поверх хранилища. Пароли сохраните в менеджере паролей:
#    без них бэкап из облака не восстановить.
sudo rclone config create tlkbars-crypt crypt remote=yandex:tlkbars-backups/crm \
  password=$(rclone obscure '<длинный пароль>') password2=$(rclone obscure '<второй пароль>') \
  filename_encryption=off directory_name_encryption=false

# 3. В crm/.env:
#    CRM_BACKUP_RCLONE_REMOTE=tlkbars-crypt:
#    CRM_BACKUP_TELEGRAM_TOKEN=<токен бота>   CRM_BACKUP_TELEGRAM_CHAT=<ID чата>

# 4. Проверка
sudo bash crm/scripts/backup.sh
sudo rclone ls tlkbars-crypt:
```

Восстановление из облака: `sudo rclone copy tlkbars-crypt:crm-2026-10-08_0040.dump /tmp/` — и дальше как ниже.

Восстановление (из локальной копии или скачанной из облака):

```bash
sudo systemctl stop bars-crm
pg_restore --clean --if-exists --no-owner -d "postgres://crm:<пароль>@127.0.0.1/crm" /var/backups/bars-crm/crm-2026-10-08_0040.dump
sudo tar -xzf /var/backups/bars-crm/uploads-2026-10-08_0040.tar.gz -C /var/lib/bars-crm
sudo chown -R www-data:www-data /var/lib/bars-crm
sudo systemctl start bars-crm
```

## Безопасность

- **Учётки личные**, общего пароля нет. Первый админ — `crm:create-admin`, остальных заводит админ в «Пользователи». Удаления нет — только отключение: авторство правок и журнал сохраняются.
- **Роли**: `admin` — всё, плюс пользователи и журнал действий, удаление пространств; `manager` — читает всё, редактирует базу знаний, справочник, сделки и клиентов. Только admin: этапы воронки, удаление сделок и клиентов.
- **Пароли** — argon2id (m=19 МБ, t=2), минимум 8 символов. Смена пароля и отключение завершают сессии пользователя.
- **Сессия** — случайный токен в cookie `bars_crm_session`: `HttpOnly; Secure; SameSite=Lax; Path=/crm`, 30 дней, продлевается при активности. В БД хранится только SHA-256 токена.
- **CSRF** — у каждой сессии свой токен; фронтенд шлёт его в `X-CSRF-Token` на всех изменяющих запросах, плюс проверка `Origin`. Вход принимает только JSON.
- **Лимит входа** — 20 попыток с IP и 5 неудачных на логин за 15 минут (`CRM_LOGIN_LIMIT_*`). IP берётся из `X-Forwarded-For` только от nginx на 127.0.0.1.
- **Вложения** отдаются только с сессией; inline — лишь картинки и PDF, остальное скачивается (защита от HTML/SVG с скриптами).
- **Без индексации**: `X-Robots-Tag: noindex, nofollow` на все ответы (сервис + nginx), `<meta name="robots">`, `Disallow: /crm/` в robots.txt; в sitemap раздел не попадает (он не часть сборки 11ty); ссылок с публичного сайта нет.
- **Журнал действий** (`audit_log`): входы/выходы, создание, правка, перенос, удаление, откаты — кто, когда, что, с какого IP. Экран «Журнал действий» — для admin.

## Схема БД

Источник истины — `server/db/schema.ts`, SQL — `drizzle/*.sql`.

### Этап 1

| Таблица | Назначение |
|---|---|
| `users` | Сотрудники: `login` (нижний регистр, уникальный), `name`, `email`, `role` (`admin`/`manager`), `password_hash` (argon2id), `is_active`, `last_login_at` |
| `sessions` | `id` = SHA-256 токена, `user_id`, `csrf_token`, `expires_at`, `last_seen_at`, `ip`, `user_agent` |
| `audit_log` | `user_id`, `action` (create/update/delete/move/restore/login/logout/import), `entity_type`, `entity_id`, `summary` (текст для журнала), `data` (jsonb: что было до удаления и т.п.), `ip`, `created_at` |
| `kb_spaces` | Пространства: `key` (SALES, CUSTOMS…), `name`, `description`, `position` |
| `kb_pages` | Страницы: `space_id`, `parent_id` (дерево любой вложенности), `title`, `content` (TipTap JSON), `content_text` (плоский текст), `position`, `version`, авторы; `search` — `tsvector` (russian, заголовок с весом A) + GIN-индекс |
| `kb_page_versions` | Каждое сохранение страницы: `version`, `title`, `content`, `note` («Создание», «Откат к версии 3»), автор, время |
| `attachments` | Файлы: `owner_type` (`kb_page` или `deal`) + `owner_id`, имя, MIME, размер, `storage_key` (путь в `CRM_UPLOAD_DIR`) |
| `call_script_topics` | Строки справочника: `id`, `position`, `title`, `ask` (jsonb string[]), `qa` (jsonb [{q, a}]), `search_text` + `search` (tsvector) |
| `call_script_versions` | Снимок всего справочника на каждое сохранение: `version`, `topics` (jsonb), `note`, автор |

### CRM

| Таблица | Назначение |
|---|---|
| `counterparties` | Контрагент: `role` (`client` / `supplier` / `contractor`), `contractor_type` (`carrier_cn`, `carrier_ru`, `broker`, `warehouse`, `agent`, `other`), `kind` (`ooo`/`ip`/`foreign`/`other`), `name` (как в документах), `full_name`, `country`, ИНН/КПП/ОГРН или `reg_number` (USCC), адреса, банк (счёт, БИК, к/с, ИНН и адрес банка, SWIFT), подписант (должность, ФИО, основание), e-mail, телефон. До миграции 0003 таблица называлась `clients` |
| `contacts` | Контакты контрагента (`counterparty_id`): `name`, `phone`, `messenger` (`telegram`/`whatsapp`/`max`/`wechat`/`other`) + `messenger_handle`, `email`, `position`, `is_primary` |
| `deal_statuses` | Этапы воронки = колонки доски: `key`, `name`, `color`, `position`, `is_final` (последний этап). Начальный набор (миграция 0002): Новая заявка → Поиск товара → Расчёт доставки предварительный → Предложение клиенту → Заказ у поставщика → Расчёт доставки → Согласование доставки → Доставка / информирование клиента → Завершено |
| `deals` | Лид воронки продаж (работа с клиентом до депозита), ключ `key` = `BARS-` + `number` (последовательность `deal_number_seq`), поля ниже. Груз, поставщик, договоры и документы — не здесь, а в `shipments` (миграция 0005 перенесла их туда) |
| `documents` | Документ любого типа (`type`, справочник — `shared/documents.ts`): `number`, `date`, `counterparty_id` (вторая сторона), `client_id` (клиент, к которому относится документ поставщика/подрядчика), `shipment_id` (сделка), `parent_id` (договор: поручение → договор комиссии, инвойс → контракт), `seq_no` (номер приложения в договоре), `currency`, `amount`, `status` (`draft`/`signed`/`cancelled`), `payment_status` (`unpaid`/`partial`/`paid`), `paid_amount`, `paid_at`, `valid_until`, `data` (jsonb: Incoterms, условия оплаты, смета поручения, статья расходов…), `notes`. Файлы — `attachments` с `owner_type='document'` и меткой `original`/`signed`/`payment` (документ об оплате)/`generated` (сформирован системой). `data.packing` — строки и итоги упаковочного листа |
| `document_items` | Позиции документа: `product_id`, `name` (как в документе), `batch_no` («партийный номер» поручения), `hs_code`, `quantity`, `unit`, `price`, `amount` |
| `factories` | База фабрик: `name` (как в WeChat), `name_ru`, `wechat_id`, `contact_name`, `phone`, `email`, `website`, `location` (место производства), `categories` text[], `status` (`new`/`contacted`/`samples`/`approved`/`rejected`), `profile` jsonb (анкета — `shared/factories.ts`), `notes`, `found_by` (кто нашёл — видит кандидата), `counterparty_id` (поставщик после договора; тогда фабрику видят все) |
| `catalogs` | Каталоги из рассылки: `attachment_id` (файл: owner_type `catalog`, после подтверждения — `factory`), `filename`, `size`, `sha256` (дубли), `sender` / `chat` (контакт WeChat), `status` (`queued`/`processing`/`review`/`done`/`failed`), `method` (`text`/`images`/`none`), `pages`, `result` jsonb (компания, контакты, `categories` — `CatalogResult` в `shared/factories.ts`), `text` (для поиска), `note`, `usage`, `factory_id` |
| `catalog_senders` | Строки со скриншотов окна «Файлы» WeChat: `filename`, `size` (как на экране — «12.8M»), `sender`, `chat` |
| `catalog_shots` | Скриншоты окна «Файлы» (файл — attachments `catalog_shot`, label — sha256): `filename`, `status` (`queued`/`processing`/`done`/`failed`), `rows` — сколько строк прочитано, `note` |
| `product_offers` | Цены фабрик: `factory_id`, `product_id` (товар справочника — по названию без размера рулона и цвета), `name` (позиция с характеристиками), `price`, `currency`, `unit`, `moq`, `per_container` (единиц в 40HQ), `kg_per_unit`, `m3_per_unit`, `conditions`, `quoted_at` |
| `freight_rates` | Ставки доставки: `transport` (rail/truck/sea/multimodal), `mode` (`container` / `cbm`), `container`, `origin`, `destination`, `rate`, `currency`, `kg_per_cbm`, `min_cbm`, `fee` + `fee_currency` (за отправку), `transit_days`, `etd`, `valid_until`, `quoted_at`, `carrier_name`, `notes` |
| `estimates` | Раздел «Расчёт»: заявки клиентов на их товары — `title`, `client_name`, `scheme` (`commission` / `teu`), `request` (текст заявки), `params` / `result` (jsonb, `shared/estimate.ts`; `params.markup` — наличные сверху расчёта, только админам), `freight`, `rates`, `rates_date` |
| `payments` | Оплата на несколько счетов (одна платёжка → несколько инвойсов, в т. ч. другой сделки): `shipment_id`, `counterparty_id` (получатель), `number`, `date`, `amount`, `currency`, `note` (что за не разнесённый остаток). Файл — `attachments` с `owner_type='payment'`. Обычная оплата одного счёта сюда не пишется |
| `payment_allocations` | Разнесение оплаты: `payment_id`, `document_id`, `amount`. Статус оплаты таких документов считается из разнесения |
| `product_quotes` | Расчёты цены товара для клиента: `product_id`, `offer_id`, `client_name`, `params` / `result` / `freight` / `rates` (jsonb, `shared/quote.ts`), `rates_date` |
| `products` | Справочник товаров: `name`, `name_ru`, `hs_code`, `unit`, `vat10` (НДС при ввозе 10 % вместо 22 %). Пополняется сам из позиций и цен фабрик: товар — название без варианта (размер рулона «2×25 м», цвет, число мест в скобках — `server/lib/product-match.ts`), сама позиция хранит полное название; код ТН ВЭД из позиции записывается товару, если у него не было |
| `tnved` | Справочник ТН ВЭД ЕАЭС: `code` (10 цифр), `name`, `tariff` (ставка текстом: «6.5%, но не менее 0.096 EUR за 1 кг»; разбор — `parseTariff` в `shared/customs.ts`). Заполняется `npm run crm:tnved` |
| `settings` | Настройки, ключ → JSON. `company` — реквизиты ООО ТЛК БАРС, счета (`accounts`) и какой счёт ставить в поручения |
| `deal_comments` | Комментарии: `deal_id`, `author_id`, `body` |
| `shipments` | Сделка (заказ / отгрузка) — начинается с оплаты депозита, независима от воронки. `title` (название груза — как вы его называете), `number` (последовательность `shipment_number_seq`, вторичный «№ 12»), `status` (`active`/`closed`/`cancelled`, закрывается вручную), `stage` 1–8 (вычисляется из фактических дат), `scheme` (`commission`/`supply`/`teu`), `client_id`, `contact_id`, `supplier_id`, `carrier_id`, `carrier_invoice_id`, `client_contract_id`, `supplier_contract_id` (подбираются сами), `deal_id` (лид из воронки, необязательно), `assignee_id`, `container_no`, `hs_code`, `weight_kg`, `volume_m3`, `transport`, `pickup_location`, `delivery_location`, `export_license`, `certificates`, `certificate_holder`, `chestny_znak`, `flags` (jsonb: отмеченные ожидания → дата), `spec` (jsonb `SpecParams`: получатель, станция, описания для спецификации перевозчика), `calc` (jsonb `ShipmentCalc`: расчёт для клиента — смета КП/поручения, курсы ЦБ и их дата, таможенные платежи по товарам), `notes`. Вес и объём обязательны при создании сделки (`POST /shipments`, `newShipment`) |
| `shipment_parties` | Подрядчики сделки (перевозчики, брокер, СВХ…) — `shipment_id` + `counterparty_id`; добавляются сами из их счетов |
| `shipment_milestones` | Ключевые даты сделки: `shipment_id` + `key` (`deposit`, `ready`, `loading`, `departure`, `border`, `transshipment`, `arrival`, `release`, `delivery`), `plan`, `fact` |
| `shipment_events` | История сделки: переносы дат, факты, этапы, флажки, правки полей, комментарии |
| `deal_events` | Журнал изменений сделки: `kind` (created, field_changed, status_changed, lost, reopened, attachment_added), `field`, `old_value`/`new_value` (человекочитаемые), кто, когда |

Поля `deals` (лид):

| Поле | Тип / значения |
|---|---|
| `title` | название |
| `client_id`, `contact_id` | клиент, его контакт |
| `status_key`, `outcome`, `lost_reason`, `closed_at` | этап; итог: `null` — в работе, `won` — на завершающем этапе, `lost` — отказ (на любом этапе, с причиной) |
| `product` | что хочет клиент |
| `assignee_id`, `due_date`, `priority`, `labels` | исполнитель, срок, `low`…`urgent`, метки (text[]) |
| `description` | текст |
| `board_position` | порядок карточки в колонке |
| `source` | `manual` / `site` (заявки с сайта, позже) / `demo` (тестовые) |
| вложения (КП) | `attachments` с `owner_type = 'deal'` |

## API

Все пути под `/crm/api`. Без сессии — `401 {"error":"Требуется вход"}` (кроме `POST /auth/login` и `GET /health`). Изменяющие запросы — с заголовком `X-CSRF-Token`.

| Метод и путь | Что делает |
|---|---|
| `POST /auth/login` `{login,password}` | Вход, ставит cookie, возвращает `{user, csrfToken}` |
| `POST /auth/logout`, `GET /auth/me` | Выход; текущий пользователь и CSRF-токен |
| `POST /auth/password`, `PATCH /auth/profile` | Смена своего пароля; имя и e-mail |
| `GET/POST /users`, `PATCH /users/:id` | Пользователи (admin) |
| `GET /users/directory` | Краткий список сотрудников (для выбора исполнителя) |
| `GET/POST /kb/spaces`, `PATCH/DELETE /kb/spaces/:id`, `GET /kb/spaces/:key` | Пространства; дерево страниц |
| `POST /kb/pages`, `GET/PUT/DELETE /kb/pages/:id` | Страницы; `PUT` с `baseVersion` → 409 при чужой правке |
| `POST /kb/pages/:id/move` `{parentId,index}` | Перенос в дереве |
| `GET /kb/pages/:id/versions[/:v]`, `POST …/:v/restore` | История и откат |
| `POST /kb/pages/:id/attachments` (multipart `file`), `GET/DELETE /files/:id` | Вложения |
| `GET /calls`, `POST /calls/topics`, `PUT/DELETE /calls/topics/:id`, `POST /calls/reorder` | Справочник |
| `GET /calls/versions[/:v]`, `POST /calls/versions/:v/restore` | История справочника и откат |
| `GET /stages`, `PUT /stages` (admin) | Этапы воронки; `PUT` — полный список в новом порядке |
| `GET /deals?view=board` | Доска: всё в работе + успешные за 30 дней |
| `GET /deals?outcome=open\|won\|lost\|all&stage=&assignee=me\|none\|id&client=&label=&q=&sort=&dir=` | Таблица |
| `POST /deals`, `GET/PATCH/DELETE /deals/:key` | Лид по ключу `BARS-12` (+ его сделки); `PATCH` — любые поля, каждое изменение в журнал; удаление — admin |
| `POST /deals/:key/move` `{statusKey, beforeKey}` | Перенос на этап / в место колонки |
| `POST /deals/:key/lose` `{reason}`, `POST /deals/:key/reopen` | Отказ и возврат в работу |
| `POST /deals/:key/comments`, `DELETE /deals/:key/comments/:id`, `POST /deals/:key/attachments` | Комментарии, вложения |
| `GET /counterparties?role=client\|supplier\|contractor&type=&q=`, `POST /counterparties` | Контрагенты |
| `GET/PATCH/DELETE /counterparties/:id` | Карточка: реквизиты, контакты, сделки, документы, товары с ценами, связанные контрагенты |
| `POST /counterparties/:id/contacts`, `PATCH/DELETE /contacts/:id` | Контакты |
| `GET /documents?type=&group=&counterparty=&client=&shipment=&parent=&payment=unpaid\|partial\|paid\|debt&expiring=30&q=` | Реестр документов |
| `POST /documents` | Новый документ; `items` — позиции, `newShipment: {clientId, title, scheme}` — создать сделку из документа |
| `GET/PATCH/DELETE /documents/:id`, `GET /documents/next-seq?parent=&type=` | Документ; следующий номер приложения |
| `POST /documents/:id/files?label=original\|signed\|payment` | Файл документа (подписанный скан ставит статус «подписан»; `payment` — платёжка / SWIFT) |
| `POST /shipments/:number/order`, `GET /documents/:id/docx` | Сформировать поручение по сделке; DOCX по шаблону (поручение; договор комиссии — заново по реквизитам клиента) |
| `GET /shipments?status=active\|closed\|cancelled\|all&stage=&assignee=me&clientId=&q=`, `POST /shipments` | Сделки (доска и список) |
| `GET/PATCH/DELETE /shipments/:number` | Карточка: поля, документы, план/факт, товары, сертификаты на товары, подрядчики, история |
| `PUT /shipments/:number/milestones/:key` `{plan?, fact?, shift?}`, `PUT /shipments/:number/flags/:key` `{done, date?}` | Ключевые даты (со сдвигом следующих) и флажки (галочки оплат меняют оплату документов, `date` — дата оплаты) |
| `POST /estimates/:id/shipment` `{clientId?, title?}` | Сделка по расчёту (груз, схема, вес, объём, маршрут, ТН ВЭД; наличные — админу) |
| `PUT /shipments/:number/cash` `{currency, goods, delivery, note}` (admin; `{}` — убрать) | Наличные сверху по сделке; в карточке — `cash` (только админам) |
| `GET/POST /estimates`, `GET/PUT/DELETE /estimates/:id`, `POST /estimates/parse` `{text}` или multipart (`file` — инвойс, `text`), `POST /estimates/hs` `{name}`, `GET /estimates/:id/kp.docx` | Раздел «Расчёт»: расчёты по заявкам (пересчёт на сервере по переданным курсам), ИИ-разбор текста заявки (с подбором кода ТН ВЭД), подбор кода по названию, КП в Word |
| `POST /payments` `{shipment?, counterpartyId?, number?, date, amount, currency, note?, allocations: [{documentId, amount}]}`, `DELETE /payments/:id`, `POST /payments/:id/files` | Оплата на несколько счетов: статусы оплаты счетов и галочки сделок — из разнесения. В карточке сделки — `payments`, `paymentNotes` (пояснение для таможни) |
| `POST /shipments/:number/flags/:key/proof` (multipart `file`) | Платёжка к галочке оплаты — файл `payment` к последнему инвойсу / счёту / ДТ этой оплаты |
| `POST /shipments/:number/stage` `{stage}`, `POST /shipments/:number/status` `{status}` | Перенос на доске; закрыть / отменить / вернуть |
| `POST/DELETE /shipments/:number/parties[/:id]`, `POST /shipments/:number/comments` | Подрядчики, комментарии |
| `GET /calendar` | События календаря по сделкам в работе |
| `GET/POST /products`, `GET/PATCH/DELETE /products/:id`, `POST /products/:id/merge` | Товары (`hsCode` — 10 цифр, `vat10`); карточка со ставкой из ТН ВЭД; объединение дублей |
| `GET /tnved?q=` | Справочник ТН ВЭД: по началу кода или словам; `parsed` — разобранная ставка |
| `GET /shipments/:number/calc` | Расчёт сделки (или параметры по умолчанию), товары с кодами и ставками, таможенные платежи из поручения |
| `POST /shipments/:number/calc` `{transportAmount, transportCurrency, transportLabel, fxPercent, broker, terminal, commission, lastMile, deliveryTerm, refreshRates}` | Рассчитать и сохранить; курс — прошлого расчёта, `refreshRates: true` — свежий ЦБ |
| `GET/PUT /shipments/:number/spec` | Спецификация для перевозчика: данные (поля, строки по позициям, чего не хватает, предупреждения) / параметры (получатель, станция, описания) |
| `POST /shipments/:number/spec.xlsx` (multipart `file` — шаблон перевозчика, необязательно) | Сформировать Excel, сохранить документом `carrier_spec` и отдать |
| `GET /shipments/:number/customs-pack`, `GET /shipments/:number/customs-pack.zip` | Пакет документов для таможни: состав и недостающее / ZIP с описью |
| `GET /shipments/:number/kp.docx` | КП в Word по шаблону `templates/kp.docx` (свой — `CRM_UPLOAD_DIR/templates/kp.docx`) |
| `GET/PUT /settings/company`, `GET/POST/DELETE /settings/templates/commission_order[.docx]` | Реквизиты компании; шаблон поручения (admin) |
| `GET /search?q=` | Глобальный поиск: сделки, клиенты, страницы, справочник; сниппеты с `<mark>` |
| `GET /audit?before=&userId=&entityType=` | Журнал действий (admin) |
| `GET /ai/status` | Подключён ли ИИ (`{enabled}`) |
| `POST /ai/parse-document` (multipart `file`) | ИИ-разбор файла → `{draft}` черновик формы документа (ничего не сохраняет) |
| `POST /ai/chat` `{messages, page}` | ИИ-чат по данным CRM (только чтение) → `{reply, tools}` |
| `POST /ai/parse-requisites` (multipart: `text` и/или файл) | ИИ: реквизиты организации / ИП из вставленного текста → поля контрагента |
| `GET/POST /counterparties/:id/commission-contract` `{number, date, city, validUntil}` | Договор комиссии с клиентом: подсказки (следующий номер, город, чего не хватает) / создать документ с DOCX по шаблону |
| `GET /settings/templates/:name.docx`, `POST/DELETE /settings/templates/:name` (`commission_order`, `commission_contract`) | Шаблоны поручения и договора комиссии: скачать, загрузить свой, вернуть стандартный |
| `POST /ai/recognize-factory` (multipart, до 12 файлов) | ИИ: карточка фабрики по скриншотам WeChat, фото, прайсам → `{draft}` (картинки ≤ 3,7 МБ, до 8; сканы PDF не отправляются) |
| `GET /factories?q&status&category&flag&mine`, `POST /factories` `{…, profile, offers}` | Список фабрик (кандидатов — только свои, админу все) и создание с ценами |
| `GET /factories/duplicates?wechatId&phone&name&except` | Дубли; чужого кандидата не раскрывает — только кто нашёл |
| `GET/PATCH/DELETE /factories/:id` | Карточка (анкета, цены, файлы) / правка (offers — заменить целиком) / удаление (кандидата — нашедший или админ, поставщика — админ) |
| `POST /factories/:id/files?label=photo\|catalog\|screenshot`, `POST /factories/:id/supplier` | Файл фабрики; «сделать поставщиком» |
| `GET /catalogs` | Каталоги (только админ): файлы не в «Готово», группы на проверке по контакту с подходящей фабрикой (`match`), счётчики, отправители со скриншотов, категории |
| `POST /catalogs/uploads` `{name, size, lastModified}` → `{id, offset}`; `PUT /catalogs/uploads/:id?offset=N` (тело — кусок ≤ 16 МБ, `application/octet-stream`; не то место — 409 с `offset`); `POST /catalogs/uploads/:id/finish` `{name, size, type}` | Загрузка каталога кусками с докачкой (до `CRM_MAX_CATALOG_MB`): недокачанное — `CRM_UPLOAD_DIR/partial/<id>` (id — от пользователя, имени, размера и даты файла; брошенное > 7 дней удаляется); после завершения — в очередь разбора (тот же sha256 — `duplicate`) |
| `POST /catalogs/check` `{files:[{name,size}]}` | Какие файлы уже загружены (имя + размер) — повторная загрузка папки их пропускает |
| `POST /catalogs/senders` (multipart, скриншоты) → `{saved, same, skipped}` | Сохранить скриншоты окна «Файлы» WeChat (тот же — `same`); ИИ читает их в фоне → `catalog_senders`, отправитель у каталогов без него |
| `PATCH /catalogs/:id` `{sender}`, `POST /catalogs/:id/retry` (`all` — все с ошибкой, и скриншоты), `DELETE /catalogs/:id` | Отправитель вручную; разобрать заново; удалить неподтверждённый с файлом |
| `POST /catalogs/confirm` `{groups:[{catalogIds, factoryId, nameRu, categories}]}` | Группы → новая (`factoryId: null`) или найденная фабрика, файлы — в её карточку |
| `POST /factories/categories/rename` `{from, to}` | Переименовать / слить категорию во всех фабриках (админ) |
| `GET /products/:id/offers` | Цены фабрик на товар (с учётом доступа) и их фото |
| `GET /products/unused`, `POST /products/unused/delete` (админ) | Пустые товары (без закупок, продаж, цен фабрик, расчётов): список / удалить |
| `GET /products/duplicates`, `POST /products/merge` `{ids, name}` | Группы похожих товаров (одно название без варианта); объединить в первый (позиции и цены фабрик переходят) |
| `GET/POST /freight-rates`, `PATCH/DELETE /freight-rates/:id` | Ставки доставки |
| `POST /ai/recognize-rates` (multipart: `text` и/или файлы) | ИИ: ставки из переписки с перевозчиком → черновики |
| `GET /cbr-rates` | Курсы ЦБ на сегодня (для расчёта в браузере) |
| `GET/POST /products/:id/quotes` `{params, rates?, ratesDate?}`, `GET /quotes/:id/kp.docx`, `DELETE /quotes/:id` | Расчёты цены товара (сервер пересчитывает), КП в Word, удаление (автор / админ) |

## Справочник для звонков

Один список в порядке разговора. Строка — вопросы менеджера клиенту (`ask`, первый крупнее, справа мелко — тема `title`; если `ask` пуст — строкой служит `title`). Раскрыть строку → «Если клиент спрашивает:» и вопросы клиента; клик по вопросу → ответ и «Копировать» (копирует ровно как набрано). Формат ответа: пустая строка — абзац, «— » — пункт списка, «1. » — нумерованный пункт.

Поиск — по строкам, темам, вопросам и ответам, все слова запроса, без учёта регистра и ё/е, с подсветкой; совпадение в ответе раскрывает строку и вопрос. «Редактировать» включает правку: изменить строку, добавить, удалить (с подтверждением), переставить (стрелками или перетаскиванием; новый порядок сохраняется одной версией). Каждое сохранение — новая версия в «истории версий» с просмотром и откатом.

### Импорт

`npm run crm:seed` читает `crm/seed/kb-call-script.json` (`{ "topics": [ { "id", "order", "title", "ask": [], "qa": [ { "q", "a" } ] } ] }`) и создаёт пространства «Продажи», «Таможня», «Логистика», «Компания», если их нет.

- Без флагов — добавляет только темы, которых ещё нет (по `id`), на их место по `order`. Правки, сделанные в интерфейсе, повторный запуск не трогает.
- `--force` — темы из файла перезаписывают одноимённые и встают в порядке файла; темы, созданные в интерфейсе, остаются после них.
- Любое изменение — новая версия в истории («Импорт из kb-call-script.json»), так что импорт можно откатить.

## CRM

**Воронка продаж** (`/crm/deals`) — только работа с клиентом до депозита: кто клиент, что хочет, КП (файлы), переговоры. Колонки — этапы воронки, карточка — ключ, название, клиент, исполнитель, метки, срок (просрочка — красным), приоритет «Высокий/Срочный». Карточки перетаскиваются между колонками и внутри колонки; «+» в шапке колонки — новая сделка сразу на этом этапе. В колонке завершающего этапа — успешные сделки за 30 дней. Фильтры: поиск (ключ, название, товар, ТН ВЭД, клиент, ИНН, контакт, телефон) и исполнитель («Мои»).

**Таблица** (`/crm/deals?view=table`): те же сделки списком с сортировкой и фильтрами «В работе / Успешные / Отказ / Все» и по этапу.

**Карточка лида** — панель справа поверх доски (`/crm/deals/BARS-12`, ссылку можно переслать): шкала этапов (клик — перевести; на телефоне это основной способ), «что хочет клиент», описание, «Сделки (заказы)» — кнопка «Создать сделку» (клиент и лид подставятся) и список сделок из лида, КП и файлы, комментарии, «Активность» — кто, когда и что изменил (было → стало). Справа — клиент и контакт (телефон кликабельный), исполнитель, срок, приоритет, метки. Поля сохраняются сами: списки и даты сразу, текст — по уходу с поля. «Отказ» закрывает сделку с причиной и убирает с доски; «Вернуть в работу» — обратно.

**Этапы** (кнопка «Этапы», только admin): как в прежней CRM — перетаскивание, номер, цветная плашка, карандаш (название и цвет из палитры), добавить, удалить (если на этапе нет сделок). Последний этап — завершающий: сделка в нём считается успешной.

**Контрагенты** — три раздела: **Клиенты** (`/crm/clients`), **Поставщики** (`/crm/suppliers`), **Подрядчики** (`/crm/contractors`, фильтр по виду: перевозчик Китай/Россия, брокер, СВХ, агент). В БД это одна таблица с ролью — реквизиты, контакты и документы у всех устроены одинаково. Карточка: вкладки «Документы» (с кнопками «+ Договор комиссии», «+ Инвойс поставщика» и т.п.), «Сделки», «Товары и цены» (для поставщика — что и почём продаёт, для клиента — что покупает), «Связи» (клиенту — его поставщики и подрядчики, поставщику — клиенты), «Реквизиты и контакты». В разделе «Клиенты» кнопка «E-mail для рассылки» копирует адреса всех клиентов из списка.

**Документы** (`/crm/documents`, кнопка «Загрузить документ» всегда в шапке): реестр с фильтрами по группе и типу, «Не оплачены», «Истекают в течение 30 дней» (договоры, доверенности, сертификаты). Экран документа — слева файл (PDF/картинка видны прямо там), справа форма: тип, сторона (новый контрагент заводится по ходу), номер, дата, договор, клиент, сделка, суммы, оплата, срок действия. Позиции инвойса вставляются из Excel или таблицы PDF через Ctrl+V: строка заголовков и «Total» пропускаются, колонки распознаются по содержимому (наименование, единица, количество, цена, сумма), валюта — по знаку ¥/$/€.

Как документы связываются сами:
- **инвойс поставщика → новая сделка**: сделка создаётся с вашим названием груза, клиентом и поставщиком, договор комиссии клиента (действующий, по схеме сделки) и контракт поставщика подставляются в сделку, инвойс привязывается к контракту, товары — в справочник;
- **документ в существующую сделку**: поставщик сделки заполняется из инвойса, подрядчик попадает в «Подрядчики» сделки, счёт перевозчика становится «инвойсом перевозчика» сделки, клиент документа — из сделки;
- **договор**: приложения (поручения, спецификации, заявки) нумеруются внутри него; при ТЭУ контракт клиента с поставщиком — это «Контракт с поставщиком» с указанным клиентом.

**Поручение на закупку**: в сделке «Сформировать поручение» → номер следующий по договору комиссии клиента (Приложение № 09 → № 10), товары из всех инвойсов поставщика в сделке («партийный номер» 1, 2, 3…), Incoterms и условия оплаты — из инвойса, смета — стандартные статьи ТЛК БАРС (пустая сумма = «Подтверждаемый расход»). Правите суммы, скачиваете DOCX — он собирается по вашему шаблону (реквизиты ООО ТЛК БАРС из «Реквизитов компании», реквизиты клиента из его карточки), подписанный скан загружаете в документ — статус «подписан». Одна сделка — одно поручение.

**План / факт** в сделке: по статьям сметы — план из поручения против факта: инвойсы поставщика (товар), счета подрядчиков (статья по виду подрядчика или выбранная в счёте), ДТ (таможенные платежи); видно, сколько оплачено. Факт больше плана подсвечивается — это разница, которую по п. 3.4 договора комиссии доплачивает клиент.

**Клиент и договор комиссии.** Загрузили договор (PDF с текстом, Word) — ИИ разбирает реквизиты клиента целиком
(банк, ОГРН, КПП, подписант, ИП / ООО): новый клиент создаётся с ними, у найденного дописываются пустые поля. В
карточке клиента — «Договор комиссии»: номер (следующий по порядку), город, дата, срок → документ-черновик с файлом
Word по шаблону; «Скачать DOCX» у договора — заново по текущим реквизитам. В форме нового клиента / поставщика /
подрядчика — «Вставить реквизиты»: текст в любом виде, ИИ раскладывает по полям. Сканы без текстового слоя ИИ пока
не разбирает — поля заполняются вручную.

**Фабрики** (`/crm/factories`): база заводов из WeChat. Кандидатов (договора нет) видит админ и тот, кто нашёл;
фабрики-поставщики — все. «Добавить фабрику»: скриншоты профиля и переписки WeChat, фото, прайсы, каталоги — ИИ
заполняет имя, WeChat ID, менеджера, анкету (10 вопросов) и цены; дубли подсвечиваются по WeChat ID, телефону,
имени. Список — карточки с фото; поиск по названию, WeChat, городу, категории, товару; фильтры: статус, поставщики,
экспортная лицензия, ВТБ Шанхай, работали с РФ. «Сделать поставщиком» — контрагент-поставщик с контактом WeChat.

**Товары — варианты и расчёт.** Товар — название без размера рулона и цвета; разные размеры/цвета — варианты
(видны в карточке). Похожие товары («… 1×25 м», «… 2×25 м») страница «Товары» предлагает объединить: позиции
документов и цены фабрик переходят к одному товару. В карточке товара: «Рассчитать для клиента» — выбрать цену
фабрики, объём, доставку (ставка из справочника или вручную), брокер, СВХ, маржу на партию → цена за единицу в
рублях с доставкой и таможней; «КП в Word» и сохранённые расчёты. Ниже — цены всех фабрик с фото и варианты.

**Ставки доставки** (`/crm/freight-rates`, кнопка на странице «Товары»): за контейнер (40HQ / 40GP / 20GP) или
сборный груз за м³ (1 м³ = N кг, минимум, сбор за отправку), срок, дни отправки. «Вставить из переписки» — текст или
скриншот сообщения перевозчика, ИИ разбирает ставки, вы проверяете и сохраняете.

**Товары** (`/crm/products`): справочник с последней закупочной ценой; карточка — у каких поставщиков и почём брали, каким клиентам и по какой цене шло в поручения/спецификации.

**Реквизиты компании** (admin, `/crm/settings`): ООО ТЛК БАРС, подписант, город, расчётные счета и какой из них ставить в поручения. `npm run crm:seed` заполняет их по вашим договорам, если пусто. Там же — «Скачать шаблон / Загрузить свой»: шаблон поручения правится в Word, поля `{{…}}` трогать нельзя.

**Роли**: `manager` создаёт и ведёт сделки, контрагентов и документы; удалить документ может его автор или admin; `admin` — ещё этапы воронки, реквизиты компании, шаблон, удаление сделок и контрагентов.

**Попробовать / показать команде**: `npm run crm:seed -- --demo` — лиды в воронке на всех этапах, 12 сделок на всех 8 этапах, из них 3 с полной цепочкой документов (комиссия: трава и LVT, ТЭУ: LED-панели), контрагенты с реквизитами, товары, сертификаты, оплаты, план/факт, страницы базы знаний; `npm run crm:seed -- --remove-demo` — убрать всё демо (настоящие данные и справочник не трогаются).

## Сделки и календарь

**Воронка продаж** (`/crm/deals`) — только для новых клиентов: заявка → расчёт → КП → «выиграли/проиграли». **Сделки** (`/crm/shipments`) — реальные заказы: начинаются, когда сформирован заказ (инвойс поставщика → поручение клиенту → ждём депозит), повторный заказ заводится сразу здесь, без воронки. Связь с лидом из воронки — необязательное поле. Всё, что не касается переговоров с клиентом, — в сделке.

Сделка называется так, как вы называете груз («Линолеум коричневый»); номер «№ 12» — вторичен. Список — два вида: **доска** по 8 этапам (карточку можно перетащить на другой этап — факты пройденных ключевых дат проставятся сегодняшним числом; назад — с подтверждением) и **таблица** с фильтрами «В работе / по этапам / Закрытые / Отменённые», «Мои».

**Карточка сделки** — вся информация на одной странице: деньги (стоимость партии, перевозка, таможенные платежи, брокер/СВХ — факт и что не оплачено; план/факт по статьям сметы), товары из инвойса поставщика с ТН ВЭД, количеством и ценами, декларации соответствия / сертификаты на эти товары (выданный на товар сертификат виден во всех сделках с ним), документы по группам (договоры, поручение с DOCX, инвойсы, счета подрядчиков, СМГС, ДТ…), «Ход сделки» — те же 8 этапов простыми словами: пройденные одной строкой (что случилось и когда, на сколько позже плана), текущий раскрыт (что происходит, что нужно сделать — оплаты, документы, номер контейнера, — чего ждём и к какой дате, кнопка «Груз погружен — сегодня» или другой датой, что будет дальше), будущие — с плановой датой; история. Справа — поля, которые правятся на месте: клиент и контакт, менеджер, схема, депозит, поставщик, перевозчик и его инвойс, подрядчики, договоры, контейнер, ТН ВЭД, вес, объём, маршрут, разрешения и «Честный знак», лид из воронки, заметки.

Этапы сделки (справочник — `shared/shipments.ts`):

| № | Этап | Ключевая дата (план / факт) | Что сделать |
|---|---|---|---|
| 1 | Заказ сформирован | оплата депозита клиентом | загрузить инвойс поставщика, сформировать поручение (кнопкой), получить подписанное поручение |
| 2 | Производство | готовность товара | — |
| 3 | Готов к отгрузке | погрузка | остаток поставщику, фрахт, номер контейнера |
| 4 | Погружен, ждёт отправки | отправка | — |
| 5 | В пути (+ отметки: граница, перегруз) | прибытие | — |
| 6 | На таможне | выпуск | таможенные платежи, документы |
| 7 | Выпущен, доставка клиенту | доставка | — |
| 8 | Доставлен | — | — |

Этап руками не выбирается: поставили факт ключевой даты — сделка перешла на следующий. Отметить погрузку нельзя без номера контейнера. Закрывается сделка вручную («Закрыть сделку»), можно отменить и вернуть в работу.

**Календарь** — третий вид на странице «Сделки» (рядом с доской и списком; старый адрес `/crm/calendar` ведёт туда) — строится из плановых дат сделок в работе и неотмеченных флажков (срок флажка — ключевая дата его этапа: остаток и фрахт — к погрузке, таможенные платежи и документы — к выпуску):
- «По неделям» — Просрочено / Нет плановой даты / Эта неделя / Следующая / Через 2–5 недель / Позже; показывается то, чего ждём сейчас, и все даты ближайших двух недель. Кнопка «Готово» / «Оплачено» — отметка сегодняшним днём;
- «Месяц» — сетка: на событии крупно действие («₽ Оплатить остаток», «Погрузка», «Выпуск»), под ним груз; события перетаскиваются на другой день;
- клик по событию — выполнено (с датой) или перенос; при переносе можно сдвинуть все следующие даты этой сделки на столько же дней (задержали поезд на 5 дней — прибытие, выпуск и доставка сдвинулись сами).

Демо: `npm run crm:seed -- --demo` добавляет 12 сделок на всех этапах с датами вокруг сегодняшнего дня. После обновления со старым демо: сначала `npm run crm:seed -- --remove-demo`, затем `--demo`.

### Расчёт для клиента: КП, поручение, таможенные платежи

Порядок: инвойс поставщика → сделка (вес и объём обязательны) → в карточке сделки блок «Расчёт для клиента»:
вводите стоимость перевозки (в любой валюте) и наши статьи → «Рассчитать» → «КП (Word)» и «Сформировать поручение».
Расчёт хранится в сделке (`shipments.calc`); перед таможней — «Пересчитать по курсу ЦБ на сегодня», рядом видно,
сколько было в поручении.

- **Таможенная стоимость** = товар + ½ перевозки, в рублях по курсу ЦБ (`server/lib/rates.ts`, XML ЦБ; кэш 3 ч).
  Делится между позициями пропорционально стоимости.
- **Пошлина** — по коду ТН ВЭД товара (код в справочнике товаров; если нет — из позиции инвойса) и ставке из
  справочника `tnved`: процент, «€/$ за кг / т / м² / шт / пар / л», «%, но не менее …» (большее), «% плюс …».
  Вес для «за кг» — вес сделки пропорционально стоимости; м², шт, пар, л — количество позиции в той же единице.
- **НДС** = (таможенная стоимость + пошлина) × 22 %, у товаров с галочкой «НДС 10 %» — 10 %.
- **Смета**: брокер по умолчанию 20 000 ₽, комиссия за валютный перевод 2,25 % от (товар + перевозка), СВХ, комиссия ТК,
  доставка до склада (примерно). В поручение уходят перевозка, брокер, СВХ, таможенные платежи, вознаграждение.
- Сбор за таможенные операции и антидемпинговые пошлины не считаются.
- Код ТН ВЭД и НДС 10 % правятся прямо в таблице расчёта — пишутся в товар и действуют во всех сделках.

Новые товары из инвойса: ИИ-разбор называет примерный код (`hsGuess`), код берёт из справочника варианты с этим
началом (≤ 40), один — подставляет, несколько — Haiku выбирает (≈ 1–2 тыс. единиц лимита); такие коды помечены
«ИИ, проверьте». Знакомые товары берут код из справочника товаров без ИИ.

### После погрузки и на таможне: упаковочный лист, спецификация для перевозчика, пакет документов

- **Упаковочный лист** (`packing_list`): ИИ разбирает строки (кол-во, места, вид мест, нетто, брутто, объём) →
  `documents.data.packing` (`shared/cargo.ts`). При сохранении можно записать в сделку фактические вес брутто и объём.
- **Спецификация для перевозчика** (блок в карточке сделки, свёрнут; `server/lib/carrier-spec.ts`): строки — ровно
  позиции упаковочного листа (места / нетто / брутто), сумма — из позиции инвойса поставщика (сопоставление по названию,
  иначе — по порядку при равном числе строк; позиция инвойса на нескольких строках листа делится по количеству). Не
  сходятся — строки по инвойсу, места и веса делятся пропорционально стоимости, с предупреждением. Нет листа — строки
  по инвойсу, места из «(52 рул.)» в названии. «Кол-во шт» — штуки для штучного товара, иначе места. Получатель,
  станция, страна, происхождение и описания RU/EN — вводятся в блоке (`shipments.spec`). Excel — по нашему шаблону
  (`templates/carrier_spec.xlsx`, 10 строк) или по шаблону перевозчика: ИИ один раз определяет адреса ячеек (значения
  пишет код, `server/lib/xlsx-fill.ts`), разметка кэшируется по SHA-1 файла в `settings` (`spec_template:…`). Файл
  сохраняется документом «Спецификация для перевозчика» (`carrier_spec`) в сделке.
- **Документ об оплате** (`payment_order`: платёжка, SWIFT) отдельным документом не сохраняется — прикрепляется файлом
  с меткой `payment` к оплаченному инвойсу / счёту (ИИ находит счёт по номеру из назначения платежа или по сумме и
  получателю) и может отметить его оплаченным. В карточке счёта — кнопка «Документ об оплате»; в блоке «Документы»
  сделки у оплаченного — «+ платёжка» / «платёжка ✓».
- **Галочки оплат** в «Ходе сделки» (остаток поставщику, фрахт, таможенные платежи) и статус оплаты документов
  согласованы (`server/lib/payments.ts`): галочка с датой оплаты и, по желанию, платёжкой → документы «Оплачен»; оплата
  документов → галочка. Новый инвойс / ДТ при уже отмеченной галочке (и без других документов этой оплаты) — сразу
  «Оплачен». Миграция 0009 согласовала старые данные.
- **Пакет для таможни** (этап «На таможне» → «Сформировать документы для таможни (ZIP)»): контракт, инвойсы поставщика,
  упаковочные листы, спецификация, счета перевозчика, транспортные накладные, сертификаты на товары сделки, экспортная
  декларация, сертификат происхождения — по папкам,
  с документами об оплате и `Опись.txt` (чего не хватает); если платёжка оплачивает и счета другой сделки или
  часть её не разнесена — ещё `Пояснение по оплатам.txt`.
- **Оплата на несколько счетов** (`payments`, `payment_allocations`): одна платёжка на два инвойса, или инвойс на
  остаток, уехавший следующим контейнером. «Оплата на несколько счетов» в блоке «Документы» сделки или «Одна
  платёжка на несколько счетов…» в форме платёжки; «Разнести автоматически» — по неоплаченным счетам получателя
  (сначала этой сделки, по дате). Обычная оплата одного счёта — как раньше.

### ИИ: разбор документов и чат

Модель — Claude (`@anthropic-ai/sdk`), по умолчанию дешёвая `claude-haiku-5-5` (`CRM_AI_MODEL`; для Opus/Sonnet
автоматически включается серверный запасной вариант `fallbacks: "default"`). Расход каждого запроса пишется в журнал
службы: `journalctl -u bars-crm | grep '"ai"'` → `usage: {input, cacheRead, output}`.
Ключ — в `crm/.env`: `ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN` (шлюз) или `ANTHROPIC_API_KEY` (напрямую). Без ключа
всё ИИ просто скрыто (`GET /ai/status` → `{enabled:false}`). Переменные окружения процесса важнее `.env` — если в systemd
задан другой `ANTHROPIC_BASE_URL`, будет использован он.

**Разбор документа** (`server/lib/ai-parse.ts`). В «Новом документе» бросили файл → `POST /ai/parse-document` (multipart).
Экономно: текст достаёт код (`server/lib/file-text.ts`: PDF — `pdfjs-dist` со строками по координатам, `.docx`/`.xlsx` —
`jszip`), модели уходит только он (~2–3 тыс. токенов); скан без текстового слоя и фото — файлом. Справочник CRM модели
не отдаём. Модель (без размышлений, effort low) переписывает документ в JSON по схеме (structured outputs): тип,
контрагент с реквизитами, номер, дата, валюта, сумма, позиции, номер договора и другие номера, контейнер, вес, Incoterms,
условия оплаты, срок действия, статья расходов, название груза, описание. **Сопоставление делает код** (`resolveDraft`):
контрагент — по ИНН, рег. номеру, названию без «Co., Ltd»/знаков (точно, затем частично, если однозначно); договор — по
номеру без пробелов и знаков; сделка в работе — контейнер → номера документов сделки → договор → единственная сделка с
этим контрагентом; проверки — сумма позиций против итога, позиции без цены, повторная загрузка того же документа
→ черновик `DocumentDraft` (`shared/ai.ts`). Форма заполняется сама; **сохраняет человек**. Если в документе
есть номер контейнера / вес, а в сделке их нет (или контейнер другой) — галочка «Записать в сделку». Ничего не
сохраняется в БД до нажатия «Сохранить»; файл документа сохраняется как обычно. Разбор — 10–30 с.

**Чат** (`server/lib/ai-chat.ts`, `web/src/components/AiChat.tsx`): кнопка «Спросить ИИ» в шапке. `POST /ai/chat`
`{messages:[{role,content}], page}` → `{reply, tools}`. Модель **только читает**: инструменты — это GET-запросы к нашему же
API от имени пользователя (`app.inject` с его cookie): поиск, сделки и карточка сделки, календарь, документы, контрагенты,
лиды, товары, база знаний, справочник для звонков. `page` — текущая страница («эта сделка»). История — в `sessionStorage`
вкладки, на сервер уходит только текст (последние 12 сообщений). Ответ — markdown со ссылками на карточки CRM.
Экономия: ответы инструментов ужаты до нужных полей (≤16 тыс. символов), не больше 6 шагов, инструкция и инструменты
кэшируются (`cache_control`).

**Расход** (шлюз списывает лимит ≈ 3,79 × цена модели в $ за токен; Haiku 5.5 — $0,10 / $0,50 за 1 млн): документ —
2–4 тыс. единиц лимита, вопрос в чате — 4–6 тыс. Для сравнения, первая версия на Opus 5.5 с файлом и справочником
целиком тратила 150–650 тыс. на документ.

Данные документов и CRM уходят во внешний сервис (шлюз → Anthropic) — так решил владелец.

### CRM: что дальше

1. **Заявки с сайта сразу в CRM** (вместо amoCRM): `server/index.ts` после приёма заявки вызывает внутренний эндпоинт `POST /crm/api/intake/lead` (только с 127.0.0.1, с общим секретом из `.env`), который находит клиента по телефону или создаёт нового, и заводит сделку на первом этапе с `source='site'`. Текущую отправку в amoCRM не трогаем, пока CRM её не заменит.
2. Несколько воронок (например, «Образцы» отдельно от «Общей»): таблица `pipelines`, `deal_statuses.pipeline_id`, `deals.pipeline_id`, переключатель воронки над доской.
3. Отчёты: конверсия по этапам, время на этапе (по `deal_events`), маржа по сделкам и товарам (план/факт уже есть).
4. Шаблоны остальных документов (спецификация к договору поставки, заявка и расчёт ТЭУ, отчёт комиссионера) — тем же способом, что поручение.
5. Уведомления в Telegram: утренняя сводка календаря (просрочено и сегодня), новые сделки, просроченные сроки, истекающие договоры и доверенности, неоплаченные инвойсы.
6. Трекинг для клиента: страница по секретной ссылке со статусом его контейнеров (этап и плановые даты из «Сделок»).
