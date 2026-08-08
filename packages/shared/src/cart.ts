export type CartLine = {
  id: string;
  barcode: string;
  productCode?: string;
  name: string;
  qty: number;
  unit: string;
  unitPrice: number;
  discount: number;
  lineTotal: number;
};

/** สรุปช่องทางชำระบนจอลูกค้า */
export type CartPaymentLine = {
  method: string;
  label: string;
  amount: number;
};

export type CartSnapshot = {
  lines: CartLine[];
  itemCount: number;
  subtotal: number;
  discount: number;
  total: number;
  change: number;
  memberName?: string;
  memberPoints?: number;
  /** แต้มที่ใช้เป็นส่วนลดได้ตอนนี้ (หักที่ใช้ไปในบิลแล้ว) */
  pointsUsable?: number;
  /** แต้มที่จะได้จากบิลนี้ */
  pointsToEarn?: number;
  /** ส่วนลดจากแต้ม (บาท) — ให้จอลูกค้าคำนวณฐานได้แต้มให้ตรง */
  pointsDiscount?: number;
  /** กำลังเปิดหน้าชำระเงิน */
  paying?: boolean;
  paid?: number;
  remaining?: number;
  paymentLines?: CartPaymentLine[];
  /** หลังจบบิล — ค้างรายการบนจอลูกค้าชั่วคราว */
  postPaid?: boolean;
};

export function recalcLine(line: Omit<CartLine, "lineTotal">): CartLine {
  const lineTotal = Math.max(0, line.qty * line.unitPrice - line.discount);
  return { ...line, lineTotal: round2(lineTotal) };
}

export function summarizeCart(
  lines: CartLine[],
  billDiscount = 0,
  paid = 0,
): Omit<CartSnapshot, "memberName" | "memberPoints"> {
  const subtotal = round2(lines.reduce((s, l) => s + l.lineTotal, 0));
  const discount = round2(Math.min(billDiscount, subtotal));
  const total = round2(subtotal - discount);
  const itemCount = lines.reduce((s, l) => s + l.qty, 0);
  const change = round2(Math.max(0, paid - total));
  return { lines, itemCount, subtotal, discount, total, change };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
