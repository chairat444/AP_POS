/** ค่าคอมพนักงานตามยอดขายต่อวัน (ขั้นบันได) */

export type CommissionConfig = {
  enabled: boolean;
  /** ยอดขายเริ่มได้คอม เช่น 8000 */
  startSales: number;
  /** ขยับทุกกี่บาท เช่น 1000 */
  stepSales: number;
  /** ได้คอมกี่บาทต่อขั้น เช่น 100 */
  amountPerStep: number;
};

export type CommissionResult = {
  enabled: boolean;
  daySales: number;
  amount: number;
  steps: number;
  startSales: number;
  stepSales: number;
  amountPerStep: number;
  /** ยอดขั้นถัดไป (null ถ้าปิดคอม) */
  nextTierAt: number | null;
  nextTierAmount: number | null;
};

export const DEFAULT_COMMISSION_CONFIG: CommissionConfig = {
  enabled: false,
  startSales: 8000,
  stepSales: 1000,
  amountPerStep: 100,
};

function n(v: unknown, fallback: number) {
  const x = Number(v);
  return Number.isFinite(x) ? x : fallback;
}

export function normalizeCommissionConfig(
  raw: Partial<CommissionConfig> | null | undefined,
): CommissionConfig {
  return {
    enabled: Boolean(raw?.enabled),
    startSales: Math.max(0, n(raw?.startSales, DEFAULT_COMMISSION_CONFIG.startSales)),
    stepSales: Math.max(
      1,
      n(raw?.stepSales, DEFAULT_COMMISSION_CONFIG.stepSales),
    ),
    amountPerStep: Math.max(
      0,
      n(raw?.amountPerStep, DEFAULT_COMMISSION_CONFIG.amountPerStep),
    ),
  };
}

/**
 * คำนวณค่าคอมจากยอดขายทั้งวัน
 * เช่น เริ่ม 8,000 ได้ 100 · 9,000 ได้ 200 · 10,000 ได้ 300 (ขั้นละ 1,000 = +100)
 */
export function calcDailyCommission(
  daySales: number,
  config: Partial<CommissionConfig> | null | undefined,
): CommissionResult {
  const c = normalizeCommissionConfig(config);
  const sales = Math.max(0, n(daySales, 0));

  if (
    !c.enabled ||
    c.amountPerStep <= 0 ||
    c.startSales <= 0 ||
    sales < c.startSales
  ) {
    return {
      enabled: c.enabled,
      daySales: sales,
      amount: 0,
      steps: 0,
      startSales: c.startSales,
      stepSales: c.stepSales,
      amountPerStep: c.amountPerStep,
      nextTierAt: c.enabled && c.startSales > 0 ? c.startSales : null,
      nextTierAmount:
        c.enabled && c.startSales > 0 ? c.amountPerStep : null,
    };
  }

  const steps = Math.floor((sales - c.startSales) / c.stepSales) + 1;
  const amount = steps * c.amountPerStep;
  const nextTierAt = c.startSales + steps * c.stepSales;

  return {
    enabled: true,
    daySales: sales,
    amount,
    steps,
    startSales: c.startSales,
    stepSales: c.stepSales,
    amountPerStep: c.amountPerStep,
    nextTierAt,
    nextTierAmount: (steps + 1) * c.amountPerStep,
  };
}

/** ตัวอย่างข้อความอธิบายกฎ เช่น "เริ่ม 8,000฿ ได้ 100 · ทุก +1,000฿ ได้ +100" */
export function formatCommissionRule(config: CommissionConfig): string {
  const c = normalizeCommissionConfig(config);
  if (!c.enabled) return "ไม่คิดค่าคอม";
  return `เริ่ม ${c.startSales.toLocaleString("th-TH")}฿ ได้ ${c.amountPerStep.toLocaleString("th-TH")} · ทุก +${c.stepSales.toLocaleString("th-TH")}฿ ได้ +${c.amountPerStep.toLocaleString("th-TH")}`;
}
