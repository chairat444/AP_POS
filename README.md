# AP หมูสด POS (`ap-pos`)

ระบบ POS แบบ offline-first สำหรับร้านหมูสด — Windows Electron + Vue 3 + NestJS

## Stack

| ส่วน | เทคโนโลยี |
|------|-----------|
| แอปแคชเชียร์ | Electron + Vue 3 + Pinia + Vite |
| API sync | NestJS |
| DB เครื่อง | SQLite (Drizzle schema ใน `packages/db`) |
| DB คลาวด์ | PostgreSQL (Drizzle schema) |
| Logic ร่วม | `@ap-pos/shared` (บาร์โค้ดราคา, แต้ม, ตะกร้า) |

## เริ่มต้น

```bash
pnpm install
pnpm --filter @ap-pos/shared build
pnpm --filter @ap-pos/db build

# API (พอร์ต 3000)
pnpm dev:api

# แอป POS (เปิดจอแคชเชียร์ + จอลูกค้า)
pnpm dev:pos
```

## ทดสอบบาร์โค้ดราคา

รูปแบบ `99` + รหัสสินค้า 5 หลัก + ราคา 5 หลัก (สตางค์) + check digit

ตัวอย่าง: สินค้า `00003` (ซี่โครง) ราคา `78.00` → `9900003078000`

ในหน้าแคชเชียร์:
- สแกน/พิมพ์บาร์โค้ดแล้ว Enter
- กดสินค้าด่วนที่มีราคาได้เลย
- สินค้าที่ราคา `null` ต้องใช้บาร์โค้ดราคา
- พิมพ์ราคา `55` แล้ว Enter = **สินค้าเบ็ดเตล็ด 55 บาท** (ไม่เกิน 100)
- `*` แล้วใส่จำนวน = คูณรายการล่าสุด
- `F3` ยกเลิกรายการล่าสุด / `Esc` ยกเลิกบิล / `F12` ชำระเงิน

## หลังบ้านสินค้า (API)

ข้อมูลสินค้า + รูป เก็บที่ NestJS (เตรียมไว้ให้ต่อหน้า admin)

```bash
GET    /products
POST   /products
PATCH  /products/:id
PUT    /products/quick-board  # body: { productIds: ["id1","id2",...] } ตั้งสินค้าด่วนทั้งแผงตามลำดับ
GET    /products/quick        # รายการสินค้าด่วนอย่างเดียว
DELETE /products/:id
POST   /products/:id/image   # multipart field: file
GET    /uploads/products/... # ไฟล์รูป
GET    /sync/products        # ให้เครื่อง POS ดึงมาใช้
```

ไฟล์ถูกเก็บที่ `apps/api/uploads/products` และมาสเตอร์ที่ `apps/api/data/products.json`

ฟิลด์สำคัญ: `name`, `barcode`, `price`, `imageUrl`, `isQuick`, `quickSort`, `isOpenPrice`, `openPriceMax`

สินค้าด่วนบนจอ POS = สินค้าที่หลังบ้านตั้ง `isQuick=true` (เรียงตาม `quickSort`) — แก้ทีละตัวด้วย `PATCH /products/:id` หรือตั้งทั้งแผงด้วย `PUT /products/quick-board`

## โครงสร้าง

```
apps/pos      Electron + Vue (แคชเชียร์ / จอลูกค้า)
apps/api      NestJS sync + Discord digest ทุก 5 นาที
packages/shared   barcode / points / cart
packages/db       Drizzle schemas (SQLite + Postgres)
```

## ขั้นถัดไป

- ต่อ SQLite จริงในเครื่อง + sync outbox
- ต่อ PostgreSQL + สมาชิก/แต้มข้ามสาขา
- ESC/POS พิมพ์สลิป + ลิ้นชัก
- เปิด/ปิดรอบ + LINE / Discord
- electron-builder ทำไฟล์ติดตั้ง `.exe`
