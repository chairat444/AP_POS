/** กำไรขั้นต้นของสินค้าเปิดราคา — 15% ของยอดขายหลังส่วนลด */
export const OPEN_PRICE_MARGIN = 0.15;

/**
 * สินค้าที่คิดกำไรประมาณการเป็น % ของยอด (ไม่ใช้ทุนต่อหน่วย/ต่อกก.)
 * key = บาร์ของสด 6 หลัก (เช่น 900011)
 */
export const ESTIMATED_MARGIN_BY_FRESH_CODE: Record<string, number> = {
  /** หมูสด อื่นๆ — บาร์ฝังราคา 13 หลัก เช่น 9900011001137 */
  "900011": 0.2,
};

export type CostCatalogItem = {
  barcode: string;
  productCode: string | null;
  costPrice: number | null;
  sellPrice: number | null;
  isOpenPrice: boolean;
  deleted: boolean;
  active: boolean;
  updatedAt: number;
};

export type CostLookup = {
  byCode: Map<string, CostCatalogItem>;
  byBarcode: Map<string, CostCatalogItem>;
};

export type ProfitLineIn = {
  id: string;
  barcode: string;
  productCode?: string | null;
  name?: string | null;
  qty: number;
  lineTotal: number;
};

export type CostStatus = "known" | "missing" | "estimated";

export type ProfitLineOut = {
  id: string;
  costStatus: CostStatus;
  unitCost: number | null;
  lineCost: number | null;
  lineProfit: number | null;
  netRevenue: number;
  /** ราคาขายต่อกิโล ณ ตอน sync — เฉพาะของสดที่ขายเป็นกก. */
  pricePerKg: number | null;
};

export type ProfitBillOut = {
  lines: ProfitLineOut[];
  profit: number;
  costAmount: number;
  knownRevenue: number;
  knownProfit: number;
  missingRevenue: number;
  missingLineCount: number;
  estimatedProfit: number;
  estimatedRevenue: number;
};

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

/** ไม่เอามาจัดอันดับขายดี */
export const FRESH_SKIP = new Set(["900011", "900017"]);
/** ของสดที่นับเป็นชิ้น ไม่แปลงเป็นกิโล */
export const FRESH_BY_PIECE = new Set(["900059"]);

/** บาร์สินค้า 6 หลักของของสด จากบิล (บาร์ฝังราคา 13 หลัก หรือบาร์ 6 หลัก) */
export function freshProductCode(line: {
  barcode: string;
  productCode?: string | null;
}): string | null {
  const barcode = String(line.barcode ?? "").trim();
  if (/^9\d{12}$/.test(barcode)) return barcode.slice(1, 7);
  const code = String(line.productCode ?? "").trim();
  if (/^9\d{5}$/.test(code)) return code;
  if (/^9\d{5}$/.test(barcode)) return barcode;
  return null;
}

export function pricePerKgForLine(
  line: { barcode: string; productCode?: string | null },
  lookup: CostLookup,
): number | null {
  const code = freshProductCode(line);
  // ข้ามเฉพาะของที่ไม่ใช่ขายตามโล (900011 อื่นๆ) · 900059 หมูแดดยังต้องได้ราคา/กก. เพื่อคิดทุน
  if (!code || FRESH_SKIP.has(code)) return null;
  const hit =
    lookup.byBarcode.get(code) ??
    (line.productCode?.trim()
      ? lookup.byCode.get(line.productCode.trim())
      : undefined);
  const price = hit?.sellPrice;
  if (price == null || !(price > 0)) return null;
  return round2(price);
}

/** ของสดขายเป็นกก. (บาร์ขึ้นต้น 9 ยกเว้นชิ้น/ข้าม) */
export function isFreshKgProduct(line: {
  barcode: string;
  productCode?: string | null;
}): boolean {
  const code = freshProductCode(line);
  return Boolean(code && !FRESH_SKIP.has(code) && !FRESH_BY_PIECE.has(code));
}

/**
 * ปริมาณที่ใช้คูณทุน:
 * ถ้ามีราคาขาย/กก. = ยอดขาย ÷ ราคาขาย/กก. (น้ำหนักจริง — ของสดหรือแพ็คที่ขายตามโล)
 * อื่นๆ = qty ในบิล
 */
export function costBasisQty(
  line: { barcode: string; productCode?: string | null; qty: number },
  netRevenue: number,
  pricePerKg: number | null,
): number {
  if (pricePerKg != null && pricePerKg > 0 && netRevenue > 0) {
    return netRevenue / pricePerKg;
  }
  return Number(line.qty) || 0;
}

export type FreshRankRow = {
  code: string;
  name: string;
  unit: "กก." | "ชิ้น";
  qty: number;
  amount: number;
};

