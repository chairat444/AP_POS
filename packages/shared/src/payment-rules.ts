/** เงินทอนสูงสุดที่อนุญาตเมื่อรับเงินสด (บาท) — มาตรฐาน POS ไทยทั่วไป */
export const MAX_CASH_CHANGE = 999;

export type CashTenderResult =
  | { ok: true; applied: number; tendered: number; change: number }
  | { ok: false; reason: string };

/**
 * ตรวจเงินสดที่รับมา
 * - จ่ายน้อยกว่ายอดคงเหลือได้ (ชำระบางส่วน)
 * - จ่ายเกินได้ แต่ทอนต้องไม่เกิน MAX_CASH_CHANGE
 *   เช่น ยอด 330 รับ 1030 → ทอน 700 ผ่าน
 *       ยอด 300 รับ 1500 → ทอน 1200 ไม่ผ่าน
 */
export function validateCashTender(
  tendered: number,
  remaining: number,
  maxChange: number = MAX_CASH_CHANGE,
): CashTenderResult {
  const t = round2(tendered);
  const rem = round2(remaining);
  if (!(t > 0)) {
    return { ok: false, reason: "ใส่จำนวนเงินสด" };
  }
  if (!(rem > 0)) {
    return { ok: false, reason: "ไม่มียอดคงเหลือ" };
  }
  if (t + 1e-9 < rem) {
    return { ok: true, applied: t, tendered: t, change: 0 };
  }
  const change = round2(t - rem);
  if (change > maxChange + 1e-9) {
    return {
      ok: false,
      reason: `รับเงินสดมากเกินไป ทอน ${change.toFixed(0)} บาท (ทอนได้ไม่เกิน ${maxChange} บาท)`,
    };
  }
  return { ok: true, applied: rem, tendered: t, change };
}

/**
 * โอน / โครงการรัฐ / แต้ม — ห้ามเกินยอดคงเหลือ และไม่มีทอน
 */
export function validateExactOrPartialPay(
  amount: number,
  remaining: number,
  label: string,
): { ok: true; amount: number } | { ok: false; reason: string } {
  const a = round2(amount);
  const rem = round2(remaining);
  if (!(a > 0)) {
    return { ok: false, reason: `ใส่จำนวน${label}` };
  }
  if (a > rem + 1e-9) {
    return {
      ok: false,
      reason: `${label}ห้ามเกินยอดคงเหลือ ${rem.toFixed(2)} บาท (ไม่มีทอน)`,
    };
  }
  return { ok: true, amount: a };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
