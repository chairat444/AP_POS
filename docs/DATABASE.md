# Database Connections

## PostgreSQL (API / ส่วนกลาง)

- Host: `localhost`
- Port: `5432`
- Database: `ap_pos`
- User: `appleclub` (macOS Homebrew default; ไม่มีรหัสผ่านในเครื่องนี้)
- URL: `postgresql://appleclub@localhost:5432/ap_pos`

### ดูข้อมูลด้วย psql

```bash
export PATH="/opt/homebrew/opt/postgresql@16/bin:$PATH"
psql -d ap_pos
```

คำสั่งที่ใช้บ่อยใน `psql`:

```sql
\dt
SELECT * FROM products LIMIT 20;
SELECT * FROM customers;
SELECT * FROM sales ORDER BY created_at DESC LIMIT 20;
SELECT * FROM point_ledger ORDER BY created_at DESC LIMIT 20;
SELECT * FROM branches;
```

### ดูด้วย Drizzle Studio

```bash
export DATABASE_URL=postgresql://appleclub@localhost:5432/ap_pos
pnpm db:studio:pg
```

### ดูด้วย GUI (แนะนำ)

- TablePlus / Postico / DBeaver / pgAdmin
- ใส่ connection ตามค่าด้านบน

---

## SQLite (POS / เครื่องสาขา)

ไฟล์ถูกสร้างอัตโนมัติตอนเปิดแอป Electron ที่:

```text
~/Library/Application Support/@ap-pos/pos/db/ap-pos-local.sqlite
```

(บน Windows จะอยู่ใต้ `%APPDATA%/@ap-pos/pos/db/ap-pos-local.sqlite`)

หมายเหตุ: POS ใช้ `sql.js` (SQLite ใน WASM) เพื่อเลี่ยง native crash บน Electron แต่ไฟล์บนดิสก์ยังเป็น SQLite มาตรฐาน เปิดดูด้วยเครื่องมือทั่วไปได้

### ดู path จริงจากแอป

เปิด DevTools ในหน้าแคชเชียร์ แล้วรัน:

```js
await window.apPos.db.path()
```

### ดูข้อมูลด้วย sqlite3 CLI

```bash
sqlite3 "$HOME/Library/Application Support/@ap-pos/pos/db/ap-pos-local.sqlite"
```

คำสั่งที่ใช้บ่อย:

```sql
.tables
SELECT * FROM products LIMIT 20;
SELECT * FROM customers;
SELECT * FROM sales ORDER BY created_at DESC LIMIT 20;
SELECT * FROM sync_outbox;
SELECT * FROM meta;
```

### ดูด้วย GUI

- TablePlus / DB Browser for SQLite / DBeaver
- เปิดไฟล์ `.sqlite` ตาม path ด้านบน

---

## เริ่มบริการ

```bash
# Postgres (ถ้ายังไม่รัน)
brew services start postgresql@16

# API + POS
pnpm --filter @ap-pos/db build
pnpm dev:api
pnpm dev:pos
```
