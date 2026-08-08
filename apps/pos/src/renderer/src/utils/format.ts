/** เงิน: 1,234.56 */
export function formatMoney(
  value: number | null | undefined,
  digits = 2,
): string {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return digits <= 0 ? "0" : (0).toFixed(digits);
  }
  return n.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/** จำนวนเต็มมีจุลภาค: 1,234 */
export function formatInt(value: number | null | undefined): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return "0";
  return Math.round(n).toLocaleString("en-US");
}
