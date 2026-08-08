/**
 * คีย์ลัด POS — ค่าเริ่มต้น + หลังบ้านส่งทับได้
 *
 * Admin ส่ง:
 *   { keybindings: { member: [{ key: "F2" }], open_payment: [{ key: "Home" }] } }
 * คีย์ที่ไม่ได้ส่งมาใช้ค่า DEFAULT
 */

export type PosActionId =
  | "open_payment"
  | "confirm_payment"
  | "pay_cash"
  | "pay_transfer"
  | "pay_government"
  | "pay_points"
  | "fill_exact"
  | "fill_round_100"
  | "clear_amount"
  | "remove_last_payment"
  | "cancel_payment"
  | "member"
  | "hold_bill"
  | "recall_bill"
  | "cancel_bill"
  | "void_line"
  | "product_search"
  | "sale_summary"
  | "float_count"
  | "cash_in"
  | "cash_out"
  | "close_shift"
  | "open_shift";

/** ปุ่ม/คีย์ลัดหน้าขาย (แถบล่าง + ที่เกี่ยวข้อง) */
export const SALE_SCREEN_ACTION_IDS = [
  "open_shift",
  "member",
  "void_line",
  "product_search",
  "hold_bill",
  "recall_bill",
  "cash_in",
  "cash_out",
  "float_count",
  "sale_summary",
  "cancel_bill",
  "open_payment",
  "close_shift",
] as const satisfies readonly PosActionId[];

export type SaleScreenActionId = (typeof SALE_SCREEN_ACTION_IDS)[number];

/** ชื่อภาษาไทยสำหรับ Admin */
export const POS_ACTION_LABELS_TH: Record<PosActionId, string> = {
  open_payment: "ชำระเงิน",
  confirm_payment: "ยืนยันชำระ",
  pay_cash: "จ่ายเงินสด",
  pay_transfer: "จ่ายโอน",
  pay_government: "จ่ายสวัสดิการ",
  pay_points: "จ่ายแต้ม",
  fill_exact: "เติมยอดพอดี",
  fill_round_100: "ปัดขึ้น 100",
  clear_amount: "ล้างยอด",
  remove_last_payment: "ลบรายการจ่ายล่าสุด",
  cancel_payment: "ยกเลิกหน้าชำระ",
  member: "ลูกค้า",
  hold_bill: "พักบิล",
  recall_bill: "เรียกบิลพัก",
  cancel_bill: "ยกเลิกบิล",
  void_line: "ยกเลิกรายการ",
  product_search: "ค้นหาสินค้า",
  sale_summary: "สรุปการขาย",
  float_count: "นับเงินทอน",
  cash_in: "นำเงินเข้า",
  cash_out: "นำเงินออก",
  close_shift: "ปิดรอบ",
  open_shift: "เปิดรอบ",
};

export type KeyChord = {
  /** ค่าจาก KeyboardEvent.key เช่น "Home", "F3", "Enter" */
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  meta?: boolean;
};

export type KeybindingMap = Partial<Record<PosActionId, KeyChord[]>>;

/**
 * ค่าเริ่มต้น
 * - ชำระเงิน / ยืนยันชำระ = Home
 * - หน้าชำระ: F9–F12 วิธีจ่าย (ไม่ใช้ที่หน้ารายการ)
 * - หน้ารายการ: F1–F8 งานขาย · Shift+F9–F12 งานรอบ/สรุป
 */
export const DEFAULT_KEYBINDINGS: Record<PosActionId, KeyChord[]> = {
  open_payment: [{ key: "Home" }],
  confirm_payment: [{ key: "Home" }],
  pay_cash: [{ key: "F12" }, { key: "Enter" }],
  // F11 โดน macOS (Show Desktop) แย่งบ่อย — มี Ctrl+F11 สำรอง
  pay_transfer: [{ key: "F11" }, { key: "F11", ctrl: true }],
  pay_government: [{ key: "F10" }],
  pay_points: [{ key: "F9" }],
  fill_exact: [{ key: "+" }, { key: "=" }, { key: "Insert" }],
  fill_round_100: [{ key: "-" }, { key: "_" }],
  clear_amount: [{ key: "c" }, { key: "C" }],
  remove_last_payment: [{ key: "Delete" }],
  cancel_payment: [{ key: "Escape" }],
  // หน้ารายการขาย — F1–F8 (ไม่ชน F9–F12 หน้าชำระ)
  open_shift: [{ key: "F1" }],
  member: [{ key: "F2" }],
  void_line: [{ key: "F3" }],
  product_search: [{ key: "F4" }],
  hold_bill: [{ key: "F5" }],
  recall_bill: [{ key: "F6" }],
  cash_in: [{ key: "F7" }],
  cash_out: [{ key: "F8" }],
  float_count: [{ key: "F9", shift: true }],
  sale_summary: [{ key: "F10", shift: true }],
  close_shift: [{ key: "F12", shift: true }],
  cancel_bill: [{ key: "Escape" }],
};

