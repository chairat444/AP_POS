#!/usr/bin/env bash
# สำรอง Postgres AP POS → Google Drive ทุกวัน (ค่าเริ่มต้น 23:00 / 5 ทุ่ม)
# Folder: https://drive.google.com/drive/folders/1mlhiJeTPZSjFKcBM-fNO3glVo_AIncf-
set -euo pipefail

ROOT="${AP_POS_ROOT:-/home/pos/AP_POS}"
ENV_FILE="${AP_POS_ENV:-$ROOT/apps/api/.env}"
BACKUP_DIR="${BACKUP_DIR:-/home/pos/backups/daily}"
LOG_DIR="${BACKUP_LOG_DIR:-/home/pos/backups}"
KEEP_LOCAL_DAYS="${KEEP_LOCAL_DAYS:-7}"
KEEP_DRIVE_DAYS="${KEEP_DRIVE_DAYS:-30}"
RCLONE_REMOTE="${RCLONE_REMOTE:-appos-gdrive}"
DRIVE_FOLDER_ID="${DRIVE_FOLDER_ID:-1mlhiJeTPZSjFKcBM-fNO3glVo_AIncf-}"
STAMP="$(TZ=Asia/Bangkok date +%Y%m%d-%H%M%S)"
HOST="$(hostname -s 2>/dev/null || hostname)"
OUT_NAME="ap_pos-${HOST}-${STAMP}.dump"
OUT_PATH="$BACKUP_DIR/$OUT_NAME"
LOG_FILE="$LOG_DIR/backup-gdrive.log"

mkdir -p "$BACKUP_DIR" "$LOG_DIR"
exec >>"$LOG_FILE" 2>&1

log() { printf '%s %s\n' "$(TZ=Asia/Bangkok date '+%Y-%m-%d %H:%M:%S %Z')" "$*"; }

log "=== backup start ==="

if [[ ! -f "$ENV_FILE" ]]; then
  log "ERROR: missing env $ENV_FILE"
  exit 1
fi

# อ่าน DATABASE_URL โดยไม่ echo ค่า
DATABASE_URL="$(
  grep -E '^DATABASE_URL=' "$ENV_FILE" | head -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//"
)"
if [[ -z "${DATABASE_URL:-}" ]]; then
  log "ERROR: DATABASE_URL empty"
  exit 1
fi

if ! command -v pg_dump >/dev/null; then
  log "ERROR: pg_dump not found"
  exit 1
fi
if ! command -v rclone >/dev/null; then
  log "ERROR: rclone not found — ติดตั้งแล้วตั้งค่าตาม scripts/backup/README.md"
  exit 1
fi

if ! rclone listremotes 2>/dev/null | grep -qx "${RCLONE_REMOTE}:"; then
  log "ERROR: rclone remote '${RCLONE_REMOTE}:' ยังไม่มี — ตั้งค่าตาม scripts/backup/README.md"
  exit 1
fi

log "dump → $OUT_PATH"
# custom format (บีบอัดในตัว) — restore ด้วย pg_restore
pg_dump --dbname="$DATABASE_URL" -Fc --no-owner --no-acl -f "$OUT_PATH"
SIZE="$(du -h "$OUT_PATH" | awk '{print $1}')"
log "dump ok size=$SIZE"

log "upload → Drive folder $DRIVE_FOLDER_ID (${RCLONE_REMOTE}:/$OUT_NAME)"
rclone copy "$OUT_PATH" "${RCLONE_REMOTE}:" \
  --checksum \
  --retries 5 \
  --low-level-retries 10

log "verify remote"
rclone lsl "${RCLONE_REMOTE}:$OUT_NAME" >/dev/null

STATUS_JSON="${STATUS_JSON:-$LOG_DIR/last-backup.json}"
cat >"$STATUS_JSON" <<JSON
{
  "ok": true,
  "at": "$(TZ=Asia/Bangkok date -Iseconds)",
  "file": "$OUT_NAME",
  "size": "$SIZE",
  "path": "$OUT_PATH",
  "trigger": "${BACKUP_TRIGGER:-cron}"
}
JSON

log "prune local >${KEEP_LOCAL_DAYS}d"
find "$BACKUP_DIR" -type f -name 'ap_pos-*.dump' -mtime "+$KEEP_LOCAL_DAYS" -print -delete || true

log "prune drive >${KEEP_DRIVE_DAYS}d"
rclone delete "${RCLONE_REMOTE}:" \
  --include 'ap_pos-*.dump' \
  --min-age "${KEEP_DRIVE_DAYS}d" \
  --rmdirs || true

log "=== backup done ==="
