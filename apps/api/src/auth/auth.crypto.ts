import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const AUTH_SECRET =
  process.env.AUTH_SECRET ?? "ap-pos-dev-secret-change-me";

export type AuthTokenScope = "admin" | "purchase-order";

export type AuthTokenPayload = {
  sub: string;
  code: string;
  name: string;
  role: string;
  /** ไม่มีค่า = โทเคน admin เก่า (ถือเป็น admin) */
  scope?: AuthTokenScope;
  exp: number;
};

export function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string | null | undefined) {
  if (!stored || !stored.includes(":")) return false;
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const hashBuf = Buffer.from(hash, "hex");
  const test = scryptSync(password, salt, 64);
  if (hashBuf.length !== test.length) return false;
  return timingSafeEqual(hashBuf, test);
}

export function signToken(
  payload: Omit<AuthTokenPayload, "exp">,
  ttlSec = 60 * 60 * 24 * 7,
) {
  const full: AuthTokenPayload = {
    ...payload,
    exp: Math.floor(Date.now() / 1000) + ttlSec,
  };
  const body = Buffer.from(JSON.stringify(full)).toString("base64url");
  const sig = createHmac("sha256", AUTH_SECRET).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifyToken(token: string): AuthTokenPayload | null {
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = createHmac("sha256", AUTH_SECRET).update(body).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(
      Buffer.from(body, "base64url").toString("utf8"),
    ) as AuthTokenPayload;
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}
