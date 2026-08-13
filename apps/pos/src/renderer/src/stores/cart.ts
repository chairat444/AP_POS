import { defineStore } from "pinia";
import { computed, ref } from "vue";
import {
  applyBundlePromos,
  earnPoints,
  maxRedeemablePoints,
  parseBarcode,
  recalcLine,
  redeemDiscountBaht,
  summarizeCart,
  validateCashTender,
  type AppliedPromo,
  type BundlePromo,
  type CartLine,
  type CartPaymentLine,
  type CartSnapshot,
} from "@ap-pos/shared";
import { DEMO_PRODUCTS, type QuickProduct } from "../data/demo-products";
import { enqueueSaleAndSync, getDeviceConfig, loadCachedProducts } from "../services/sync";
import {
  loadPrinterConfig,
  paymentLabel,
  printReceipt,
  type ReceiptPayload,
} from "../services/receipt";
import { useMembersStore } from "./members";
import { useSessionStore } from "./session";
import { useSettingsStore } from "./settings";

export type { QuickProduct };
export type PaymentMethod = "cash" | "transfer" | "government" | "points";

export type PaymentEntry = {
  /** points ไม่ใช้เป็นวิธีชำระแล้ว — คง type ไว้กันของเก่าในหน่วยความจำ */
  method: PaymentMethod;
  /** จำนวนที่นับเข้ายอดบิล (บาท) */
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
  pointsDiscount: number;
  memberId: string | null;
  memberName: string;
  memberPoints: number;
};

/** ไม่มีโปรโมชัน demo ในเครื่อง */
const DEMO_PROMOS: BundlePromo[] = [];

