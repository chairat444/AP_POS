/** เงิน: 1,234.56 — หลีกเลี่ยง toLocaleString (ช้าตอนเรนเดอร์ตารางบ่อย) */
export function formatMoney(
  value: number | null | undefined,
  digits = 2,
): string {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return digits <= 0 ? "0" : (0).toFixed(digits);
  }
  const fixed = n.toFixed(digits);
  const neg = fixed.startsWith("-");
  const body = neg ? fixed.slice(1) : fixed;
  const [intPart, dec] = body.split(".");
  const withComma = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const out = dec != null ? `${withComma}.${dec}` : withComma;
  return neg ? `-${out}` : out;
}

/** จำนวนเต็มมีจุลภาค: 1,234 */
export function formatInt(value: number | null | undefined): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return "0";
  const rounded = Math.round(n);
  const neg = rounded < 0;
  const digits = String(Math.abs(rounded));
  const withComma = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return neg ? `-${withComma}` : withComma;
}
