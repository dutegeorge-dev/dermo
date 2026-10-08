#!/usr/bin/env bash
#
# Ежедневный бэкап внутреннего раздела /crm/: дамп PostgreSQL + архив вложений.
# Хранится 14 дней. Запускается cron'ом (deploy/cron/bars-crm-backup) от root.
#
#   sudo bash crm/scripts/backup.sh            # вручную
#
# Восстановление (см. crm/README.md, раздел «Бэкапы»):
#   pg_restore --clean --if-exists --no-owner -d "$DATABASE_URL" /var/backups/bars-crm/crm-ДАТА.dump
#   tar -xzf /var/backups/bars-crm/uploads-ДАТА.tar.gz -C /var/lib/bars-crm

set -euo pipefail

CRM_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_DIR="${CRM_BACKUP_DIR:-/var/backups/bars-crm}"
KEEP_DAYS="${CRM_BACKUP_KEEP_DAYS:-14}"

# DATABASE_URL и CRM_UPLOAD_DIR — из окружения или crm/.env.
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

if [ -z "$DATABASE_URL" ]; then
  echo "✗ DATABASE_URL не найден (crm/.env)" >&2
  exit 1
fi

STAMP="$(date +%F_%H%M)"
umask 077
mkdir -p "$BACKUP_DIR"

# Дамп пишем во временный файл и переименовываем только после успеха,
# чтобы оборванный бэкап не выглядел как настоящий.
pg_dump --format=custom --no-owner --file="$BACKUP_DIR/.crm-$STAMP.dump.part" "$DATABASE_URL"
mv "$BACKUP_DIR/.crm-$STAMP.dump.part" "$BACKUP_DIR/crm-$STAMP.dump"

if [ -d "$UPLOAD_DIR" ]; then
  tar -czf "$BACKUP_DIR/.uploads-$STAMP.tar.gz.part" -C "$(dirname "$UPLOAD_DIR")" "$(basename "$UPLOAD_DIR")"
  mv "$BACKUP_DIR/.uploads-$STAMP.tar.gz.part" "$BACKUP_DIR/uploads-$STAMP.tar.gz"
fi

# Ротация: удаляем всё старше KEEP_DAYS дней.
find "$BACKUP_DIR" -maxdepth 1 -type f \( -name 'crm-*.dump' -o -name 'uploads-*.tar.gz' -o -name '.*.part' \) \
  -mtime +"$((KEEP_DAYS - 1))" -delete

echo "✓ Бэкап: $BACKUP_DIR/crm-$STAMP.dump ($(du -h "$BACKUP_DIR/crm-$STAMP.dump" | cut -f1))"