function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export const useCartStore = defineStore("cart", () => {
  const lines = ref<CartLine[]>([]);
  const manualDiscount = ref(0);
  /** ส่วนลดจากใช้แต้ม (บาท) — นับเป็นส่วนลดท้ายบิล ไม่ใช่วิธีชำระ */
  const pointsDiscount = ref(0);
  const paid = ref(0);
  const statusMessage = ref("พร้อมขาย");
  const quickProducts = ref<QuickProduct[]>(DEMO_PRODUCTS);
  const catalogSource = ref<"api" | "local">("local");
  const promos = ref<BundlePromo[]>([...DEMO_PROMOS]);
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
  /** รายการบิลล่าสุดค้างบนจอลูกค้าหลังชำระ */
  const lastReceipt = ref<{
    lines: CartLine[];
    itemCount: number;
    subtotal: number;
    discount: number;
    total: number;
    memberName: string;
    memberPoints: number;
    pointsUsable: number;
    pointsToEarn: number;
  } | null>(null);
  let lastChangeClearTimer: ReturnType<typeof setTimeout> | null = null;
  const RECEIPT_HOLD_MS = 3 * 60_000; // ค้างจอลูกค้า 3 นาที หรือจนมีบิลใหม่

  /** สถานะชำระที่ส่งไปจอลูกค้า */
  const payProgress = ref<{
    active: boolean;
    paid: number;
    remaining: number;
    change: number;
    lines: CartPaymentLine[];
  } | null>(null);

  function clearLastChange() {
    if (lastChangeClearTimer != null) {
      clearTimeout(lastChangeClearTimer);
      lastChangeClearTimer = null;
    }
    const had =
      lastChange.value !== 0 || lastReceipt.value != null;
    lastChange.value = 0;
    lastReceipt.value = null;
    if (!had) return;
  }

  function holdPaidReceipt(
    change: number,
    receipt: NonNullable<typeof lastReceipt.value>,
  ) {
    if (lastChangeClearTimer != null) {
      clearTimeout(lastChangeClearTimer);
      lastChangeClearTimer = null;
    }
    lastReceipt.value = receipt;
    lastChange.value = change;
    lastChangeClearTimer = setTimeout(() => {
      lastChangeClearTimer = null;
      lastChange.value = 0;
      lastReceipt.value = null;
      publish();
    }, RECEIPT_HOLD_MS);
  }

  function setPayProgress(next: {
    paid: number;
    remaining: number;
    change: number;
    lines: CartPaymentLine[];
  } | null) {
    if (!next) {
      if (!payProgress.value?.active) return;
      payProgress.value = null;
      publish();
      return;
    }
    payProgress.value = {
      active: true,
      paid: next.paid,
      remaining: next.remaining,
      change: next.change,
      lines: next.lines.map((l) => ({ ...l })),
    };
    publish();
  }

  function clearPayProgress() {
    setPayProgress(null);
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

  /** ดัชนีค้นหาบาร์โค้ด/รหัส — O(1) ตอนยิงสแกน */
  const productByBarcode = computed(() => {
    const m = new Map<string, QuickProduct>();
    for (const p of quickProducts.value) {
      const b = (p.barcode ?? "").trim();
      if (b) m.set(b, p);
    }
    return m;
  });

  const productByCode = computed(() => {
    const m = new Map<string, QuickProduct>();
    for (const p of quickProducts.value) {
      const c = (p.productCode ?? "").trim();
      if (c) m.set(c, p);
    }
    return m;
  });

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
    round2(
      promoResult.value.promoDiscount +
        Math.max(0, manualDiscount.value) +
        Math.max(0, pointsDiscount.value),
    ),
  );

  const summary = computed(() =>
    summarizeCart(lines.value, billDiscount.value, paid.value),
  );

  /** จำนวนแต้มที่ใช้เป็นส่วนลดบิลนี้ */
  const pointsRedeemedPts = computed(() => {
    const settings = useSettingsStore();
    const rate = settings.pointsConfig.bahtPerRedeemPoint || 1;
    if (rate <= 0 || pointsDiscount.value <= 0) return 0;
    return Math.round(pointsDiscount.value / rate);
  });

  /** แต้มที่จะได้ — คิดจากยอดก่อนหักส่วนลดแต้ม (ใช้แต้มแล้วได้แต้มไม่หด) */
  const pointsToEarnPreview = computed(() => {
    const settings = useSettingsStore();
    const earnBase = round2(
      summary.value.total + Math.max(0, pointsDiscount.value),
    );
    return earnPoints(earnBase, settings.pointsConfig);
  });

  const snapshot = computed<CartSnapshot>(() => {
    // หลังจบบิล — ค้างรายการบนจอลูกค้าเฉพาะตอนตะกร้าว่าง (ยังไม่เริ่มบิลใหม่)
    if (
      lastReceipt.value &&
      !payProgress.value?.active &&
      lines.value.length === 0
    ) {
      const r = lastReceipt.value;
      return {
        lines: r.lines.map((l) => ({ ...l })),
        itemCount: r.itemCount,
        subtotal: r.subtotal,
        discount: r.discount,
        total: r.total,
        change: lastChange.value,
        memberName: r.memberName,
        memberPoints: r.memberPoints,
        pointsUsable: r.pointsUsable,
        pointsToEarn: r.pointsToEarn,
        pointsDiscount: 0,
        paying: false,
        paid: 0,
        remaining: 0,
        paymentLines: [],
        postPaid: true,
      };
    }
    const usable = Math.max(
      0,
      memberPoints.value - pointsRedeemedPts.value,
    );
    return {
      ...summary.value,
      // จอลูกค้า / หลังชำระ — ใช้ทอนบิลล่าสุด (summary.change หลังเคลียร์บิลเป็น 0)
      change: payProgress.value?.active
        ? payProgress.value.change
        : lastChange.value,
      memberName: memberName.value,
      memberPoints: memberPoints.value,
      pointsUsable: memberId.value ? usable : 0,
      pointsToEarn: memberId.value ? pointsToEarnPreview.value : 0,
      pointsDiscount: Math.max(0, pointsDiscount.value),
      paying: Boolean(payProgress.value?.active),
      paid: payProgress.value?.paid ?? 0,
      remaining: payProgress.value?.remaining ?? 0,
      paymentLines: payProgress.value?.lines ?? [],
      postPaid: false,
    };
  });

  function bump() {
    revision.value += 1;
  }

  function publish() {
    const s = snapshot.value;
    // ต้อง clone เป็น plain object — Vue proxy ส่ง IPC ไม่ครบ ทำให้จอลูกค้าว่าง
    const plain: CartSnapshot = {
      lines: s.lines.map((l) => ({
        id: l.id,
        barcode: l.barcode,
        productCode: l.productCode,
        name: l.name,
        qty: l.qty,
        unit: l.unit,
        unitPrice: l.unitPrice,
        discount: l.discount,
        lineTotal: l.lineTotal,
      })),
      itemCount: s.itemCount,
      subtotal: s.subtotal,
      discount: s.discount,
      total: s.total,
      change: s.change,
      memberName: s.memberName,
      memberPoints: s.memberPoints,
      pointsUsable: s.pointsUsable,
      pointsToEarn: s.pointsToEarn,
      pointsDiscount: s.pointsDiscount,
      paying: s.paying,
      paid: s.paid,
      remaining: s.remaining,
      paymentLines: (s.paymentLines ?? []).map((l) => ({ ...l })),
      postPaid: Boolean(s.postPaid),
    };
    window.apPos?.publishCart(plain);
  }

  /** ส่งจอลูกค้าหลัง paint — ไม่บล็อกการโผล่รายการตอนยิงบาร์โค้ด */
  let publishRaf = 0;
  function publishSoon() {
    if (publishRaf) return;
    publishRaf = requestAnimationFrame(() => {
      publishRaf = 0;
      try {
        publish();
      } catch {
        /* ignore */
      }
    });
  }

  async function loadCatalog() {
    const products = await loadCachedProducts();
    setCatalog(products, "local");
  }

  function setCatalog(products: QuickProduct[], source: "api" | "local") {
    quickProducts.value = products;
    catalogSource.value = source;
    statusMessage.value =
      source === "api"
        ? `โหลดสินค้า ${products.length} · ด่วน ${products.filter((p) => p.isQuick).length} รายการ`
        : `ใช้สินค้า offline ${products.length} รายการ`;
  }

  function setPromos(next: BundlePromo[]) {
    promos.value = next.map((p) => ({ ...p }));
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
    publishSoon();
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

  function scan(raw: string): {
    ok: boolean;
    notice?: { tone: "error" | "warn"; title: string; detail?: string };
  } {
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
          return { ok: true };
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
        return { ok: true };
      }
      if (Number.isFinite(amount) && amount > max) {
        pendingQty.value = 1;
        statusMessage.value = `ราคาเบ็ดเตล็ดต้องไม่เกิน ${max} บาท`;
        return {
          ok: false,
          notice: {
            tone: "warn",
            title: "ราคาเบ็ดเตล็ดเกินกำหนด",
            detail: `สูงสุด ${max} บาท`,
          },
        };
      }
    }

    const parsed = parseBarcode(text);
    if (parsed.kind === "priceEmbedded" && parsed.validCheckDigit) {
      // ระบบเก่าเก็บบาร์สินค้าเป็น 6 หลัก (เช่น 900009) ไม่ใช่บาร์เต็ม 13 หลัก
      const product =
        productByBarcode.value.get(parsed.productBarcode) ??
        productByCode.value.get(parsed.productBarcode) ??
        null;
      if (product) {
        if (product.isOpenPrice) {
          statusMessage.value = `พิมพ์ราคา 1-${product.openPriceMax ?? 100} แล้ว Enter`;
          return {
            ok: false,
            notice: {
              tone: "warn",
              title: "สินค้าเปิดราคา",
              detail: `พิมพ์ราคา 1-${product.openPriceMax ?? 100} แล้ว Enter`,
            },
          };
        }
        addLine({
          // เก็บบาร์เต็ม 13 หลักที่สแกน (เผื่อตรวจย้อนหลัง) · สินค้าหาจากบาร์ 6 หลัก
          barcode: parsed.barcode,
          productCode: product.productCode ?? parsed.productBarcode,
          name: product.name,
          unit: product.unit,
          unitPrice: parsed.price,
        });
        return { ok: true };
      }
      // ไม่เจอสินค้าจากบาร์ 6 หลัก → ลองหาแบบบาร์เต็ม (มาตรฐาน)
    } else if (parsed.kind === "priceEmbedded" && !parsed.validCheckDigit) {
      // อาจเป็น EAN ปกติขึ้นต้น 9 — ลองหาแบบมาตรฐานต่อ
    }

    const product = productByBarcode.value.get(parsed.barcode);
    if (!product) {
      pendingQty.value = 1;
      statusMessage.value = `ไม่พบสินค้า: ${parsed.barcode}`;
      return {
        ok: false,
        notice: {
          tone: "error",
          title: "ไม่พบสินค้า",
          detail: parsed.barcode,
        },
      };
    }
    if (product.isOpenPrice) {
      statusMessage.value = `พิมพ์ราคา 1-${product.openPriceMax ?? 100} แล้ว Enter`;
      return {
        ok: false,
        notice: {
          tone: "warn",
          title: "สินค้าเปิดราคา",
          detail: `พิมพ์ราคา 1-${product.openPriceMax ?? 100} แล้ว Enter`,
        },
      };
    }
    if (product.price == null) {
      pendingQty.value = 1;
      statusMessage.value = `${product.name} ต้องใช้บาร์โค้ดราคา`;
      return {
        ok: false,
        notice: {
          tone: "warn",
          title: "ต้องใช้บาร์โค้ดราคา",
          detail: product.name,
        },
      };
    }
    addLine({
      barcode: product.barcode,
      productCode: product.productCode,
      name: product.name,
      unit: product.unit,
      unitPrice: product.price,
    });
    return { ok: true };
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
          (p.productCode ?? "").includes(q),
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
    pointsDiscount.value = 0;
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

  /**
   * ใช้แต้มเป็นส่วนลดท้ายบิล (บาท)
   * pts = จำนวนแต้ม · แปลงเป็นบาทตาม bahtPerRedeemPoint
   */
  function setPointsRedeem(pts: number): { ok: true } | { ok: false; reason: string } {
    const settings = useSettingsStore();
    const config = settings.pointsConfig;
    const want = Math.max(0, Math.floor(pts));
    if (!memberId.value) {
      return { ok: false, reason: "เลือกสมาชิกก่อนใช้แต้ม" };
    }
    if (want <= 0) {
      pointsDiscount.value = 0;
      publish();
      return { ok: true };
    }
    const beforePoints = round2(
      promoResult.value.promoDiscount + Math.max(0, manualDiscount.value),
    );
    const payable = round2(
      Math.max(0, summarizeCart(lines.value, beforePoints, 0).total),
    );
    const maxPts = maxRedeemablePoints(payable, memberPoints.value, config);
    if (want > maxPts) {
      return {
        ok: false,
        reason:
          maxPts <= 0
            ? "ใช้แต้มไม่ได้ (ยอดเป็น 0 หรือแต้มไม่พอ)"
            : `ใช้ได้สูงสุด ${maxPts} แต้ม`,
      };
    }
    pointsDiscount.value = round2(redeemDiscountBaht(want, config));
    publish();
    return { ok: true };
  }

  function clearPointsDiscount() {
    if (pointsDiscount.value === 0) return;
    pointsDiscount.value = 0;
    publish();
  }

  function setPaid(amount: number) {
    paid.value = amount;
    publish();
  }

  function setMember(member: { id: string; name: string; points: number }) {
    // เลิกค้างบิลเก่าบนจอลูกค้า — ไม่งั้นจะโชว์แต้มคนก่อนหน้า
    clearLastChange();
    memberId.value = member.id;
    memberName.value = member.name;
    memberPoints.value = Math.max(0, Math.floor(member.points));
    statusMessage.value = `สมาชิก: ${member.name} (${memberPoints.value} แต้ม)`;
    bump();
    publish();
  }

  function clearMember() {
    memberId.value = null;
    memberName.value = "ลูกค้าทั่วไป";
    memberPoints.value = 0;
    pointsDiscount.value = 0;
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
      pointsDiscount: pointsDiscount.value,
      memberId: memberId.value,
      memberName: memberName.value,
      memberPoints: memberPoints.value,
    };
    heldBills.value = [...heldBills.value, bill];
    lines.value = [];
    manualDiscount.value = 0;
    pointsDiscount.value = 0;
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
    pointsDiscount.value = bill.pointsDiscount ?? 0;
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
   * - โอน / รัฐ ห้ามเกินยอดคงเหลือ
   * - แต้มเป็นส่วนลดท้ายบิลแล้ว (pointsDiscount) ไม่ใส่ใน payments
   */
  async function completePayment(payments: PaymentEntry[]): Promise<boolean> {
    if (!lines.value.length) {
      statusMessage.value = "ไม่มีรายการให้ชำระ";
      return false;
    }

    // ย้าย points ที่หลงมาใน payments → ส่วนลด (กันของเก่า)
    for (const p of payments) {
      if (p.method !== "points") continue;
      pointsDiscount.value = round2(pointsDiscount.value + p.amount);
    }
    const settings = useSettingsStore();
    const rate = settings.pointsConfig.bahtPerRedeemPoint || 1;
    const pointsUsed = Math.max(
      0,
      Math.round(pointsDiscount.value / (rate || 1)),
    );
    const moneyPayments = payments.filter((p) => p.method !== "points");
    // refresh total after folding stray points
    const payable = summary.value.total;

    if (!moneyPayments.length && payable > 1e-9) {
      statusMessage.value = "ยังไม่ได้ใส่การชำระ";
      return false;
    }

    let covered = 0;
    let cashTendered = 0;
    const normalized: PaymentEntry[] = [];

    for (const p of moneyPayments) {
      const remaining = round2(payable - covered);
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
        statusMessage.value = "ชำระเกินยอดคงเหลือไม่ได้ (ยกเว้นเงินสด)";
        return false;
      }
      covered = round2(covered + amount);
      normalized.push({ method: p.method, amount });
    }

    if (covered + 1e-9 < payable) {
      statusMessage.value = `ชำระยังไม่ครบ ขาด ${(payable - covered).toFixed(2)} บาท`;
      return false;
    }

    if (pointsUsed > memberPoints.value) {
      statusMessage.value = "แต้มไม่พอ";
      return false;
    }

    const change = round2(
      Math.max(
        0,
        cashTendered -
          normalized
            .filter((p) => p.method === "cash")
            .reduce((s, p) => s + p.amount, 0),
      ),
    );

    // ได้แต้มเฉพาะสมาชิก — ลูกค้าทั่วไปไม่สะสม / ไม่โชว์ข้อความ
    const earnBase = round2(payable + Math.max(0, pointsDiscount.value));
    const earned = memberId.value
      ? earnPoints(earnBase, settings.pointsConfig)
      : 0;
    lastPointsEarned.value = earned;

    const members = useMembersStore();
    if (memberId.value) {
      await members.adjustPoints(memberId.value, -pointsUsed + earned);
      const updated = members.findById(memberId.value);
      if (updated) memberPoints.value = updated.points;
    }

    const session = useSessionStore();
    const sale = session.recordSale({
      total: payable,
      payments: normalized.map((p) => ({ method: p.method, amount: p.amount })),
      cashTendered,
      change,
      pointsRedeemed: pointsUsed,
      pointsEarned: earned,
      memberName: memberName.value,
    });
    const device = await getDeviceConfig();
    await enqueueSaleAndSync({
      id: sale.id,
      billNo: sale.billNo,
      branchId: device.branchId,
      terminalId: device.terminalId,
      shiftId: session.shiftId,
      customerId: memberId.value,
      customerName: memberName.value,
      subtotal: summary.value.subtotal,
      discount: billDiscount.value,
      total: payable,
      paid: cashTendered || payable,
      change,
      pointsRedeemed: pointsUsed,
      pointsEarned: earned,
      createdAt: sale.at,
      payments: normalized.map((p) => ({ ...p })),
      lines: lines.value.map((line) => ({ ...line })),
    });

    paid.value = cashTendered || payable;
    lastPaymentMethod.value = normalized[normalized.length - 1]?.method ?? null;

    const parts = [
      ...normalized.map((p) => {
        if (p.method === "cash") return `สด ${p.amount.toFixed(2)}`;
        if (p.method === "transfer") return `โอน ${p.amount.toFixed(2)}`;
        return `รัฐ ${p.amount.toFixed(2)}`;
      }),
      ...(pointsUsed > 0
        ? [`ส่วนลดแต้ม ${pointsDiscount.value.toFixed(2)}`]
        : []),
    ].join(" + ");

    statusMessage.value =
      `บิล ${sale.billNo} ชำระแล้ว (${parts || "0"})` +
      (change > 0 ? ` ทอน ${change.toFixed(2)}` : "") +
      (earned > 0 ? ` · ได้ ${earned} แต้ม (ใช้รอบหน้า)` : "");
    const doneMsg = statusMessage.value;

    // ค้างรายการ + เงินทอนบนจอลูกค้า (ก่อนเคลียร์บิลแคชเชียร์)
    const snap = summary.value;
    const receiptLines = lines.value.map((l) => ({ ...l }));
    const receiptPromos = appliedPromos.value.map((p) => ({ ...p }));
    const receiptPointsDisc = pointsDiscount.value;
    const receiptMemberName = memberName.value;
    const member = memberId.value
      ? members.findById(memberId.value)
      : null;
    const pointsBalanceAfter = memberPoints.value;

    holdPaidReceipt(change, {
      lines: receiptLines,
      itemCount: snap.itemCount,
      subtotal: snap.subtotal,
      discount: snap.discount,
      total: payable,
      memberName: receiptMemberName,
      memberPoints: pointsBalanceAfter,
      pointsUsable: pointsBalanceAfter,
      pointsToEarn: earned,
    });

    // พิมพ์ใบเสร็จ (ไม่บล็อกการเคลียร์บิล)
    void (async () => {
      try {
        const printer = await loadPrinterConfig();
        if (!printer.autoPrint) return;
        const brand = useSettingsStore();
        const payload: ReceiptPayload = {
          storeName: brand.storeName || "AP หมูสด",
          branchName: device.branchName || "",
          tagline: brand.storeTagline || "มาตรฐาน สะอาด ปลอดภัย",
          billNo: sale.billNo,
          at: sale.at,
          lines: receiptLines.map((l) => {
            const promo = receiptPromos.find(
              (p) => p.productCode && p.productCode === l.productCode,
            );
            return {
              name: l.name,
              qty: l.qty,
              unit: l.unit,
              unitPrice: l.unitPrice,
              lineTotal: l.lineTotal,
              discount: l.discount,
              promoHint: promo?.label ?? null,
            };
          }),
          itemCount: snap.itemCount,
          subtotal: snap.subtotal,
          promoDiscount: receiptPromos.reduce((s, p) => s + p.discount, 0),
          promos: receiptPromos.map((p) => ({
            label: p.label,
            discount: p.discount,
          })),
          pointsDiscount: receiptPointsDisc,
          total: payable,
          payments: normalized.map((p) => {
            if (
              p.method === "cash" &&
              p.tendered != null &&
              p.tendered > p.amount
            ) {
              return {
                method: p.method,
                label: paymentLabel(p.method),
                amount: p.tendered,
              };
            }
            return {
              method: p.method,
              label: paymentLabel(p.method),
              amount: p.amount,
            };
          }),
          change,
          memberCode: member?.code ?? null,
          memberName: receiptMemberName,
          pointsEarned: earned,
          pointsBalance: pointsBalanceAfter,
          paperWidth: printer.paperWidth,
          footerHours: printer.footerHours,
          footerPhones: printer.footerPhones,
          appVersion: "AP Version 0.1.0",
        };
        const result = await printReceipt(payload, {
          silent: printer.silent,
          preview: !printer.silent,
          deviceName: printer.printerName || undefined,
        });
        if (!result.ok) {
          statusMessage.value = `${doneMsg} · พิมพ์ไม่สำเร็จ${
            result.message ? `: ${result.message}` : ""
          }`;
        } else if (result.message) {
          statusMessage.value = `${doneMsg} · ${result.message}`;
        }
      } catch {
        /* ไม่ให้พิมพ์พังแล้วขายไม่ได้ */
      }
    })();

    payProgress.value = null;
    clearBill({ reason: "paid" });
    statusMessage.value = doneMsg;
    publish();
    return true;
  }

  return {
    lines,
    manualDiscount,
    pointsDiscount,
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
    pointsRedeemedPts,
    pointsToEarnPreview,
    snapshot,
    loadCatalog,
    setCatalog,
    setPromos,
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
    setPointsRedeem,
    clearPointsDiscount,
    setPaid,
    setMember,
    clearMember,
    holdBill,
    recallBill,
    deleteHeldBill,
    clearHeldBills,
    completePayment,
    setPayProgress,
    clearPayProgress,
    publish,
  };
});

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
