/**
 * คีย์ลัด POS — ค่าเริ่มต้น + โครงที่หลังบ้านส่งทับได้
 *
 * หลังบ้าน (อนาคต) ส่งประมาณ:
 *   { keybindings: { open_payment: [{ key: "F12" }], confirm_payment: [{ key: "Home" }] } }
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
  pay_transfer: [{ key: "F11" }],
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