/** กิโล = ยอดบรรทัด ÷ ราคาต่อกิโลที่เก็บในบิล · 900059 นับชิ้นจากจำนวน */
export function rankFreshLines(
  lines: Array<{
    barcode: string;
    productCode?: string | null;
    name: string;
    qty: number;
    lineTotal: number;
    pricePerKg: number | null;
  }>,
): {
  kg: FreshRankRow[];
  piece: FreshRankRow[];
  missingPriceCount: number;
  missingPriceAmount: number;
} {
  const kgMap = new Map<string, FreshRankRow>();
  const pieceMap = new Map<string, FreshRankRow>();
  let missingPriceCount = 0;
  let missingPriceAmount = 0;

  for (const line of lines) {
    const code = freshProductCode(line);
    if (!code || FRESH_SKIP.has(code)) continue;
    const amount = Number(line.lineTotal) || 0;
    const name = (line.name || code).trim();
    if (FRESH_BY_PIECE.has(code)) {
      const cur = pieceMap.get(code) ?? {
        code,
        name,
        unit: "ชิ้น" as const,
        qty: 0,
        amount: 0,
      };
      cur.qty += Number(line.qty) || 0;
      cur.amount += amount;
      if (name) cur.name = name;
      pieceMap.set(code, cur);
      continue;
    }
    const perKg = line.pricePerKg;
    if (perKg == null || !(perKg > 0)) {
      missingPriceCount += 1;
      missingPriceAmount += amount;
      continue;
    }
    const cur = kgMap.get(code) ?? {
      code,
      name,
      unit: "กก." as const,
      qty: 0,
      amount: 0,
    };
    cur.qty += amount / perKg;
    cur.amount += amount;
    if (name) cur.name = name;
    kgMap.set(code, cur);
  }

  const roundRow = (r: FreshRankRow): FreshRankRow => ({
    ...r,
    qty: Math.round(r.qty * 100) / 100,
    amount: Math.round(r.amount * 100) / 100,
  });
  const byQty = (a: FreshRankRow, b: FreshRankRow) => b.qty - a.qty;
  return {
    kg: [...kgMap.values()].map(roundRow).sort(byQty).slice(0, 12),
    piece: [...pieceMap.values()].map(roundRow).sort(byQty),
    missingPriceCount,
    missingPriceAmount: Math.round(missingPriceAmount * 100) / 100,
  };
}

function prefer(a: CostCatalogItem, b: CostCatalogItem) {
  if (a.deleted !== b.deleted) return a.deleted ? b : a;
  if (a.active !== b.active) return a.active ? a : b;
  return a.updatedAt >= b.updatedAt ? a : b;
}

export function buildCostLookup(items: CostCatalogItem[]): CostLookup {
  const byCode = new Map<string, CostCatalogItem>();
  const byBarcode = new Map<string, CostCatalogItem>();
  for (const item of items) {
    const code = item.productCode?.trim();
    if (code) {
      const prev = byCode.get(code);
      byCode.set(code, prev ? prefer(prev, item) : item);
    }
    const barcode = item.barcode.trim();
    if (barcode) {
      const prev = byBarcode.get(barcode);
      byBarcode.set(barcode, prev ? prefer(prev, item) : item);
    }
  }
  return { byCode, byBarcode };
}

export function findCostItem(
  lookup: CostLookup,
  line: { barcode: string; productCode?: string | null },
) {
  const barcode = line.barcode.trim();
  const code = line.productCode?.trim();
  const fresh = freshProductCode(line);

  // ยึดบาร์/PLU ก่อน SKU — บิลเก่าอาจติดรหัสผิด (เช่น หมูแดด 900059 แต่ SKU-00000159)
  if (barcode && lookup.byBarcode.has(barcode)) {
    return lookup.byBarcode.get(barcode) ?? null;
  }
  if (fresh && lookup.byBarcode.has(fresh)) {
    return lookup.byBarcode.get(fresh) ?? null;
  }
  if (code && lookup.byCode.has(code)) return lookup.byCode.get(code) ?? null;
  return null;
}

function allocateNet(lineTotals: number[], billDiscount: number) {
  const gross = lineTotals.reduce((s, n) => s + n, 0);
  const discount = Math.min(Math.max(0, billDiscount), Math.max(0, gross));
  const target = round2(gross - discount);
  if (!lineTotals.length) return [];
  let assigned = 0;
  return lineTotals.map((total, i) => {
    if (i === lineTotals.length - 1) return round2(target - assigned);
    const net =
      gross > 0 ? round2((total * (gross - discount)) / gross) : 0;
    assigned = round2(assigned + net);
    return net;
  });
}

