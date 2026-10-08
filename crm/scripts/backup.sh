#!/usr/bin/env bash
#
# Ежедневный бэкап внутреннего раздела /crm/: дамп PostgreSQL + архив вложений.
# Локально хранится 14 дней; если настроено облако — копия уходит туда
# (rclone: Яндекс Object Storage, Яндекс Диск, Selectel, любое S3/WebDAV).
# Запускается cron'ом (deploy/cron/bars-crm-backup) от root.
#
#   sudo bash crm/scripts/backup.sh            # вручную
#
# Настройки — в crm/.env (или в окружении):
#   DATABASE_URL                     — откуда дамп (обязательно);
#   CRM_UPLOAD_DIR                   — каталог вложений (как у сервиса);
#   CRM_BACKUP_DIR                   — куда класть локально (/var/backups/bars-crm);
#   CRM_BACKUP_KEEP_DAYS             — сколько дней хранить локально (14);
#   CRM_BACKUP_RCLONE_REMOTE         — облако, например «tlkbars-crypt:crm»; пусто — не выгружать;
#   CRM_BACKUP_CLOUD_KEEP_DAYS       — сколько дней хранить в облаке (30);
#   CRM_BACKUP_TELEGRAM_TOKEN/_CHAT  — куда написать, если бэкап не удался (необязательно).
#
# Восстановление — crm/README.md, раздел «Бэкапы».

set -euo pipefail

CRM_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Значение из окружения или из crm/.env.
env_value() {
  local key="$1"
  [ -n "${!key:-}" ] && { printf '%s' "${!key}"; return; }
  [ -f "$CRM_DIR/.env" ] || return 0
  grep -E "^(export[[:space:]]+)?${key}=" "$CRM_DIR/.env" | tail -n1 | sed -E "s/^(export[[:space:]]+)?${key}=//; s/^[\"']//; s/[\"']$//" || true
}

DATABASE_URL="$(env_value DATABASE_URL)"
UPLOAD_DIR="$(env_value CRM_UPLOAD_DIR)"
UPLOAD_DIR="${UPLOAD_DIR:-uploads}"  # как у сервиса: по умолчанию crm/uploads
case "$UPLOAD_DIR" in /*) ;; *) UPLOAD_DIR="$CRM_DIR/$UPLOAD_DIR" ;; esac
BACKUP_DIR="$(env_value CRM_BACKUP_DIR)"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/bars-crm}"
KEEP_DAYS="$(env_value CRM_BACKUP_KEEP_DAYS)"
KEEP_DAYS="${KEEP_DAYS:-14}"
REMOTE="$(env_value CRM_BACKUP_RCLONE_REMOTE)"
REMOTE="${REMOTE%/}"
CLOUD_KEEP_DAYS="$(env_value CRM_BACKUP_CLOUD_KEEP_DAYS)"
CLOUD_KEEP_DAYS="${CLOUD_KEEP_DAYS:-30}"
TG_TOKEN="$(env_value CRM_BACKUP_TELEGRAM_TOKEN)"
TG_CHAT="$(env_value CRM_BACKUP_TELEGRAM_CHAT)"

# Любая ошибка — сообщение в Telegram (если настроено): тихо сломанный бэкап хуже никакого.
STEP="подготовка"
notify_failure() {
  local code=$?
  echo "✗ Бэкап CRM не удался на шаге «$STEP» (код $code)" >&2
  if [ -n "$TG_TOKEN" ] && [ -n "$TG_CHAT" ]; then
    curl -fsS -m 15 "https://api.telegram.org/bot${TG_TOKEN}/sendMessage" \
      --data-urlencode "chat_id=${TG_CHAT}" \
      --data-urlencode "text=⚠️ tlkbars.ru: бэкап CRM не удался на шаге «${STEP}». Лог: /var/log/bars-crm-backup.log" \
      >/dev/null || true
  fi
  exit "$code"
}
trap notify_failure ERR

if [ -z "$DATABASE_URL" ]; then
  echo "✗ DATABASE_URL не найден (crm/.env)" >&2
  false
fi

STAMP="$(date +%F_%H%M)"
umask 077
mkdir -p "$BACKUP_DIR"

# Дамп пишем во временный файл и переименовываем только после успеха,
# чтобы оборванный бэкап не выглядел как настоящий.
STEP="pg_dump"
pg_dump --format=custom --no-owner --file="$BACKUP_DIR/.crm-$STAMP.dump.part" "$DATABASE_URL"
mv "$BACKUP_DIR/.crm-$STAMP.dump.part" "$BACKUP_DIR/crm-$STAMP.dump"
FILES=("crm-$STAMP.dump")

STEP="архив вложений"
if [ -d "$UPLOAD_DIR" ]; then
  tar -czf "$BACKUP_DIR/.uploads-$STAMP.tar.gz.part" -C "$(dirname "$UPLOAD_DIR")" "$(basename "$UPLOAD_DIR")"
  mv "$BACKUP_DIR/.uploads-$STAMP.tar.gz.part" "$BACKUP_DIR/uploads-$STAMP.tar.gz"
  FILES+=("uploads-$STAMP.tar.gz")
fi

STEP="ротация локальных копий"
find "$BACKUP_DIR" -maxdepth 1 -type f \( -name 'crm-*.dump' -o -name 'uploads-*.tar.gz' -o -name '.*.part' \) \
  -mtime +"$((KEEP_DAYS - 1))" -delete

echo "✓ Локально: $BACKUP_DIR/crm-$STAMP.dump ($(du -h "$BACKUP_DIR/crm-$STAMP.dump" | cut -f1))"

if [ -n "$REMOTE" ]; then
  STEP="выгрузка в облако"
  command -v rclone >/dev/null || { echo "✗ rclone не установлен (apt install rclone)" >&2; false; }
  for f in "${FILES[@]}"; do
    rclone copyto --retries 5 --low-level-retries 10 "$BACKUP_DIR/$f" "$REMOTE/$f"
  done
  # Проверяем, что дамп действительно лёг в облако и размер совпал.
  STEP="проверка облачной копии"
  local_size="$(stat -c %s "$BACKUP_DIR/crm-$STAMP.dump")"
  remote_size="$(rclone size --json "$REMOTE/crm-$STAMP.dump" | sed -E 's/.*"bytes":([0-9]+).*/\1/')"
  [ "$local_size" = "$remote_size" ] || { echo "✗ Размер в облаке ($remote_size) не совпал с локальным ($local_size)" >&2; false; }

  STEP="ротация в облаке"
  rclone delete --min-age "${CLOUD_KEEP_DAYS}d" --include 'crm-*.dump' --include 'uploads-*.tar.gz' "$REMOTE"
  echo "✓ В облаке: $REMOTE/crm-$STAMP.dump (хранение ${CLOUD_KEEP_DAYS} дн.)"
fi
