/**
 * แปลงอักขระแป้นไทย Kedmanee → US QWERTY (เฉพาะช่องสแกนบาร์โค้ด)
 *
 * สแกนเนอร์ส่งคีย์ตามตำแหน่งปุ่ม แล้ว Windows แปลงตามภาษาที่เปิดอยู่
 * ตารางกลับจาก PyThaiNLP `EN_TH_KEYB_PAIRS` + ปุ่ม 1/`!` จาก TIS 820-2531
 */

/** EN key → Thai char (Windows Kedmanee) — แล้วกลับเป็น Thai→EN */
const EN_TO_THAI: Record<string, string> = {
  "`": "_",
  "1": "ๅ",
  "2": "/",
  "3": "-",
  "4": "ภ",
  "5": "ถ",
  "6": "\u0E38", // ุ
  "7": "\u0E36", // ึ
  "8": "ค",
  "9": "ต",
  "0": "จ",
  "-": "ข",
  "=": "ช",
  "~": "%",
  "!": "+",
  "@": "๑",
  "#": "๒",
  $: "๓",
  "%": "๔",
  "^": "\u0E39", // ู
  "&": "฿",
  "*": "๕",
  "(": "๖",
  ")": "๗",
  _: "๘",
  "+": "๙",
  q: "ๆ",
  w: "ไ",
  e: "\u0E33", // ำ
  r: "พ",
  t: "ะ",
  y: "\u0E31", // ั
  u: "\u0E35", // ี
  i: "ร",
  o: "น",
  p: "ย",
  "[": "บ",
  "]": "ล",
  "\\": "ฃ",
  Q: "๐",
  W: '"',
  E: "ฎ",
  R: "ฑ",
  T: "ธ",
  Y: "\u0E4D", // ํ
  U: "\u0E4A", // ๊
  I: "ณ",
  O: "ฯ",
  P: "ญ",
  "{": "ฐ",
  "}": ",", // shift+]
  "|": "ฅ",
  a: "ฟ",
  s: "ห",
  d: "ก",
  f: "ด",
  g: "เ",
  h: "\u0E49", // ้
  j: "\u0E48", // ่
  k: "า",
  l: "ส",
  ";": "ว",
  "'": "ง",
  A: "ฤ",
  S: "ฆ",
  D: "ฏ",
  F: "โ",
  G: "ฌ",
  H: "\u0E47", // ็
  J: "\u0E4B", // ๋
  K: "ษ",
  L: "ศ",
  ":": "ซ",
  '"': ".",
  z: "ผ",
  x: "ป",
  c: "แ",
  v: "อ",
  b: "\u0E34", // ิ
  n: "\u0E37", // ื
  m: "ท",
  ",": "ม",
  ".": "ใ",
  "/": "ฝ",
  Z: "(",
  X: ")",
  C: "ฉ",
  V: "ฮ",
  B: "\u0E3A", // ฺ
  N: "\u0E4C", // ์
  M: "?",
  "<": "ฒ",
  ">": "ฬ",
  "?": "ฦ",
};

const THAI_TO_US: Record<string, string> = Object.create(null);
for (const [en, th] of Object.entries(EN_TO_THAI)) {
  // ถ้าไทยตัวเดียว map ไปหลาย EN (ไม่ควรเกิด) เก็บตัวแรก
  if (THAI_TO_US[th] == null) THAI_TO_US[th] = en;
}

const THAI_BLOCK = /[\u0E00-\u0E7F]/;

/** ASCII ที่แป้นไทยใช้แทนปุ่มตัวเลข — เคสบาร์ไม่มีตัวไทยเลย เช่น 2323 → /-/ - */
const THAI_LAYOUT_ASCII = new Set([
  "_",
  "/",
  "-",
  "+",
  "%",
  '"',
  ".",
  "(",
  ")",
  "?",
  ",",
]);

function mapThaiToUs(text: string): string {
  let out = "";
  for (const ch of text) {
    out += THAI_TO_US[ch] ?? ch;
  }
  return out;
}

/**
 * true เมื่อน่าจะมาจากแป้นไทย
 * — ไม่แตะบาร์โค้ด ASCII ที่สะอาด เช่น 8850… / 3*
 */
export function shouldRemapThaiScanKeyboard(text: string): boolean {
  const s = text.trim();
  if (!s) return false;
  if (/^[0-9A-Za-z*]+$/.test(s)) return false;
  if (THAI_BLOCK.test(s)) return true;
  if (s.length >= 4 && [...s].every((ch) => THAI_LAYOUT_ASCII.has(ch))) {
    return true;
  }
  return false;
}

/** ช่องสแกน: แป้นไทย → US · ไม่ใช่แล้วคืนค่าเดิม */
export function normalizeScanKeyboardInput(raw: string): string {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return trimmed;
  if (!shouldRemapThaiScanKeyboard(trimmed)) return trimmed;
  return mapThaiToUs(trimmed);
}
