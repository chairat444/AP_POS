#!/usr/bin/env bash
# ตั้งค่า rclone → Google Drive (รันครั้งเดียวบนเครื่องที่มีเบราว์เซอร์ หรือใช้ service account)
set -euo pipefail

DRIVE_FOLDER_ID="${DRIVE_FOLDER_ID:-1mlhiJeTPZSjFKcBM-fNO3glVo_AIncf-}"
RCLONE_REMOTE="${RCLONE_REMOTE:-appos-gdrive}"
SA_JSON="${GOOGLE_SERVICE_ACCOUNT_FILE:-}"

echo "Remote name : $RCLONE_REMOTE"
echo "Folder ID   : $DRIVE_FOLDER_ID"
echo "Folder URL  : https://drive.google.com/drive/folders/${DRIVE_FOLDER_ID}"
echo

if ! command -v rclone >/dev/null; then
  echo "ติดตั้ง rclone ก่อน: curl https://rclone.org/install.sh | sudo bash"
  exit 1
fi

mkdir -p "$HOME/.config/rclone"

if [[ -n "$SA_JSON" && -f "$SA_JSON" ]]; then
  echo "ใช้ service account: $SA_JSON"
  rclone config create "$RCLONE_REMOTE" drive \
    scope=drive \
    service_account_file="$SA_JSON" \
    root_folder_id="$DRIVE_FOLDER_ID" \
    --non-interactive
else
  echo "โหมด OAuth (จะเปิดเบราว์เซอร์ให้ login Google 1 ครั้ง)"
  echo "ถ้าอยู่บน server ที่ไม่มี GUI — สร้างบน Mac แล้ว copy rclone.conf ไป server"
  echo
  rclone config create "$RCLONE_REMOTE" drive \
    scope=drive \
    root_folder_id="$DRIVE_FOLDER_ID" \
    config_is_local=false
fi

echo
echo "ทดสอบ list ไฟล์ในโฟลเดอร์:"
rclone lsd "${RCLONE_REMOTE}:" || true
rclone ls "${RCLONE_REMOTE}:" | head -20 || true
echo
echo "OK — ต่อไปรัน: ./scripts/backup/backup-db-gdrive.sh"
