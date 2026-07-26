/** ใบเงิน/เหรียญที่ร้านใช้ตอนนับลิ้นชัก */
export const CASH_DENOMS = [1000, 500, 100, 50, 20, 10, 5, 2, 1] as const;

export type CashDenom = (typeof CASH_DENOMS)[number];

export type DenomCount = {
  denom: number;
  /** จำนวนใบ/เหรียญ */
  qty: number;
};

/** สีตามแบงก์/เหรียญจริง — ใช้เป็น CSS class `denom-{tone}` */
export const DENOM_META: Record<
  CashDenom,
  { kind: "note" | "coin"; label: string; tone: string }
> = {
  1000: { kind: "note", label: "แบงก์", tone: "brown" },
  500: { kind: "note", label: "แบงก์", tone: "purple" },
  100: { kind: "note", label: "แบงก์", tone: "red" },
  50: { kind: "note", label: "แบงก์", tone: "blue" },
  20: { kind: "note", label: "แบงก์", tone: "green" },
  10: { kind: "coin", label: "เหรียญ", tone: "bronze" },
  5: { kind: "coin", label: "เหรียญ", tone: "copper" },
  2: { kind: "coin", label: "เหรียญ", tone: "nickel" },
  1: { kind: "coin", label: "เหรียญ", tone: "yellow" },
};

export function denomMeta(denom: number) {
  return (
    DENOM_META[denom as CashDenom] ?? {
      kind: "coin" as const,
      label: "เหรียญ",
      tone: "nickel",
    }
  );
}

export function emptyDenomCounts(): DenomCount[] {
  return CASH_DENOMS.map((denom) => ({ denom, qty: 0 }));
}

/** เติมจำนวนจากรายการที่เคยบันทึก (ชนิดที่ไม่มี = 0) */
export function hydrateDenomCounts(saved: DenomCount[]): DenomCount[] {
  const qtyByDenom = new Map(
    saved.map((d) => [d.denom, Math.max(0, Math.floor(d.qty) || 0)]),
  );
  return emptyDenomCounts().map((row) => ({
    denom: row.denom,
    qty: qtyByDenom.get(row.denom) ?? 0,
  }));
}

export function denomSubtotal(row: DenomCount): number {
  return row.denom * Math.max(0, Math.floor(row.qty) || 0);
}

export function sumDenomCounts(rows: DenomCount[]): number {
  return Math.round(rows.reduce((s, r) => s + denomSubtotal(r), 0) * 100) / 100;
}

export const CASH_OUT_REASONS = [
  "ค่าน้ำ",
  "ค่าของ / สินค้าใช้ในร้าน",
  "ค่าไฟ / ค่าบริการ",
  "ส่งเงินเข้าสำนักงาน",
  "อื่นๆ",
] as const;

export const CASH_IN_REASONS = [
  "เติมเงินทอน",
  "รับจากสำนักงาน",
  "อื่นๆ",
] as const;