export function normalizeChord(chord: KeyChord): KeyChord {
  return {
    key: chord.key,
    ctrl: Boolean(chord.ctrl),
    shift: Boolean(chord.shift),
    alt: Boolean(chord.alt),
    meta: Boolean(chord.meta),
  };
}

export function mergeKeybindings(
  base: Record<PosActionId, KeyChord[]>,
  override?: KeybindingMap | null,
): Record<PosActionId, KeyChord[]> {
  const next = { ...base };
  if (!override) return next;
  for (const [action, chords] of Object.entries(override) as [
    PosActionId,
    KeyChord[] | undefined,
  ][]) {
    if (!chords) continue;
    next[action] = chords.map(normalizeChord);
  }
  return next;
}

/** ทำความสะอาด payload จาก Admin/API */
export function sanitizeKeybindingMap(
  raw: unknown,
): KeybindingMap {
  if (!raw || typeof raw !== "object") return {};
  const out: KeybindingMap = {};
  const known = new Set(Object.keys(DEFAULT_KEYBINDINGS) as PosActionId[]);
  for (const [action, chords] of Object.entries(
    raw as Record<string, unknown>,
  )) {
    if (!known.has(action as PosActionId)) continue;
    if (!Array.isArray(chords) || !chords.length) continue;
    const list: KeyChord[] = [];
    for (const c of chords) {
      if (!c || typeof c !== "object") continue;
      const key = String((c as KeyChord).key || "").trim();
      if (!key) continue;
      list.push(
        normalizeChord({
          key,
          ctrl: Boolean((c as KeyChord).ctrl),
          shift: Boolean((c as KeyChord).shift),
          alt: Boolean((c as KeyChord).alt),
          meta: Boolean((c as KeyChord).meta),
        }),
      );
    }
    if (list.length) out[action as PosActionId] = list;
  }
  return out;
}

export function eventMatchesChord(e: KeyboardEvent, chord: KeyChord): boolean {
  const c = normalizeChord(chord);
  // บางเครื่อง/เลย์เอาต์ส่ง key ไม่ตรง แต่ code ตรง (เช่น Home, F-keys)
  const keyOk =
    e.key === c.key ||
    e.code === c.key ||
    (c.key.length === 1 &&
      e.key.length === 1 &&
      e.key.toLowerCase() === c.key.toLowerCase());
  if (!keyOk) return false;
  if (Boolean(e.ctrlKey) !== c.ctrl) return false;
  if (Boolean(e.shiftKey) !== c.shift) return false;
  if (Boolean(e.altKey) !== c.alt) return false;
  if (Boolean(e.metaKey) !== c.meta) return false;
  return true;
}

export function eventMatchesAny(
  e: KeyboardEvent,
  chords: KeyChord[] | undefined,
): boolean {
  if (!chords?.length) return false;
  return chords.some((c) => eventMatchesChord(e, c));
}

function formatMod(chord: KeyChord): string {
  const parts: string[] = [];
  if (chord.ctrl) parts.push("Ctrl");
  if (chord.shift) parts.push("Shift");
  if (chord.alt) parts.push("Alt");
  if (chord.meta) parts.push("Cmd");
  const key =
    chord.key.length === 1 ? chord.key.toUpperCase() : chord.key;
  parts.push(key);
  return parts.join("+");
}

export function formatChord(chord: KeyChord): string {
  return formatMod(normalizeChord(chord));
}

export function formatChords(chords: KeyChord[] | undefined): string {
  if (!chords?.length) return "";
  return chords.map(formatChord).join(" / ");
}
