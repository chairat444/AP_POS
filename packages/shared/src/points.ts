export type PointsConfig = {
  /** Baht spent per 1 earned point (default 100) */
  bahtPerPoint: number;
  /** Baht discount per 1 redeemed point (default 1) */
  bahtPerRedeemPoint: number;
};

export const DEFAULT_POINTS_CONFIG: PointsConfig = {
  bahtPerPoint: 100,
  bahtPerRedeemPoint: 1,
};

export function earnPoints(
  netBaht: number,
  config: PointsConfig = DEFAULT_POINTS_CONFIG,
): number {
  if (netBaht <= 0 || config.bahtPerPoint <= 0) return 0;
  return Math.floor(netBaht / config.bahtPerPoint);
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
