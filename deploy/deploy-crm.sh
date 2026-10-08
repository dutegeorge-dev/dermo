#!/usr/bin/env bash
#
# Обновление только внутреннего раздела /crm/ — без пересборки сайта:
#   sudo bash deploy/deploy-crm.sh
#
# Что делает:
#   1. фиксирует несохранённые правки CMS (как deploy.sh — чтобы не потерять их);
#   2. тянет код с GitHub (main) поверх локальных правок CMS;
#   3. ставит зависимости crm/, собирает фронтенд, применяет миграции БД;
#   4. возвращает владельца www-data и перезапускает службу bars-crm;
#   5. проверяет, что сервис ответил.
#
# Сайт (_site) и обработчик заявок (bars-lead) не трогаются. Если в этом
# обновлении менялись шаблоны сайта или server/ — запускайте обычный deploy.sh.
# Первая установка раздела — по crm/README.md («Деплой → Первый раз»).

set -euo pipefail

REPO=/var/www/tlkbars/repo
cd "$REPO"

if ! systemctl list-unit-files bars-crm.service --no-legend 2>/dev/null | grep -q bars-crm; then
  echo "✗ Служба bars-crm не установлена — сначала первая установка (crm/README.md)." >&2
  exit 1
fi

echo "→ 1/5 фиксируем возможные несохранённые правки CMS"
git add -A
git commit -m "cms: авто-фиксация перед деплоем" || true

echo "→ 2/5 тянем код с GitHub (контент CMS при конфликте — серверный)"
git fetch origin main
git rebase --empty=drop -X theirs origin/main

echo "→ 3/5 зависимости, сборка фронтенда, миграции"
npm --prefix crm ci
npm --prefix crm run build
npm --prefix crm run db:migrate

echo "→ 4/5 владелец www-data и перезапуск bars-crm"
chown -R www-data:www-data "$REPO"
systemctl restart bars-crm

echo "→ 5/5 проверка"
for _ in $(seq 1 20); do
  if curl -fsS http://127.0.0.1:3100/crm/api/health >/dev/null 2>&1; then
    echo "✓ /crm/ обновлён и отвечает."
    exit 0
  fi
  sleep 1
done
echo "✗ bars-crm не ответил за 20 секунд. Логи: journalctl -u bars-crm -n 50" >&2
exit 1