/** สินค้าเปิดราคา / ของเก่า SKU-00000128 (เบ็ดเตล็ด) */
export function isOpenPriceLine(
  line: { productCode?: string | null; name?: string | null; barcode?: string },
  hit?: CostCatalogItem | null,
): boolean {
  if (hit?.isOpenPrice) return true;
  const code = String(line.productCode ?? "").trim().toUpperCase();
  if (code === "OPENPRICE" || code === "SKU-00000128") return true;
  if (/เบ็ดเตล็ด/.test(String(line.name ?? ""))) return true;
  const barcode = String(line.barcode ?? "").trim().toUpperCase();
  if (barcode.startsWith("OPENPRICE")) return true;
  return false;
}

/** % กำไรประมาณการ — เปิดราคา 15% หรือของสดที่กำหนด เช่น 900011 = 20% */
export function estimatedMarginRate(
  line: {
    barcode: string;
    productCode?: string | null;
    name?: string | null;
  },
  hit?: CostCatalogItem | null,
): number | null {
  if (isOpenPriceLine(line, hit)) return OPEN_PRICE_MARGIN;
  const fresh = freshProductCode(line);
  if (fresh && ESTIMATED_MARGIN_BY_FRESH_CODE[fresh] != null) {
    return ESTIMATED_MARGIN_BY_FRESH_CODE[fresh];
  }
  const b = String(hit?.barcode ?? line.barcode ?? "").trim();
  if (/^9\d{5}$/.test(b) && ESTIMATED_MARGIN_BY_FRESH_CODE[b] != null) {
    return ESTIMATED_MARGIN_BY_FRESH_CODE[b];
  }
  return null;
}

function estimatedMarginLine(
  id: string,
  netRevenue: number,
  qty: number,
  pricePerKg: number | null,
  margin: number,
): ProfitLineOut {
  const lineProfit = round2(netRevenue * margin);
  const lineCost = round2(netRevenue - lineProfit);
  return {
    id,
    costStatus: "estimated",
    unitCost: qty > 0 ? round2(lineCost / qty) : null,
    lineCost,
    lineProfit,
    netRevenue,
    pricePerKg,
  };
}

/** Snapshot กำไรจากทุนในแอดมิน — ไม่ใช้ทุนที่ POS ส่งมา */
export function priceBillProfit(
  lines: ProfitLineIn[],
  billDiscount: number,
  lookup: CostLookup,
): ProfitBillOut {
  const nets = allocateNet(
    lines.map((l) => Number(l.lineTotal) || 0),
    billDiscount,
  );
  const out: ProfitLineOut[] = lines.map((line, i) => {
    const netRevenue = nets[i] ?? 0;
    const hit = findCostItem(lookup, line);
    const qty = Number(line.qty) || 0;
    const pricePerKg = pricePerKgForLine(line, lookup);
    const margin = estimatedMarginRate(line, hit);
    if (margin != null) {
      return estimatedMarginLine(line.id, netRevenue, qty, pricePerKg, margin);
    }
    if (hit?.costPrice != null && Number.isFinite(hit.costPrice)) {
      const unitCost = round2(hit.costPrice);
      const basis = costBasisQty(line, netRevenue, pricePerKg);
      const lineCost = round2(unitCost * basis);
      return {
        id: line.id,
        costStatus: "known",
        unitCost,
        lineCost,
        lineProfit: round2(netRevenue - lineCost),
        netRevenue,
        pricePerKg,
      };
    }
    return {
      id: line.id,
      costStatus: "missing",
      unitCost: null,
      lineCost: null,
      lineProfit: null,
      netRevenue,
      pricePerKg,
    };
  });

  let profit = 0;
  let costAmount = 0;
  let knownRevenue = 0;
  let knownProfit = 0;
  let missingRevenue = 0;
  let missingLineCount = 0;
  let estimatedProfit = 0;
  let estimatedRevenue = 0;
  for (const line of out) {
    if (line.costStatus === "missing") {
      missingRevenue += line.netRevenue;
      missingLineCount += 1;
      continue;
    }
    profit += line.lineProfit ?? 0;
    costAmount += line.lineCost ?? 0;
    if (line.costStatus === "estimated") {
      estimatedProfit += line.lineProfit ?? 0;
      estimatedRevenue += line.netRevenue;
    } else {
      knownProfit += line.lineProfit ?? 0;
      knownRevenue += line.netRevenue;
    }
  }

  return {
    lines: out,
    profit: round2(profit),
    costAmount: round2(costAmount),
    knownRevenue: round2(knownRevenue),
    knownProfit: round2(knownProfit),
    missingRevenue: round2(missingRevenue),
    missingLineCount,
    estimatedProfit: round2(estimatedProfit),
    estimatedRevenue: round2(estimatedRevenue),
  };
}
