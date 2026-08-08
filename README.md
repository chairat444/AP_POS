# AP หมูสด POS (`ap-pos`)

ระบบ POS แบบ offline-first สำหรับร้านหมูสด — Windows Electron + Vue 3 + NestJS

## Stack

| ส่วน | เทคโนโลยี |
|------|-----------|
| แอปแคชเชียร์ | Electron + Vue 3 + Pinia + Vite |
| Admin หลังบ้าน | Nuxt 3 (สไตล์ civic / demo-backend) |
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

# Admin หลังบ้าน (พอร์ต 3100) — ต้องมี API รันอยู่
pnpm dev:admin
```

เปิด Admin ที่ http://127.0.0.1:3100 (แดชบอร์ด / สินค้า / สมาชิก / รายการขาย)
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

## หลังบ้าน (Admin + API)

หน้าเว็บ Admin อยู่ที่ `apps/admin` (Nuxt) ดึงข้อมูลจาก Postgres ผ่าน API

```bash
GET    /sales
GET    /sales/summary
GET    /products
POST   /products
PATCH  /products/:id
PUT    /products/quick-board  # body: { productIds: ["id1","id2",...] }
GET    /products/quick
DELETE /products/:id
POST   /products/:id/image   # multipart field: file
GET    /members
PATCH  /members/:id
GET    /sync/products
```

ไฟล์รูปอยู่ที่ `apps/api/uploads/products`

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

- ESC/POS พิมพ์สลิป + ลิ้นชัก
- เปิด/ปิดรอบ + LINE / Discord
- staff/roles/branch settings ไปส่วนกลางเต็มรูป

## สร้างไฟล์ติดตั้ง POS (พร้อมข้อมูลออฟไลน์)

Seed ที่แพ็กไปอยู่ที่ `apps/pos/resources/seed/` (สินค้า/สมาชิก/รูป)  
**เทสออฟไลน์ไม่ต้องมี API** — ใช้ seed ที่มีอยู่แล้วได้เลย

```bash
# ใช้ seed เดิม (ไม่เรียก API)
pnpm dist:pos:win

# ถ้ามี API และอยากอัปเดต seed ก่อนสร้าง Setup
API_BASE=http://localhost:3000 pnpm dist:pos:win:fresh
```

ไฟล์ที่ได้: `apps/pos/release/AP POS-Setup-0.1.0.exe`

เครื่องขายติดตั้งแล้วเปิดครั้งแรกจะโหลด seed + รูปออฟไลน์อัตโนมัติ  
พอมีเน็ต sync ครั้งแรกจะ bootstrap จากเซิร์ฟเวอร์ทับให้เป็นข้อมูลล่าสุด

ตั้งค่า API ตอน build (สำหรับตอนที่จะ sync ทีหลัง — ไม่บังคับตอนเทสออฟไลน์):

```bash
VITE_API_BASE=https://api.example.com pnpm --filter @ap-pos/pos build
```

รายละเอียด seed: `apps/pos/resources/seed/README.md`

## Database

ดูวิธี connect SQLite (POS) และ PostgreSQL (API) ได้ที่ [docs/DATABASE.md](docs/DATABASE.md)
