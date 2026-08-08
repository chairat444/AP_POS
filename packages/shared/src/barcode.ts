/**
 * Price-embedded barcode (EAN-13):
 * 9 + productBarcode(6) + priceBaht(5) + checkDigit(1)
 *
 * Example: 9900009000555
 * - prefix 9
 * - 900009 = บาร์สินค้า (ระบบเก่าเก็บค่านี้)
 * - 00055 = ราคาบาทเต็ม 55 (ไม่มีทศนิยม)
 * - 5 = check digit (EAN-13)
 */
export type ParsedBarcode =
  | { kind: "standard"; barcode: string }
  | {
      kind: "priceEmbedded";
      barcode: string;
      /** บาร์สินค้า 6 หลัก ที่ระบบเก่าเก็บใน master/ขาย */
      productBarcode: string;
      /** ราคาเป็นบาทเต็ม (ไม่มีทศนิยม) */
      price: number;
      checkDigit: string;
      validCheckDigit: boolean;
    };

export function ean13CheckDigit(digits12: string): string {
  if (!/^\d{12}$/.test(digits12)) {
    throw new Error("EAN-13 check digit requires exactly 12 digits");
  }
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const n = Number(digits12[i]);
    sum += i % 2 === 0 ? n : n * 3;
  }
  return String((10 - (sum % 10)) % 10);
}

export function parseBarcode(raw: string): ParsedBarcode {
  const barcode = raw.trim();
  // 9 + 6 หลักบาร์สินค้า + 5 หลักราคา + 1 check = 13 หลัก
  if (/^9\d{12}$/.test(barcode)) {
    const productBarcode = barcode.slice(1, 7);
    const priceDigits = barcode.slice(7, 12);
    const checkDigit = barcode.slice(12, 13);
    const expected = ean13CheckDigit(barcode.slice(0, 12));
    const price = Number(priceDigits);
    return {
      kind: "priceEmbedded",
      barcode,
      productBarcode,
      price,
      checkDigit,
      validCheckDigit: checkDigit === expected,
    };
  }
  return { kind: "standard", barcode };
}
