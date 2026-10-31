/** ซองบอดี้ ASCII-only — กัน HTTPS WAF จับตัวอักษรไทยใน JSON */

export const WAF_BODY_KEY = "__enc";

export function utf8ToHex(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

export function hexToUtf8(hex: string): string {
  const clean = hex.trim();
  if (clean.length < 2 || clean.length % 2 !== 0) {
    throw new Error("invalid hex");
  }
  if (!/^[0-9a-f]+$/i.test(clean)) throw new Error("invalid hex");
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return new TextDecoder("utf-8").decode(bytes);
}

export function wrapWafJsonBody(value: unknown): { __enc: string } {
  return { [WAF_BODY_KEY]: utf8ToHex(JSON.stringify(value)) };
}

export function isWafEnvelope(body: unknown): body is { __enc: string } {
  if (body == null || typeof body !== "object" || Array.isArray(body)) {
    return false;
  }
  const enc = (body as Record<string, unknown>)[WAF_BODY_KEY];
  return typeof enc === "string" && enc.length >= 2 && enc.length % 2 === 0;
}

export function unwrapWafJsonBody(body: unknown): unknown {
  if (!isWafEnvelope(body)) return body;
  try {
    return JSON.parse(hexToUtf8(body[WAF_BODY_KEY]));
  } catch {
    return body;
  }
}

/** ห่อ JSON / URLSearchParams · ข้าม FormData และซองที่ห่อแล้ว */
export function maybeWrapWafRequestBody(body: unknown): unknown {
  if (body == null) return body;
  if (typeof FormData !== "undefined" && body instanceof FormData) return body;
  if (typeof URLSearchParams !== "undefined" && body instanceof URLSearchParams) {
    return wrapWafJsonBody(Object.fromEntries(body.entries()));
  }
  if (typeof body === "object" && !Array.isArray(body) && isWafEnvelope(body)) {
    return body;
  }
  if (typeof body === "object") return wrapWafJsonBody(body);
  return body;
}
