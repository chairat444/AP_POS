import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  ServiceUnavailableException,
} from "@nestjs/common";

/** รหัสในลิงก์ QR — ตั้งใน env MEMBER_KIOSK_KEY */
export function requireKioskKey(provided: string | undefined) {
  const expected = (process.env.MEMBER_KIOSK_KEY ?? "").trim();
  if (!expected) {
    throw new ServiceUnavailableException("ยังไม่เปิดรับสมัครออนไลน์");
  }
  if (!provided?.trim() || provided.trim() !== expected) {
    throw new ForbiddenException("ลิงก์ไม่ถูกต้อง · สแกน QR จากร้าน");
  }
}

const buckets = new Map<string, { count: number; resetAt: number }>();

/** จำกัดความถี่ในหน่วยความจำ (รีสตาร์ท API แล้วรีเซ็ต) */
export function assertKioskRate(
  bucketKey: string,
  limit: number,
  windowMs: number,
) {
  const now = Date.now();
  let b = buckets.get(bucketKey);
  if (!b || now >= b.resetAt) {
    b = { count: 0, resetAt: now + windowMs };
    buckets.set(bucketKey, b);
  }
  b.count += 1;
  if (b.count > limit) {
    throw new HttpException(
      "ลองใหม่อีกครั้งในภายหลัง",
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}

export function clientIp(req: {
  ip?: string;
  headers?: Record<string, string | string[] | undefined>;
}): string {
  const fwd = req.headers?.["x-forwarded-for"];
  const raw = Array.isArray(fwd) ? fwd[0] : fwd;
  const fromFwd = raw?.split(",")[0]?.trim();
  return fromFwd || req.ip || "unknown";
}
