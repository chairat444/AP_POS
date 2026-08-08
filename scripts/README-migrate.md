# Migrate POS_AP → AP POS

สคริปต์: `scripts/migrate_pos_ap.py`

- อ่านอย่างเดียวจาก SQL Server
- เขียนเฉพาะ Postgres ของ AP POS
- ค่าเริ่มต้นเป็น dry-run

## เตรียม

```bash
cd /Users/appleclub/Documents/GitHub/AP_POS
python3 -m venv .venv-migrate
.venv-migrate/bin/pip install 'psycopg[binary]' pymssql
```

## Dry-run (เจ็ดเสมียน → 002)

```bash
export MSSQL_PASSWORD='***'
.venv-migrate/bin/python scripts/migrate_pos_ap.py \
  --branch-code 002 \
  --branch-name 'สาขาเจ็ดเสมียน' \
  --dry-run
```

## Apply จริง

```bash
export MSSQL_PASSWORD='***'
.venv-migrate/bin/python scripts/migrate_pos_ap.py \
  --branch-code 002 \
  --branch-name 'สาขาเจ็ดเสมียน' \
  --apply
```

## เฉพาะยอดขาย (เคลียร์แล้วดึงใหม่ — ไม่แตะสินค้า/ลูกค้า/พนักงาน)

```bash
export MSSQL_PASSWORD='***'
.venv-migrate/bin/python scripts/migrate_pos_ap.py \
  --branch-code 002 \
  --branch-name 'สาขาเจ็ดเสมียน' \
  --sales-only \
  --apply
```

โหมดนี้จะ:
- ลบ `sales` / `sale_lines` / `sale_payments` และ `point_ledger` ที่ผูกบิล ของสาขานั้น
- ดึงบิลขายจาก SQL Server ใส่ใหม่
- **ไม่** เขียนทับสินค้า หน่วย ลูกค้า พนักงาน

## Env อื่นๆ

| ตัวแปร | ค่าเริ่มต้น |
|--------|-------------|
| `MSSQL_HOST` | `192.168.1.104` |
| `MSSQL_PORT` | `1433` |
| `MSSQL_USER` | `sa` |
| `MSSQL_DB` | `POS_AP` |
| `DATABASE_URL` | `postgresql://appleclub@localhost:5432/ap_pos` |

## ลูกค้า / แต้มข้ามสาขา

**ลำดับ migrate:** เจ็ดเสมียน (002) ก่อน → หลุมดิน (001) ทีหลัง

ตอนย้ายหลุมดิน: เทียบเบอร์กับลูกค้าที่มีใน Postgres แล้ว
- เบอร์ตรง → คนเดิม · ถ้าวันซื้อล่าสุดของหลุมดินใหม่กว่า → อัปเดตแต้มเป็น snapshot หลุมดิน · ถ้าเก่ากว่า → คงแต้มจากเจ็ดเสมียน
- เบอร์ไม่ตรง / ไม่มีเบอร์ → สร้างลูกค้าใหม่

**คีย์หลักในการเทียบคน = เบอร์โทร** (normalize: ตัดช่องว่าง/ขีด, รูปแบบเดียวกัน)

| กรณี | การทำ |
|------|--------|
| เบอร์เดียวกันใน 2 สาขา | คนเดียวกัน · **แต้มเอาจากสาขาที่ซื้อล่าสุด** (ไม่รวมแต้ม) |
| รหัส `C-…` ซ้ำแต่เบอร์คนละเบอร์ | คนละคน · เก็บแยก (อ้างอิงรหัสเดิมใน note/legacy code ได้) |
| มีเบอร์แค่สาขาเดียว | ใช้ snapshot/ประวัติของสาขานั้น |

สมมติฐาน: ลูกค้าซื้อข้ามสาขาน้อยมาก — แต้มสาขาที่ไม่ใช่ล่าสุดถือว่าไม่ใช้ (ทิ้ง snapshot นั้นตอน merge)

อย่าใช้ `XVCstCode` เป็นคีย์รวมข้ามสาขา — แต่ละสาขารันเลขเอง ซ้ำได้แต่คนละคน

## กฎที่ใส่ไว้แล้ว

- สาขาบังคับจาก `--branch-code` (ไม่ใช้ชื่อใน TComMBranch)
- ขาย = หลัก + temp ที่ยังไม่มีในหลัก
- สินค้าเฉพาะที่เคยขาย · ตัดบาร์ราคา 1–100 · สร้าง 1 สินค้าเบ็ดเตล็ด `isOpenPrice`
- สินค้าด่วนจาก `TPdtMTchGroupPdt`
- แต้มจาก `TCstTCstPoint`
- พนักงานได้ PIN ใหม่ (พิมพ์ตอน apply) — ไม่ย้ายรหัสเก่า

## หลุมดิน (ภายหลัง)

ชี้ `MSSQL_HOST` / `MSSQL_DB` ไป DB หลุมดิน แล้วรัน:

```bash
--branch-code 001 --branch-name 'สาขาหลุมดิน' --apply
```
