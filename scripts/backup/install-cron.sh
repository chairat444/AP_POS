#!/usr/bin/env bash
# ติดตั้ง cron สำรอง DB ทุกวัน 23:00 (5 ทุ่ม)
set -euo pipefail

ROOT="${AP_POS_ROOT:-/home/pos/AP_POS}"
SCRIPT="$ROOT/scripts/backup/backup-db-gdrive.sh"
MARKER="# ap-pos-db-gdrive-backup"
BIN_PATH="${HOME}/bin:/usr/local/bin:/usr/bin:/bin"

chmod +x "$SCRIPT" "$ROOT/scripts/backup/setup-rclone-gdrive.sh" 2>/dev/null || true

if [[ ! -x "$SCRIPT" ]]; then
  echo "missing $SCRIPT"
  exit 1
fi

{
  echo "PATH=$BIN_PATH"
  crontab -l 2>/dev/null | grep -v "$MARKER" | grep -v '^PATH=' || true
  echo "0 23 * * * $SCRIPT $MARKER"
} | crontab -

echo "crontab installed:"
crontab -l
echo
echo "timezone check (ควรเป็น Asia/Bangkok):"
date
timedatectl 2>/dev/null | grep -i 'time zone' || true
