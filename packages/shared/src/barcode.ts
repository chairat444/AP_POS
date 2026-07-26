/**
 * Price-embedded barcode (EAN-13 style used in Thai retail scales/labels):
 * 99 + productCode(5) + priceInSatangOrBahtDigits(5) + checkDigit(1)
 *
 * Example: 99aaaaabbbbbc
 * - prefix 99
 * - aaaaa = product code
 * - bbbbb = price digits (baht*100 as 5 digits, e.g. 01250 = 12.50)
 * - c = check digit (modulo-10, EAN-13)
 */
export type ParsedBarcode =
  | { kind: "standard"; barcode: string }
  | {
      kind: "priceEmbedded";
      barcode: string;
      productCode: string;
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
  if (/^99\d{11}$/.test(barcode)) {
    const productCode = barcode.slice(2, 7);
    const priceDigits = barcode.slice(7, 12);
    const checkDigit = barcode.slice(12, 13);
    const expected = ean13CheckDigit(barcode.slice(0, 12));
    const price = Number(priceDigits) / 100;
    return {
      kind: "priceEmbedded",
      barcode,
      productCode,
      price,
      checkDigit,
      validCheckDigit: checkDigit === expected,
    };
  }
  return { kind: "standard", barcode };
}
