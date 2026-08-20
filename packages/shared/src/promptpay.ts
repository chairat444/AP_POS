/**
 * PromptPay QR (EMVCo Merchant-Presented) — payload string สำหรับเรนเดอร์ QR
 * รองรับเบอร์มือถือ / เลขบัตรประชาชน / e-Wallet
 */

function tlv(id: string, value: string): string {
  const len = String(value.length).padStart(2, "0");
  return `${id}${len}${value}`;
}

/** CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF) ตามมาตรฐาน EMVCo */
export function crc16CcittFalse(input: string): string {
  let crc = 0xffff;
  for (let i = 0; i < input.length; i++) {
    crc ^= input.charCodeAt(i) << 8;
    for (let bit = 0; bit < 8; bit++) {
      if (crc & 0x8000) crc = ((crc << 1) ^ 0x1021) & 0xffff;
      else crc = (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

function digitsOnly(raw: string): string {
  return String(raw ?? "").replace(/\D/g, "");
}

/**
 * แปลงเป้าหมาย PromptPay → tag ย่อยใน merchant account (29)
 * - เบอร์: 01 + 0066xxxxxxxxx
 * - บัตร ปชช. 13 หลัก: 02
 * - e-Wallet 15 หลัก: 03
 */
export function formatPromptPayTarget(id: string): {
  subTag: "01" | "02" | "03";
  value: string;
} {
  const d = digitsOnly(id);
  if (!d) throw new Error("ไม่มีหมายเลข PromptPay");

  if (d.length === 15) return { subTag: "03", value: d };
  if (d.length === 13) return { subTag: "02", value: d };

  // มือถือ: ตัด 0 นำหน้า แล้วใส่ 0066
  let national = d;
  if (national.startsWith("66") && national.length >= 11) {
    national = national.slice(2);
  } else if (national.startsWith("0")) {
    national = national.slice(1);
  }
  if (national.length < 8 || national.length > 10) {
    throw new Error("เบอร์ PromptPay ไม่ถูกต้อง");
  }
  return { subTag: "01", value: `0066${national}` };
}

export type BuildPromptPayQrOptions = {
  /** เบอร์ / เลขบัตร / e-Wallet */
  target: string;
  /** ยอดบาท — ถ้าใส่จะเป็น QR แบบ dynamic */
  amount?: number | null;
  /** ชื่อร้าน (optional, tag 59) */
  merchantName?: string | null;
};

/**
 * สร้างสตริง PromptPay QR พร้อม CRC (tag 63)
 */
export function buildPromptPayQrPayload(opts: BuildPromptPayQrOptions): string {
  const amount =
    opts.amount == null || !Number.isFinite(opts.amount)
      ? null
      : Math.round(Number(opts.amount) * 100) / 100;
  if (amount != null && amount <= 0) {
    throw new Error("ยอด PromptPay ต้องมากกว่า 0");
  }

  const { subTag, value } = formatPromptPayTarget(opts.target);
  const merchantInfo = tlv(
    "29",
    tlv("00", "A000000677010111") + tlv(subTag, value),
  );

  const name = String(opts.merchantName ?? "")
    .trim()
    .slice(0, 25);

  // Tag 54: ทศนิยม 2 ตำแหน่งตามที่แอปธนาคารคาดหวัง
  const amountTag = amount == null ? "" : tlv("54", amount.toFixed(2));
  const poi = amount == null ? tlv("01", "11") : tlv("01", "12");

  let payload =
    tlv("00", "01") +
    poi +
    merchantInfo +
    tlv("53", "764") +
    amountTag +
    tlv("58", "TH");

  if (name) payload += tlv("59", name);

  // CRC คำนวณรวม tag 63 ความยาว 04 แต่ยังไม่มีค่า
  const withCrcHead = `${payload}6304`;
  const crc = crc16CcittFalse(withCrcHead);
  return `${withCrcHead}${crc}`;
}

/** sanitize เก็บใน settings */
export function normalizePromptPayId(raw: string | null | undefined): string | null {
  const d = digitsOnly(raw ?? "");
  return d || null;
}
