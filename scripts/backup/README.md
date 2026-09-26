# Backup Postgres → Google Drive

อัปโหลด dump รายวันไปโฟลเดอร์
[AP POS backups on Drive](https://drive.google.com/drive/folders/1mlhiJeTPZSjFKcBM-fNO3glVo_AIncf-)

| รายการ | ค่า |
|--------|-----|
| เวลา | **ทุกวัน 23:00** (5 ทุ่ม, Asia/Bangkok) |
| ไฟล์ | `ap_pos-<host>-YYYYMMDD-HHMMSS.dump` (`pg_dump -Fc`) |
| เก็บ local | 7 วัน (`/home/pos/backups/daily`) |
| เก็บ Drive | 30 วัน |
| log | `/home/pos/backups/backup-gdrive.log` |

สถานะบน server แล้ว: สคริปต์ + rclone + cron 23:00  
**ค้าง:** เชื่อม Google Drive ครั้งเดียว (ดูด้านล่าง)

## Manual จาก Admin

หลัง deploy API/Admin แล้ว: เมนู **ตั้งค่า → สำรอง DB** → ปุ่ม **สำรอง DB ขึ้น Drive ตอนนี้**  
API: `GET /backup/status` · `POST /backup/run` (เฉพาะ admin/manager)

## เชื่อม Google Drive (ทำครั้งเดียว)

### แนะนำ: Service Account

> **หมายเหตุ:** Service Account **อัปโหลดเข้า My Drive ส่วนตัวไม่ได้** (error `storageQuotaExceeded`)  
> ใช้ได้เมื่อโฟลเดอร์อยู่ใน **Shared Drive (Team Drive)** ของ Google Workspace  
> ถ้าใช้ Drive ส่วนตัว/Gmail → ใช้ **ทางเลือก OAuth** ด้านล่างแทน

1. เปิด [Google Cloud Console](https://console.cloud.google.com/) → สร้างโปรเจกต์ (หรือใช้ของเดิม)
2. เปิด **APIs & Services → Enable Google Drive API**
3. **IAM → Service accounts → Create** → สร้างคีย์ประเภท JSON
4. เปิดโฟลเดอร์ใน **Shared Drive** → Share ให้ email ของ service account สิทธิ์ **Content manager / Editor**
   (รูปแบบประมาณ `appos-backup@….iam.gserviceaccount.com`)
5. คัดลอกไฟล์ JSON ไป server:

```bash
scp -P 8122 ./appos-gdrive-sa.json \
  pos@pos.chinthurakij.com:~/.config/rclone/appos-gdrive-sa.json

ssh -p 8122 pos@pos.chinthurakij.com 'chmod 600 ~/.config/rclone/appos-gdrive-sa.json'
```

6. ตั้งค่า rclone บน server:

```bash
ssh -p 8122 pos@pos.chinthurakij.com
export PATH="$HOME/bin:$PATH"
export GOOGLE_SERVICE_ACCOUNT_FILE=$HOME/.config/rclone/appos-gdrive-sa.json
bash /home/pos/AP_POS/scripts/backup/setup-rclone-gdrive.sh
```

7. ทดสอบ:

```bash
bash /home/pos/AP_POS/scripts/backup/backup-db-gdrive.sh
tail -30 /home/pos/backups/backup-gdrive.log
rclone ls appos-gdrive:
```

### ทางเลือก: OAuth บน Mac แล้ว copy config (แนะนำถ้าเป็น Drive ส่วนตัว)

```bash
brew install rclone
bash scripts/backup/setup-rclone-gdrive.sh   # login ในเบราว์เซอร์

scp -P 8122 ~/.config/rclone/rclone.conf \
  pos@pos.chinthurakij.com:~/.config/rclone/rclone.conf
```

## Restore (ระวัง — อย่าทับ production โดยไม่ตั้งใจ)

```bash
pg_restore --dbname="$DATABASE_URL" --clean --if-exists /path/to/ap_pos-....dump
```

ใช้กับ DB ว่าง/staging ก่อนเสมอ
