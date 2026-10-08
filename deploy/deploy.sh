#!/usr/bin/env bash
#
# Деплой ТЛК БАРС одной командой:
#   sudo bash deploy/deploy.sh
#
# Что делает:
#   1. фиксирует несохранённые правки CMS (на всякий случай);
#   2. тянет код с GitHub и накладывает поверх локальные правки;
#      при конфликте по контенту оставляет СЕРВЕРНУЮ версию (её правит только CMS),
#      код при этом берётся с GitHub — ручной разбор конфликтов не нужен;
#   3. пересобирает сайт;
#   4. возвращает владельца www-data (иначе CMS не сможет писать файлы);
#   5. перезапускает обработчик (подхватить возможные правки server/);
#   6. обновляет внутренний раздел /crm/ (crm/): зависимости, сборка фронтенда,
#      миграции БД, перезапуск службы bars-crm — только если она установлена.
#
# Почему конфликты не всплывают: флаг «-X theirs» при rebase форсит серверную
# версию для любых пересечений. Работает при простом уговоре: код (шаблоны, i18n,
# server, стили) правится на GitHub, а контент (src/blog, src/kejsy, photos/*.json,
# uploads) — только через CMS. Тогда пересекается лишь контент, и его источник —
# сервер.

set -euo pipefail

REPO=/var/www/tlkbars/repo
cd "$REPO"

echo "→ 1/6 фиксируем возможные несохранённые правки CMS"
git add -A
git commit -m "cms: авто-фиксация перед деплоем" || true

echo "→ 2/6 тянем код с GitHub (контент CMS при конфликте — серверный)"
# --empty=drop: коммиты CMS, которые после наложения стали пустыми, отбрасываем
# без паузы. -X theirs: любые пересечения по контенту решаем в пользу сервера.
git fetch origin main
git rebase --empty=drop -X theirs origin/main

echo "→ 3/6 пересборка сайта"
npm run build

echo "→ 4/6 возвращаем владельца www-data"
chown -R www-data:www-data "$REPO"

echo "→ 5/6 перезапуск обработчика"
systemctl restart bars-lead

# Внутренний раздел /crm/: до первой установки службы (см. crm/README.md) шаг пропускается.
if systemctl list-unit-files bars-crm.service --no-legend 2>/dev/null | grep -q bars-crm; then
  echo "→ 6/6 внутренний раздел /crm/"
  npm --prefix crm ci
  npm --prefix crm run build
  npm --prefix crm run db:migrate
  chown -R www-data:www-data "$REPO"
  systemctl restart bars-crm
else
  echo "→ 6/6 служба bars-crm не установлена — /crm/ пропускаем"
fi

echo "✓ Деплой завершён."
