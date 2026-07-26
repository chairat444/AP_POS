import { ean13CheckDigit } from "../src/barcode";

/** Build a valid price-embedded barcode for manual testing. */
const productCode = process.argv[2] ?? "00003";
const priceBaht = Number(process.argv[3] ?? "78");
const priceDigits = String(Math.round(priceBaht * 100)).padStart(5, "0");
const body = `99${productCode}${priceDigits}`;
const check = ean13CheckDigit(body);
const barcode = `${body}${check}`;

console.log(barcode);
console.log(`product=${productCode} price=${priceBaht.toFixed(2)}`);
