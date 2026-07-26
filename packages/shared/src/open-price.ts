/**
 * Open-price entry (สินค้าเบ็ดเตล็ด):
 * Staff types an amount like "55" → misc item at 55 baht.
 * Default max is 100 baht (configurable).
 */
export function parseOpenPriceAmount(
  raw: string,
  maxBaht = 100,
): number | null {
  const text = raw.trim();
  if (!/^\d{1,3}([.]\d{1,2})?$/.test(text)) return null;
  const amount = Number(text);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  if (amount > maxBaht) return null;
  return Math.round(amount * 100) / 100;
}
