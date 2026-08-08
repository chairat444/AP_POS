import * as XLSX from "xlsx";

export type ProductExcelRow = {
  barcode: string;
  productCode?: string | null;
  name: string;
  unit: string;
  costPrice: number | null;
  price: number | null;
};

export type ParsedPriceRow = {
  barcode?: string;
  productCode?: string;
  costPrice?: number | null;
  price?: number | null;
};

const HEADERS = [
  "บาร์โค้ด",
  "รหัสสินค้า",
  "ชื่อ",
  "หน่วย",
  "ราคาทุน",
  "ราคาขาย",
] as const;

function cellStr(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "number" && Number.isFinite(v)) {
    // กัน scientific notation จาก Excel
    if (Number.isInteger(v) && Math.abs(v) >= 1e11) {
      return v.toLocaleString("fullwide", { useGrouping: false });
    }
    return String(v);
  }
  return String(v).trim();
}

function parseMoney(v: unknown): number | null | undefined {
  if (v == null || v === "") return undefined;
  if (typeof v === "number") {
    return Number.isFinite(v) ? Math.round(v * 100) / 100 : undefined;
  }
  const s = String(v).trim().replace(/,/g, "");
  if (!s || s === "-" || s === "—") return undefined;
  const n = Number(s);
  if (!Number.isFinite(n)) return undefined;
  return Math.round(n * 100) / 100;
}

function headerKey(h: unknown): string {
  return cellStr(h).toLowerCase().replace(/\s+/g, "");
}

/** Export สินค้าเป็นไฟล์ .xlsx */
export function exportProductsExcel(products: ProductExcelRow[], filename?: string) {
  const aoa: (string | number | null)[][] = [HEADERS.slice()];
  for (const p of products) {
    aoa.push([
      p.barcode,
      p.productCode ?? "",
      p.name,
      p.unit,
      p.costPrice,
      p.price,
    ]);
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  // บาร์โค้ด / รหัส เป็นข้อความ — กัน Excel ตัดเลขหรือเป็น scientific
  const ref = ws["!ref"];
  if (ref) {
    const range = XLSX.utils.decode_range(ref);
    for (let R = 1; R <= range.e.r; R++) {
      for (const C of [0, 1]) {
        const addr = XLSX.utils.encode_cell({ r: R, c: C });
        const cell = ws[addr];
        if (!cell || cell.v == null || cell.v === "") continue;
        cell.t = "s";
        cell.v = String(cell.v);
        cell.z = "@";
      }
    }
  }
  ws["!cols"] = [
    { wch: 18 },
    { wch: 12 },
    { wch: 28 },
    { wch: 8 },
    { wch: 12 },
    { wch: 12 },
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "สินค้า");
  const name =
    filename ??
    `products-prices-${new Date().toISOString().slice(0, 10)}.xlsx`;
  XLSX.writeFile(wb, name);
}

/** อ่าน Excel → แถวอัปเดตราคา (เซลล์ว่าง = ไม่แก้ฟิลด์นั้น) */
export function parseProductsPriceExcel(buf: ArrayBuffer): ParsedPriceRow[] {
  const wb = XLSX.read(buf, { type: "array" });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return [];
  const ws = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<(string | number | null)[]>(ws, {
    header: 1,
    defval: "",
    raw: true,
  }) as unknown[][];
  if (!rows.length) return [];

  const header = (rows[0] ?? []).map(headerKey);
  const idx = {
    barcode: header.findIndex((h) =>
      ["บาร์โค้ด", "barcode", "barcod"].some((k) => h.includes(k.replace(/\s+/g, ""))),
    ),
    productCode: header.findIndex((h) =>
      ["รหัสสินค้า", "productcode", "sku", "code"].some((k) =>
        h === k.replace(/\s+/g, "") || h.includes("รหัส"),
      ),
    ),
    costPrice: header.findIndex((h) =>
      ["ราคาทุน", "costprice", "cost", "ทุน"].some(
        (k) => h === k.replace(/\s+/g, "") || h.includes("ทุน"),
      ),
    ),
    price: header.findIndex((h) =>
      ["ราคาขาย", "price", "sell", "ขาย"].some((k) => {
        const key = k.replace(/\s+/g, "");
        if (h.includes("ทุน")) return false;
        return h === key || h.includes("ขาย") || h === "price";
      }),
    ),
  };

  // fallback positional if headers unknown
  if (idx.barcode < 0 && idx.productCode < 0) {
    idx.barcode = 0;
    idx.productCode = 1;
    idx.costPrice = 4;
    idx.price = 5;
  }

  const out: ParsedPriceRow[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i] ?? [];
    const barcode = idx.barcode >= 0 ? cellStr(r[idx.barcode]) : "";
    const productCode =
      idx.productCode >= 0 ? cellStr(r[idx.productCode]) : "";
    if (!barcode && !productCode) continue;

    const row: ParsedPriceRow = {};
    if (barcode) row.barcode = barcode;
    if (productCode) row.productCode = productCode;

    if (idx.costPrice >= 0) {
      const raw = r[idx.costPrice];
      if (raw !== "" && raw != null) {
        const n = parseMoney(raw);
        if (n !== undefined) row.costPrice = n;
      }
    }
    if (idx.price >= 0) {
      const raw = r[idx.price];
      if (raw !== "" && raw != null) {
        const n = parseMoney(raw);
        if (n !== undefined) row.price = n;
      }
    }

    if (row.costPrice === undefined && row.price === undefined) continue;
    out.push(row);
  }
  return out;
}
