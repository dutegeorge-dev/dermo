# Внутренний раздел tlkbars.ru/crm/

Закрытый раздел для сотрудников ООО ТЛК БАРС: **база знаний** (как Confluence) и, на следующем этапе, **CRM** (как Jira). Интерфейс на русском, вход по личному логину и паролю.

- Адрес: `https://tlkbars.ru/crm/` (SPA), API — `https://tlkbars.ru/crm/api/`.
- Этап 1 (сделан): каркас, вход, пользователи и роли, журнал действий, база знаний, справочник для звонков.
- Этап 2 (заложен): клиенты, сделки `BARS-N`, канбан-доска — таблицы уже в БД, интерфейса пока нет (см. [план](#этап-2--crm)).

Публичный сайт (11ty) и его обработчик заявок (`server/`, amoCRM) раздел не затрагивает: это отдельный пакет со своими зависимостями и отдельной службой.

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
- [Этап 2 — CRM](#этап-2--crm)

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
  scripts/backup.sh     бэкап БД и вложений (cron)
  server/
    index.ts            точка входа службы
    app.ts              Fastify: API под /crm/api, SPA под /crm/
    config.ts           настройки из окружения / crm/.env
    db/schema.ts        схема БД (этап 1 + таблицы этапа 2)
    lib/                сессии, пароли, CSRF, журнал, лимиты, поиск
    routes/             auth, users, kb, files, calls, search, audit
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
sudo chown www-data:www-data crm/.env && sudo chmod 600 crm/.env

# 4. Сборка, миграции, первый админ, данные
npm run crm:build
npm run crm:migrate
npm run crm:create-admin -- --login admin --name "Имя Фамилия"
npm run crm:seed
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

# 7. Бэкапы
sudo cp deploy/cron/bars-crm-backup /etc/cron.d/bars-crm-backup
sudo chmod 644 /etc/cron.d/bars-crm-backup
sudo bash crm/scripts/backup.sh                   # проверить вручную

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
    proxy_send_timeout   120s;
    proxy_read_timeout   120s;
    proxy_hide_header X-Robots-Tag;
    add_header X-Robots-Tag "noindex, nofollow" always;
}
```

### Обновления

`sudo bash deploy/deploy.sh` — после сборки сайта скрипт сам ставит зависимости `crm/`, собирает фронтенд, применяет миграции и перезапускает `bars-crm` (если служба установлена; до установки этот шаг пропускается).

### Проверка после деплоя

```bash
curl -sI https://tlkbars.ru/crm/ | grep -i x-robots       # noindex, nofollow
curl -s  https://tlkbars.ru/crm/api/kb/spaces              # {"error":"Требуется вход"} (401)
curl -s  https://tlkbars.ru/robots.txt | grep crm          # Disallow: /crm/
```

## Бэкапы

- `crm/scripts/backup.sh` — `pg_dump` в формате custom + архив каталога вложений, в `/var/backups/bars-crm/`, хранение 14 дней (`CRM_BACKUP_DIR`, `CRM_BACKUP_KEEP_DAYS` меняют путь и срок).
- `/etc/cron.d/bars-crm-backup` — каждый день в 00:40 по времени сервера (03:40 МСК при UTC), лог — `/var/log/bars-crm-backup.log`.
- Бэкапы лежат на том же сервере — периодически копируйте `/var/backups/bars-crm` наружу (rsync/облако).

Восстановление:

```bash
sudo systemctl stop bars-crm
pg_restore --clean --if-exists --no-owner -d "postgres://crm:<пароль>@127.0.0.1/crm" /var/backups/bars-crm/crm-2026-10-08_0040.dump
sudo tar -xzf /var/backups/bars-crm/uploads-2026-10-08_0040.tar.gz -C /var/lib/bars-crm
sudo chown -R www-data:www-data /var/lib/bars-crm
sudo systemctl start bars-crm
```

## Безопасность

- **Учётки личные**, общего пароля нет. Первый админ — `crm:create-admin`, остальных заводит админ в «Пользователи». Удаления нет — только отключение: авторство правок и журнал сохраняются.
- **Роли**: `admin` — всё, плюс пользователи и журнал действий, удаление пространств; `manager` — читает всё, редактирует базу знаний и справочник (на этапе 2 — сделки).
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
| `attachments` | Файлы: `owner_type` (`kb_page`, на этапе 2 — `deal`) + `owner_id`, имя, MIME, размер, `storage_key` (путь в `CRM_UPLOAD_DIR`) |
| `call_script_topics` | Строки справочника: `id`, `position`, `title`, `ask` (jsonb string[]), `qa` (jsonb [{q, a}]), `search_text` + `search` (tsvector) |
| `call_script_versions` | Снимок всего справочника на каждое сохранение: `version`, `topics` (jsonb), `note`, автор |

### Этап 2 (таблицы созданы, интерфейса нет)

| Таблица | Назначение |
|---|---|
| `clients` | Компания: `kind` (`ip`/`ooo`/`other`), `name`, `inn`, `notes` |
| `contacts` | Контакты компании: `name`, `phone`, `messenger` (`telegram`/`whatsapp`/`max`/`wechat`/`other`) + `messenger_handle`, `email`, `position`, `is_primary` |
| `deal_statuses` | Колонки доски (заполнены миграцией): Новый лид → Квалификация → Расчёт отправлен → Договор → Оплата поставщику / выкуп → В пути → Таможня → Доставлено → Закрыто |
| `deals` | Сделка, ключ `key` = `BARS-` + `number` (последовательность `deal_number_seq`), все поля ниже |
| `deal_comments` | Комментарии: `deal_id`, `author_id`, `body` |
| `deal_events` | Журнал изменений сделки: `kind` (created, field_changed, status_changed, comment_added…), `field`, `old_value`, `new_value`, кто, когда |

Поля `deals`:

| Поле | Тип / значения |
|---|---|
| `title`, `client_id`, `contact_id` | название, клиент, контакт |
| `status_key`, `outcome` | статус-колонка; итог `won`/`lost` — обязателен только для «Закрыто» (CHECK) |
| `product`, `hs_code` | товар, код ТН ВЭД |
| `weight_kg`, `volume_m3` | вес, объём (numeric) |
| `pickup_location`, `delivery_location` | место забора в Китае, доставки в России |
| `goods_ready_date` | срок готовности товара |
| `route` | `auto` / `rail` / `air` / `sea` / `multimodal` |
| `contract_party` | `ours` / `client` |
| `export_license` | `yes` / `no` / `we_arrange` (оформляем сами) |
| `certificates`, `certificate_holder` | `yes` / `no` / `in_progress` + на кого |
| `chestny_znak` | `not_required` / `required` / `applied` |
| `assignee_id`, `due_date`, `priority`, `labels` | исполнитель, срок, `low`…`urgent`, метки (text[]) |
| `description` | TipTap JSON (тот же редактор, что в базе знаний) |
| `board_position` | порядок карточки в колонке |
| `source` | `manual` / `site` (заявки с сайта) |
| вложения | `attachments` с `owner_type = 'deal'` |

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
| `GET /search?q=` | Глобальный поиск: страницы + справочник, сниппеты с `<mark>` |
| `GET /audit?before=&userId=&entityType=` | Журнал действий (admin) |

## Справочник для звонков

Один список в порядке разговора. Строка — вопросы менеджера клиенту (`ask`, первый крупнее, справа мелко — тема `title`; если `ask` пуст — строкой служит `title`). Раскрыть строку → «Если клиент спрашивает:» и вопросы клиента; клик по вопросу → ответ и «Копировать» (копирует ровно как набрано). Формат ответа: пустая строка — абзац, «— » — пункт списка, «1. » — нумерованный пункт.

Поиск — по строкам, темам, вопросам и ответам, все слова запроса, без учёта регистра и ё/е, с подсветкой; совпадение в ответе раскрывает строку и вопрос. «Редактировать» включает правку: изменить строку, добавить, удалить (с подтверждением), переставить (стрелками или перетаскиванием; новый порядок сохраняется одной версией). Каждое сохранение — новая версия в «истории версий» с просмотром и откатом.

### Импорт

`npm run crm:seed` читает `crm/seed/kb-call-script.json` (`{ "topics": [ { "id", "order", "title", "ask": [], "qa": [ { "q", "a" } ] } ] }`) и создаёт пространства «Продажи», «Таможня», «Логистика», «Компания», если их нет.

- Без флагов — добавляет только темы, которых ещё нет (по `id`), на их место по `order`. Правки, сделанные в интерфейсе, повторный запуск не трогает.
- `--force` — темы из файла перезаписывают одноимённые и встают в порядке файла; темы, созданные в интерфейсе, остаются после них.
- Любое изменение — новая версия в истории («Импорт из kb-call-script.json»), так что импорт можно откатить.

## Этап 2 — CRM

Схема уже в БД (см. выше), в сайдбаре есть неактивный пункт «Сделки · скоро», маршрут `/crm/deals` занят заглушкой. Что добавить:

1. **API** `routes/deals.ts`, `routes/clients.ts`:
   - `GET /deals?status=&assignee=&client=&label=&q=&due_before=` (таблица с фильтрами), `GET /deals/board` (сделки по колонкам), `POST /deals`, `GET/PATCH /deals/:key` (по `BARS-123`), `POST /deals/:key/move` `{statusKey, outcome?, beforeId?}` — перенос на доске с пересчётом `board_position`;
   - `GET/POST /deals/:key/comments`, `GET /deals/:key/events`, вложения — через существующий `attachments` с `owner_type='deal'`;
   - `PATCH` пишет в `deal_events` каждое изменённое поле (old/new) и в `audit_log`; смена статуса — `status_changed`; перевод в «Закрыто» требует `outcome` (CHECK в БД) и ставит `closed_at`;
   - `GET/POST/PATCH /clients`, контакты, история сделок клиента (`deals.client_id`), поиск по ИНН и телефону;
   - `manager` редактирует сделки, `admin` — ещё и справочники статусов/меток.
2. **Экраны** `web/src/pages/deals/`:
   - доска: колонки из `deal_statuses`, карточка — ключ, название, клиент, исполнитель, срок (просрочка — красным); перетаскивание между колонками тем же подходом, что дерево страниц; «Закрыто» спрашивает итог;
   - боковая панель по клику на карточку (`/crm/deals/BARS-123` поверх доски): все поля сделки группами («Груз», «Маршрут», «Документы и разрешения», «Работа»), описание в TipTap, вложения, комментарии, вкладка «Активность» из `deal_events`;
   - табличный вид с фильтрами (статус, исполнитель, клиент, метки, срок) и сортировкой;
   - клиенты: список, карточка компании с контактами и историей сделок.
3. **Поиск**: добавить сделки (по ключу `BARS-…`, названию, товару, ТН ВЭД) и клиентов (название, ИНН, телефон) в `GET /search`.
4. **Заявки с сайта → CRM** (позже, вместо внешней CRM): `server/index.ts` после приёма заявки дополнительно вызывает внутренний эндпоинт `POST /crm/api/intake/lead` (только с 127.0.0.1, с общим секретом из `.env`), который создаёт клиента/контакт и сделку со статусом «Новый лид» и `source='site'`. Текущую отправку заявок не менять, пока CRM не заменит её полностью.
