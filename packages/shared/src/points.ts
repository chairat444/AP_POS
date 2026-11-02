export type PointsConfig = {
  /** Baht spent per 1 earned point (default 100) */
  bahtPerPoint: number;
  /** Baht discount per 1 redeemed point (default 1) */
  bahtPerRedeemPoint: number;
  /**
   * คูณแต้มที่ได้ถ้าสมาชิกเป็นเพื่อน LINE OA
   * 1 = ไม่คูณ · 2 = คูณสอง
   */
  lineFriendMultiplier?: number;
};

export const DEFAULT_POINTS_CONFIG: PointsConfig = {
  bahtPerPoint: 100,
  bahtPerRedeemPoint: 1,
  lineFriendMultiplier: 1,
};

export const LINE_FRIEND_MULTIPLIER_MAX = 10;

/** 1 = ไม่คูณ · 2–10 ตามที่แอดมินตั้งเมื่อเป็นเพื่อนไลน์ */
export function lineFriendEarnMultiplier(
  config: PointsConfig = DEFAULT_POINTS_CONFIG,
  lineLinked?: boolean,
): number {
  // คูณเฉพาะสมาชิกที่ผูก LINE แล้วเท่านั้น — ไม่ผูก/ลูกค้าทั่วไปได้ตามอัตราปกติ
  if (lineLinked !== true) return 1;
  const n = Math.floor(Number(config.lineFriendMultiplier) || 1);
  if (!Number.isFinite(n) || n < 2) return 1;
  return Math.min(LINE_FRIEND_MULTIPLIER_MAX, n);
}

export function earnPoints(
  netBaht: number,
  config: PointsConfig = DEFAULT_POINTS_CONFIG,
  opts?: { lineLinked?: boolean },
): number {
  if (netBaht <= 0 || config.bahtPerPoint <= 0) return 0;
  const base = Math.floor(netBaht / config.bahtPerPoint);
  return base * lineFriendEarnMultiplier(config, opts?.lineLinked);
}

export function redeemDiscountBaht(
  points: number,
  config: PointsConfig = DEFAULT_POINTS_CONFIG,
): number {
  if (points <= 0) return 0;
  return points * config.bahtPerRedeemPoint;
}

export function maxRedeemablePoints(
  billTotalBaht: number,
  availablePoints: number,
  config: PointsConfig = DEFAULT_POINTS_CONFIG,
): number {
  if (billTotalBaht <= 0 || availablePoints <= 0) return 0;
  const maxByBill = Math.floor(billTotalBaht / config.bahtPerRedeemPoint);
  return Math.min(availablePoints, maxByBill);
}
