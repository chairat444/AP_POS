import { ean13CheckDigit } from "../src/barcode.ts";

/**
 * Build price-embedded barcode:
 * 9 + productBarcode(6) + priceBaht(5) + check
 * Example: 900009 @ 55฿ → 9900009000555
 */
const productBarcode = (process.argv[2] ?? "900009").padStart(6, "0").slice(-6);
const priceBaht = Math.round(Number(process.argv[3] ?? "55"));
if (!Number.isFinite(priceBaht) || priceBaht < 0 || priceBaht > 99999) {
  console.error("price must be whole baht 0..99999");
  process.exit(1);
}
const priceDigits = String(priceBaht).padStart(5, "0");
const body = `9${productBarcode}${priceDigits}`;
const check = ean13CheckDigit(body);
const barcode = `${body}${check}`;

console.log(barcode);
console.log(`productBarcode=${productBarcode} price=${priceBaht}฿ (whole baht)`);
