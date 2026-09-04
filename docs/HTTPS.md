# HTTPS + API (mixed content)

Admin ที่ [https://pos.chinthurakij.com](https://pos.chinthurakij.com) อยู่บน HTTPS  
แต่ถ้า `NUXT_PUBLIC_API_BASE` ยังเป็น `http://…:8123` เบราว์เซอร์จะบล็อกคำขอ (mixed content) → `Failed to fetch`

## วิธีที่แนะนำ: same-origin `/api`

1. **Admin** เรียก `/api/...` (โดเมนเดียวกับหน้าเว็บ = HTTPS)
2. **Proxy** ส่งต่อไป NestJS ที่ `http://127.0.0.1:8123` (HTTP ในเครื่องได้)

มีสองทาง (ใช้ทางใดทางหนึ่งก็พอ):

### A) Apache reverse proxy (แนะนำบน production)

ใส่ก่อน rule ที่ส่งไป Nuxt:

```apache
ProxyPreserveHost On
ProxyPass        /api/ http://127.0.0.1:8123/
ProxyPassReverse /api/ http://127.0.0.1:8123/
```

จากนั้น rebuild Admin:

```bash
export NUXT_PUBLIC_API_BASE=/api
# ถ้าใช้ Apache proxy โดยตรง ไม่จำเป็นต้องตั้ง NUXT_API_PROXY_TARGET
pnpm --filter @ap-pos/admin build
# แล้ว deploy .output ตามปกติ + restart process
```

### B) Nitro proxy ใน Admin (มีในโค้ดแล้ว)

ไฟล์ `apps/admin/server/api/[...path].ts` จะ forward `/api/*` → NestJS

บนเซิร์ฟเวอร์ตั้ง:

```bash
NUXT_PUBLIC_API_BASE=/api
NUXT_API_PROXY_TARGET=http://127.0.0.1:8123
```

แล้ว build + restart Nuxt (ต้องรัน Node server ของ Nuxt ไม่ใช่แค่ static files)

## POS (Electron)

อัปเดต API base เป็น:

`https://pos.chinthurakij.com/api`

(ในตั้งค่า POS หรือตอน `pnpm dist:pos:win`)

พอร์ต `8123` ยังใช้จากสคริปต์/เซิร์ฟเวอร์ภายในได้ แต่**อย่าใช้จากหน้าเว็บ HTTPS**
