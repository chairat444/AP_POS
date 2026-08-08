# Offline seed (ติดไปกับ Setup)

แพ็กเข้า installer ที่ `extraResources/seed/`:
- `offline-snapshot.json` — สินค้า / สมาชิก / พนักงาน / ตั้งค่า
- `media/` + `media-index.json` — ไฟล์รูปสินค้า / โลโก้ / โฆษณา

เครื่องขายเปิดครั้งแรกจะโหลดข้อมูล + คัดลอกรูปลง media-cache อัตโนมัติ

> ไฟล์เหล่านี้ถูก gitignore — มี PIN / ข้อมูลสมาชิก / รูปจริง อย่า commit

## อัปเดตก่อนสร้าง Setup

```bash
API_BASE=http://localhost:3000 pnpm --filter @ap-pos/pos seed:export
pnpm dist:pos:win   # หรือ dist:pos:mac
```
