import { defineStore } from "pinia";
import { computed, ref } from "vue";
import {
  applyBundlePromos,
  earnPoints,
  parseBarcode,
  recalcLine,
  summarizeCart,
  validateCashTender,
  type AppliedPromo,
  type BundlePromo,
  type CartLine,
  type CartSnapshot,
} from "@ap-pos/shared";
import { DEMO_PRODUCTS, type QuickProduct } from "../data/demo-products";
import { fetchCatalogProducts } from "../services/catalog";
import { useMembersStore } from "./members";
import { useSessionStore } from "./session";

export type { QuickProduct };
export type PaymentMethod = "cash" | "transfer" | "government" | "points";

export type PaymentEntry = {
  method: PaymentMethod;
  /** จำนวนที่นับเข้ายอดบิล (บาท) — แต้มใช้ 1:1 */
  amount: number;
  /** เงินสดที่รับมา (ถ้ารับเกินจะมีทอน) */
  tendered?: number;
};

export type HeldBill = {
  id: string;
  label: string;
  heldAt: string;
  lines: CartLine[];
  manualDiscount: number;
  memberId: string | null;
  memberName: string;
  memberPoints: number;
};

/** Demo: ผักกาดขาว / น้ำจิ้ม ชิ้นละ 35 → 3 ชิ้น 100 บาท (ลด 5) */
const DEMO_PROMOS: BundlePromo[] = [
  {
    id: "promo-cabbage-3for100",
    productCode: "00007",
    buyQty: 3,
    payAmount: 100,
    label: "ผักกาดขาว 3 ชิ้น 100 บาท",
  },
  {
    id: "promo-sauce-3for100",
    productCode: "00011",
    buyQty: 3,
    payAmount: 100,
    label: "น้ำจิ้มซีฟู้ด 3 ขวด 100 บาท",
  },
];

