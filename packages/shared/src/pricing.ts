/**
 * วิธีคิดราคา / กำไร (ใช้กับของสดและสินค้าทั่วไป)
 *
 * 1) กำไรจริง % = (ขาย − ทุน) ÷ ขาย × 100
 *    เช่น ทุน 156 · ขาย 195 → (195−156)/195 = 20%
 *    แปลว่าในเงินที่ลูกค้าจ่าย 195 บาท มีกำไร 39 บาท = 20% ของราคาขาย
 *
 * 2) ราคาขายแนะนำ จากเป้ากำไรบนราคาขาย X%
 *    ขาย = ทุน ÷ (1 − X/100)
 *    เช่น ทุน 156 · เป้า 30% → 156 ÷ 0.7 ≈ 222.86
 *    ตรวจกลับ: (222.86−156)/222.86 ≈ 30%
 *
 * หมายเหตุ: ไม่ใช่สูตร “ทุนบวก X%” (ทุน×1.X) — แบบนั้นเป็น markup จากทุน
 * ซึ่ง % จะไม่ตรงกับกำไรจริงบนราคาขาย
 */

/** ราคาขายแนะนำจากทุน เพื่อได้กำไรขั้นต้น (margin บนราคาขาย) X%
 *  เช่น ทุน 60 · กำไร 40% → ขาย 100 (เพราะ 40/100 = 40%)
 */
export function suggestedSellPrice(
  cost: number | null | undefined,
  marginPct: number,
): number | null {
  const c = Number(cost);
  const m = Number(marginPct);
  if (!Number.isFinite(c) || c < 0) return null;
  if (!Number.isFinite(m) || m <= 0 || m >= 100) return null;
  // ขาย = ทุน / (1 - เป้ากำไร%)
  return Math.round((c / (1 - m / 100)) * 100) / 100;
}

/** กำไรขั้นต้น % จากราคาขายปัจจุบัน = (ขาย - ทุน) / ขาย * 100 */
export function actualMarginPct(
  cost: number | null | undefined,
  sell: number | null | undefined,
): number | null {
  const c = Number(cost);
  const s = Number(sell);
  if (!Number.isFinite(c) || !Number.isFinite(s) || s <= 0) return null;
  // กำไรจริงบนราคาขาย ไม่ใช่บวกจากทุน
  return Math.round(((s - c) / s) * 1000) / 10;
}
