/**
 * ESC/POS — ใช้เตะลิ้นชัก (และโหมดข้อความถ้าเครื่องรองรับ)
 * ร้านที่ใช้เฟิร์มแวร์จีน + พิมพ์ไทย: แนะนำโหมด system (ไดรเวอร์ Windows)
 */
import iconv from "iconv-lite";

export type EscPosEncoding = "utf8" | "cp874" | "tis620";

export type EncodeEscPosOpts = {
  encoding?: EscPosEncoding;
  /** เตะลิ้นชักผ่านพอร์ตที่เครื่องพิมพ์ (RJ11) */
  openDrawer?: boolean;
  cut?: boolean;
};

/** ESC p m t1 t2 — เตะลิ้นชักครั้งเดียว (pin 0 เท่านั้น) */
export function cashDrawerPulse(): Buffer {
  // t1≈60ms t2≈120ms — พอเปิดลิ้นชักโดยไม่กระตุกซ้ำ
  return Buffer.from([0x1b, 0x70, 0x00, 0x3c, 0x78]);
}

export function encodeThaiEscPos(
  text: string,
  opts: EncodeEscPosOpts = {},
): Buffer {
  const encoding: EscPosEncoding = opts.encoding ?? "cp874";
  const openDrawer = opts.openDrawer !== false;
  const cut = opts.cut !== false;
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const chunks: Buffer[] = [];

  chunks.push(Buffer.from([0x1b, 0x40]));

  if (openDrawer) {
    chunks.push(cashDrawerPulse());
  }

  if (encoding === "utf8") {
    chunks.push(Buffer.from([0x1c, 0x2e]));
    chunks.push(Buffer.from([0x1c, 0x43, 0x01]));
    chunks.push(Buffer.from(normalized, "utf8"));
  } else {
    const enc = encoding === "tis620" ? "tis620" : "win874";
    chunks.push(iconv.encode(normalized, enc));
  }

  if (!normalized.endsWith("\n")) chunks.push(Buffer.from([0x0a]));
  chunks.push(Buffer.from([0x1b, 0x64, 0x03]));
  if (cut) {
    chunks.push(Buffer.from([0x1d, 0x56, 0x00]));
  }
  return Buffer.concat(chunks);
}

/** ส่งแค่เตะลิ้นชักครั้งเดียว */
export function encodeDrawerOnly(): Buffer {
  return Buffer.concat([Buffer.from([0x1b, 0x40]), cashDrawerPulse()]);
}