function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export const useCartStore = defineStore("cart", () => {
  const lines = ref<CartLine[]>([]);
  const manualDiscount = ref(0);
  const paid = ref(0);
  const statusMessage = ref("พร้อมขาย");
  const quickProducts = ref<QuickProduct[]>(DEMO_PRODUCTS);
  const catalogSource = ref<"api" | "local">("local");
  const promos = ref(DEMO_PROMOS);
  const revision = ref(0);
  const lastPaymentMethod = ref<PaymentMethod | null>(null);
  const memberId = ref<string | null>(null);
  const memberName = ref("ลูกค้าทั่วไป");
  /** แต้มคงเหลือก่อนหน้า (ใช้ชำระบิลนี้ได้) */
  const memberPoints = ref(0);
  /** จำนวนที่จะใส่ในรายการถัดไปจาก 3* แล้วยิงบาร์ */
  const pendingQty = ref(1);
  const heldBills = ref<HeldBill[]>([]);
  /** แต้มที่จะได้จากบิลนี้ (ใช้รอบหน้า) — คำนวณสดตอนชำระ */
  const lastPointsEarned = ref(0);
  /** เงินทอนบิลล่าสุด — โชว์ที่หน้ารายการจนกว่าจะมีสินค้าบิลใหม่ */
  const lastChange = ref(0);

  function clearLastChange() {
    if (lastChange.value === 0) return;
    lastChange.value = 0;
  }

  function isQuickTileProduct(p: QuickProduct): boolean {
    // หลังบ้านเป็นคนเลือก — ต้องติดธง isQuick
    if (!p.isQuick) return false;
    if (p.isOpenPrice) return false;
    // สินค้าด่วนต้องกดแล้วขายได้เลย — ไม่เอาพวกบาร์โค้ดราคา (ชั่ง/ฝังราคา)
    if (p.price == null) return false;
    const b = (p.barcode ?? "").trim();
    if (!b || /^misc$/i.test(b)) return false;
    return true;
  }

  /** สินค้าด่วนบนจอ — ตามที่หลังบ้านตั้ง (isQuick + ลำดับ quickSort) */
  const quickTiles = computed(() =>
    quickProducts.value
      .filter(isQuickTileProduct)
      .slice()
      .sort((a, b) => (a.quickSort ?? 999) - (b.quickSort ?? 999)),
  );

  const openPriceProduct = computed(
    () =>
      quickProducts.value.find((p) => p.isOpenPrice) ??
      quickProducts.value.find((p) => p.productCode === "99999") ??
      null,
  );

  const promoResult = computed(() =>
    applyBundlePromos(lines.value, promos.value),
  );

  const appliedPromos = computed<AppliedPromo[]>(
    () => promoResult.value.applied,
  );

  const billDiscount = computed(() =>
    round2(promoResult.value.promoDiscount + Math.max(0, manualDiscount.value)),
  );

  const summary = computed(() =>
    summarizeCart(lines.value, billDiscount.value, paid.value),
  );

  /** แต้มที่จะได้จากยอดสุทธิ (ยังไม่หักแต้มที่ใช้) — UI ชำระจะหัก redeem เอง */
  const pointsToEarnPreview = computed(() =>
    earnPoints(summary.value.total),
  );

  const snapshot = computed<CartSnapshot>(() => ({
    ...summary.value,
    // จอลูกค้า / หลังชำระ — ใช้ทอนบิลล่าสุด (summary.change หลังเคลียร์บิลเป็น 0)
    change: lastChange.value,
    memberName: memberName.value,
    memberPoints: memberPoints.value,
  }));

  function bump() {
    revision.value += 1;
  }

  function publish() {
    window.apPos?.publishCart(snapshot.value);
  }

  async function loadCatalog() {
    const products = await fetchCatalogProducts();
    quickProducts.value = products;
    catalogSource.value = products.some((p) => p.id.startsWith("p-000") || p.id === "p-misc")
      ? "api"
      : "local";
    statusMessage.value =
      catalogSource.value === "api"
        ? `โหลดสินค้า ${products.length} · ด่วน ${products.filter((p) => p.isQuick).length} รายการ`
        : `ใช้สินค้า offline ${products.length} รายการ`;
  }

  function setPendingQty(qty: number) {
    const n = Math.floor(qty);
    if (!Number.isFinite(n) || n <= 0) {
      pendingQty.value = 1;
      return;
    }
    pendingQty.value = Math.min(999, n);
    statusMessage.value = `คูณ x${pendingQty.value} — ยิงบาร์โค้ดหรือเลือกสินค้า`;
  }

  function consumePendingQty(): number {
    const q = pendingQty.value;
    pendingQty.value = 1;
    return q;
  }

  function addLine(input: {
    barcode: string;
    name: string;
    unit: string;
    unitPrice: number;
    qty?: number;
    productCode?: string;
  }) {
    clearLastChange();
    const qty = input.qty ?? consumePendingQty();
    const line = recalcLine({
      id: uid(),
      barcode: input.barcode,
      productCode: input.productCode,
      name: input.name,
      qty,
      unit: input.unit,
      unitPrice: input.unitPrice,
      discount: 0,
    });
    lines.value = [...lines.value, line];
    statusMessage.value =
      qty > 1
        ? `เพิ่ม: ${line.name} x${qty} @ ${line.unitPrice.toFixed(2)}`
        : `เพิ่ม: ${line.name} ${line.unitPrice.toFixed(2)}`;
    bump();
    publish();
  }

  function addOpenPrice(amount: number) {
    const product = openPriceProduct.value;
    if (!product) {
      statusMessage.value = "ยังไม่ได้ตั้งสินค้าเบ็ดเตล็ด";
      return;
    }
    const max = product.openPriceMax ?? 100;
    if (amount > max) {
      statusMessage.value = `ราคาเบ็ดเตล็ดต้องไม่เกิน ${max} บาท`;
      return;
    }
    addLine({
      barcode: product.barcode,
      productCode: product.productCode,
      name: product.name,
      unit: product.unit,
      unitPrice: amount,
      qty: consumePendingQty(),
    });
  }

  function scan(raw: string) {
    let text = raw.trim();
    let forcedQty: number | null = null;

    // รูปแบบ 3*8850... หรือ 3*
    const mulMatch = text.match(/^(\d+)\*(.*)$/);
    if (mulMatch) {
      const n = Number(mulMatch[1]);
      const rest = mulMatch[2].trim();
      if (Number.isFinite(n) && n > 0) {
        if (!rest) {
          setPendingQty(n);
          return;
        }
        forcedQty = Math.min(999, Math.floor(n));
        text = rest;
      }
    }

    if (forcedQty != null) {
      pendingQty.value = forcedQty;
    }

    // สินค้าเบ็ดเตล็ด: พิมพ์ราคา เช่น 55 (ไม่เกิน openPriceMax)
    const openProduct = openPriceProduct.value;
    const max = openProduct?.openPriceMax ?? 100;
    if (openProduct && /^\d{1,3}([.]\d{1,2})?$/.test(text)) {
      const amount = Number(text);
      if (Number.isFinite(amount) && amount > 0 && amount <= max) {
        addOpenPrice(Math.round(amount * 100) / 100);
        return;
      }
      if (Number.isFinite(amount) && amount > max) {
        pendingQty.value = 1;
        statusMessage.value = `ราคาเบ็ดเตล็ดต้องไม่เกิน ${max} บาท`;
        return;
      }
    }

    const parsed = parseBarcode(text);
    if (parsed.kind === "priceEmbedded") {
      if (!parsed.validCheckDigit) {
        pendingQty.value = 1;
        statusMessage.value = "บาร์โค้ดราคา: check digit ไม่ถูกต้อง";
        return;
      }
      const product =
        quickProducts.value.find((p) => p.productCode === parsed.productCode) ??
        null;
      addLine({
        barcode: parsed.barcode,
        productCode: parsed.productCode,
        name: product?.name ?? `สินค้า ${parsed.productCode}`,
        unit: product?.unit ?? "กก.",
        unitPrice: parsed.price,
      });
      return;
    }

    const product = quickProducts.value.find((p) => p.barcode === parsed.barcode);
    if (!product) {
      pendingQty.value = 1;
      statusMessage.value = `ไม่พบสินค้า: ${parsed.barcode}`;
      return;
    }
    if (product.isOpenPrice) {
      statusMessage.value = `พิมพ์ราคา 1-${product.openPriceMax ?? 100} แล้ว Enter`;
      return;
    }
    if (product.price == null) {
      pendingQty.value = 1;
      statusMessage.value = `${product.name} ต้องใช้บาร์โค้ดราคา`;
      return;
    }
    addLine({
      barcode: product.barcode,
      productCode: product.productCode,
      name: product.name,
      unit: product.unit,
      unitPrice: product.price,
    });
  }

  function addQuick(product: QuickProduct) {
    if (product.isOpenPrice) {
      statusMessage.value = `พิมพ์ราคา 1-${product.openPriceMax ?? 100} แล้ว Enter (${product.name})`;
      return;
    }
    if (product.price == null) {
      statusMessage.value = `${product.name} ต้องสแกนบาร์โค้ดราคา`;
      return;
    }
    addLine({
      barcode: product.barcode,
      productCode: product.productCode,
      name: product.name,
      unit: product.unit,
      unitPrice: product.price,
    });
  }

  function searchProducts(query: string): QuickProduct[] {
    const q = query.trim().toLowerCase();
    const list = quickProducts.value.filter((p) => !p.isOpenPrice);
    if (!q) return list.slice(0, 8);
    return list
      .filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.barcode.includes(q) ||
          p.productCode.includes(q),
      )
      .slice(0, 8);
  }

  function multiplyLast(factor: number) {
    if (!lines.value.length || factor <= 0) return;
    const last = lines.value[lines.value.length - 1];
    const updated = recalcLine({ ...last, qty: factor });
    lines.value = [...lines.value.slice(0, -1), updated];
    statusMessage.value = `คูณจำนวน x${factor}`;
    bump();
    publish();
  }

  function removeLast() {
    if (!lines.value.length) return;
    removeAt(lines.value.length - 1);
  }

  function removeAt(index: number) {
    if (index < 0 || index >= lines.value.length) return;
    const removed = lines.value[index];
    const billTotalBefore = summary.value.total;
    const itemCountBefore = summary.value.itemCount;
    lines.value = lines.value.filter((_, i) => i !== index);

    const session = useSessionStore();
    session.recordAudit({
      type: "line_void",
      barcode: removed.barcode,
      productName: removed.name,
      qty: removed.qty,
      amount: removed.lineTotal,
      billTotalBefore,
      itemCountBefore,
    });

    statusMessage.value = `ยกเลิกรายการ: ${removed.name} (บันทึกประวัติแล้ว)`;
    bump();
    publish();
  }

  function clearBill(opts?: {
    keepMember?: boolean;
    /** paid = หลังชำระสำเร็จ, hold = พักบิล — ไม่นับเป็นยกเลิกโกง */
    reason?: "cancel" | "paid" | "hold";
  }) {
    const reason = opts?.reason ?? "cancel";
    if (reason === "cancel" && lines.value.length > 0) {
      const session = useSessionStore();
      session.recordAudit({
        type: "bill_cancel",
        amount: summary.value.total,
        billTotalBefore: summary.value.total,
        itemCountBefore: summary.value.itemCount,
      });
    }

    lines.value = [];
    manualDiscount.value = 0;
    paid.value = 0;
    lastPaymentMethod.value = null;
    pendingQty.value = 1;
    if (!opts?.keepMember) {
      clearMember();
    }
    statusMessage.value =
      reason === "cancel" ? "ยกเลิกบิลแล้ว (บันทึกประวัติแล้ว)" : "พร้อมรับบิลใหม่";
    bump();
    publish();
  }

  function setManualDiscount(amount: number) {
    manualDiscount.value = Math.max(0, amount);
    publish();
  }

  function setPaid(amount: number) {
    paid.value = amount;
    publish();
  }

  function setMember(member: { id: string; name: string; points: number }) {
    memberId.value = member.id;
    memberName.value = member.name;
    memberPoints.value = Math.max(0, Math.floor(member.points));
    statusMessage.value = `สมาชิก: ${member.name} (${memberPoints.value} แต้ม)`;
    publish();
  }

  function clearMember() {
    memberId.value = null;
    memberName.value = "ลูกค้าทั่วไป";
    memberPoints.value = 0;
    publish();
  }

  function holdBill(label?: string): boolean {
    if (!lines.value.length) {
      statusMessage.value = "ไม่มีรายการให้พักบิล";
      return false;
    }
    const bill: HeldBill = {
      id: uid(),
      label: label?.trim() || `พัก #${heldBills.value.length + 1}`,
      heldAt: new Date().toISOString(),
      lines: lines.value.map((l) => ({ ...l })),
      manualDiscount: manualDiscount.value,
      memberId: memberId.value,
      memberName: memberName.value,
      memberPoints: memberPoints.value,
    };
    heldBills.value = [...heldBills.value, bill];
    lines.value = [];
    manualDiscount.value = 0;
    paid.value = 0;
    pendingQty.value = 1;
    clearMember();
    statusMessage.value = `พักบิลแล้ว (${bill.label}) — มี ${heldBills.value.length} บิลพัก`;
    bump();
    publish();
    return true;
  }

  function recallBill(id: string): boolean {
    const idx = heldBills.value.findIndex((b) => b.id === id);
    if (idx < 0) return false;
    if (lines.value.length) {
      statusMessage.value = "มีรายการบนจอ — พักบิลปัจจุบันหรือยกเลิกก่อนเรียกบิล";
      return false;
    }
    const bill = heldBills.value[idx];
    heldBills.value = heldBills.value.filter((_, i) => i !== idx);
    clearLastChange();
    lines.value = bill.lines.map((l) => ({ ...l }));
    manualDiscount.value = bill.manualDiscount;
    if (bill.memberId) {
      memberId.value = bill.memberId;
      memberName.value = bill.memberName;
      memberPoints.value = bill.memberPoints;
    } else {
      clearMember();
    }
    statusMessage.value = `เรียกบิล: ${bill.label}`;
    bump();
    publish();
    return true;
  }

  function deleteHeldBill(id: string) {
    const bill = heldBills.value.find((b) => b.id === id);
    if (!bill) return false;
    heldBills.value = heldBills.value.filter((b) => b.id !== id);
    statusMessage.value = `ลบบิลพักแล้ว (${bill.label}) · เหลือ ${heldBills.value.length} บิล`;
    return true;
  }

  function clearHeldBills() {
    const n = heldBills.value.length;
    heldBills.value = [];
    if (n > 0) {
      statusMessage.value = `เคลียร์บิลพัก ${n} บิลแล้ว`;
    }
  }

  /**
   * ชำระแบบผสมได้หลายวิธี
   * - เงินสดรับเกินได้ (ทอน)
   * - โอน / รัฐ / แต้ม ห้ามเกินยอดคงเหลือ
   */
  function completePayment(payments: PaymentEntry[]): boolean {
    const total = summary.value.total;
    if (!lines.value.length) {
      statusMessage.value = "ไม่มีรายการให้ชำระ";
      return false;
    }
    if (!payments.length) {
      statusMessage.value = "ยังไม่ได้ใส่การชำระ";
      return false;
    }

    let covered = 0;
    let cashTendered = 0;
    let pointsUsed = 0;
    const normalized: PaymentEntry[] = [];

    for (const p of payments) {
      const remaining = round2(total - covered);
      if (remaining <= 1e-9) break;

      if (p.method === "cash") {
        const tendered = round2(p.tendered ?? p.amount);
        const check = validateCashTender(tendered, remaining);
        if (!check.ok) {
          statusMessage.value = check.reason;
          return false;
        }
        cashTendered = round2(cashTendered + check.tendered);
        covered = round2(covered + check.applied);
        normalized.push({
          method: "cash",
          amount: check.applied,
          tendered: check.tendered,
        });
        continue;
      }

      const amount = round2(p.amount);
      if (amount <= 0) {
        statusMessage.value = "จำนวนชำระต้องมากกว่า 0";
        return false;
      }
      if (amount > remaining + 1e-9) {
        statusMessage.value =
          p.method === "points"
            ? "ใช้แต้มเกินยอดคงเหลือไม่ได้"
            : "ชำระเกินยอดคงเหลือไม่ได้ (ยกเว้นเงินสด)";
        return false;
      }
      if (p.method === "points") {
        const pts = Math.floor(amount);
        if (pts > memberPoints.value) {
          statusMessage.value = "แต้มไม่พอ";
          return false;
        }
        pointsUsed += pts;
      }
      covered = round2(covered + amount);
      normalized.push({ method: p.method, amount });
    }

    if (covered + 1e-9 < total) {
      statusMessage.value = `ชำระยังไม่ครบ ขาด ${(total - covered).toFixed(2)} บาท`;
      return false;
    }

    const change = round2(Math.max(0, cashTendered - normalized
      .filter((p) => p.method === "cash")
      .reduce((s, p) => s + p.amount, 0)));

    // แต้มที่ได้จากยอดหลังหักแต้มที่ใช้ (ใช้รอบหน้า)
    const netForEarn = Math.max(0, total - pointsUsed);
    const earned = earnPoints(netForEarn);
    lastPointsEarned.value = earned;

    const members = useMembersStore();
    if (memberId.value) {
      members.adjustPoints(memberId.value, -pointsUsed + earned);
      const updated = members.findById(memberId.value);
      if (updated) memberPoints.value = updated.points;
    }

    const session = useSessionStore();
    const sale = session.recordSale({
      total,
      payments: normalized.map((p) => ({ method: p.method, amount: p.amount })),
      cashTendered,
      change,
      pointsRedeemed: pointsUsed,
      pointsEarned: earned,
      memberName: memberName.value,
    });

    paid.value = cashTendered || total;
    lastPaymentMethod.value = normalized[normalized.length - 1]?.method ?? null;

    const parts = normalized
      .map((p) => {
        if (p.method === "cash") return `สด ${p.amount.toFixed(2)}`;
        if (p.method === "transfer") return `โอน ${p.amount.toFixed(2)}`;
        if (p.method === "government") return `รัฐ ${p.amount.toFixed(2)}`;
        return `แต้ม ${Math.floor(p.amount)}`;
      })
      .join(" + ");

    statusMessage.value =
      `บิล ${sale.billNo} ชำระแล้ว (${parts})` +
      (change > 0 ? ` ทอน ${change.toFixed(2)}` : "") +
      (earned > 0 ? ` · ได้ ${earned} แต้ม (ใช้รอบหน้า)` : "");

    // พิมพ์สลิป / เปิดลิ้นชัก — ยังไม่ต่อฮาร์ดแวร์จริง
    // window.apPos?.openDrawer?.(); window.apPos?.printReceipt?.(sale);

    lastChange.value = change;
    const doneMsg = statusMessage.value;
    clearBill({ reason: "paid" });
    statusMessage.value = doneMsg;
    publish();
    return true;
  }

  return {
    lines,
    manualDiscount,
    paid,
    statusMessage,
    quickProducts,
    quickTiles,
    catalogSource,
    promos,
    revision,
    lastPaymentMethod,
    memberId,
    memberName,
    memberPoints,
    pendingQty,
    heldBills,
    lastPointsEarned,
    lastChange,
    openPriceProduct,
    promoResult,
    appliedPromos,
    billDiscount,
    summary,
    pointsToEarnPreview,
    snapshot,
    loadCatalog,
    scan,
    addQuick,
    addOpenPrice,
    searchProducts,
    setPendingQty,
    consumePendingQty,
    multiplyLast,
    removeLast,
    removeAt,
    clearBill,
    setManualDiscount,
    setPaid,
    setMember,
    clearMember,
    holdBill,
    recallBill,
    deleteHeldBill,
    clearHeldBills,
    completePayment,
    publish,
  };
});

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
