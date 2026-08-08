<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { storeToRefs } from "pinia";
import { useCartStore } from "../stores/cart";
import { useMembersStore } from "../stores/members";
import { useSessionStore } from "../stores/session";
import { useSettingsStore } from "../stores/settings";
import PaymentModal from "../components/PaymentModal.vue";
import OpenShiftModal from "../components/OpenShiftModal.vue";
import CloseShiftModal from "../components/CloseShiftModal.vue";
import CashCountModal from "../components/CashCountModal.vue";
import CashMoveModal from "../components/CashMoveModal.vue";
import MemberSearchModal from "../components/MemberSearchModal.vue";
import type { Member } from "../data/demo-members";
import ProductSearchModal from "../components/ProductSearchModal.vue";
import HoldRecallModal from "../components/HoldRecallModal.vue";
import ConfirmModal from "../components/ConfirmModal.vue";
import StaffAlert from "../components/StaffAlert.vue";
import SaleSummaryModal from "../components/SaleSummaryModal.vue";
import {
  applyPrinterConfigFromTerminal,
  cacheLocalProductImages,
  ensureProductImagesFromPull,
  ensureSettingsMediaCached,
  getDeviceConfig,
  loadCachedMembers,
  loadCachedProducts,
  loadCachedPromos,
  loadCachedSettings,
  loadMediaIndex,
  loadTerminals,
  mediaCacheEpoch,
  pendingOutboxCount,
  resolveImage,
  syncPullMasterData,
  syncPushOutbox,
} from "../services/sync";
import { formatMoney } from "../utils/format";
import fallbackLogo from "../assets/store-logo.png";
import { PLACEHOLDER_IMAGE } from "../data/demo-products";

/** ชื่อบนปุ่มด่วน — ตัดหน่วยท้าย อนุญาตยาวขึ้น (ขึ้นบรรทัดใหม่ใน CSS) */
function shortQuickName(name: string, max = 22) {
  let s = String(name || "").trim();
  s = s
    .replace(
      /\s*[-–—]?\s*\d+([.,]\d+)?\s*(ml|มล\.?|g|กรัม|kg|กก\.?|ลิตร|ชิ้น|แพ็ค|ฟอง)\s*$/iu,
      "",
    )
    .replace(/\s{2,}/g, " ")
    .trim();
  if (!s) s = String(name || "").trim();
  if (s.length <= max) return s;
  return `${s.slice(0, Math.max(1, max - 1))}…`;
}
const cart = useCartStore();
const members = useMembersStore();
const session = useSessionStore();
const settings = useSettingsStore();
const {
  storeName,
  storeTagline,
  logoUrl,
} = storeToRefs(settings);

const brandLogoSrc = computed(() => {
  void mediaCacheEpoch.value;
  return resolveImage(logoUrl.value, fallbackLogo);
});

/** รูปสินค้าด่วน — อ่าน cache ใหม่เมื่อ mediaCacheEpoch เปลี่ยน */
function productThumb(url: string | null | undefined) {
  void mediaCacheEpoch.value;
  return resolveImage(url, PLACEHOLDER_IMAGE);
}

function onThumbError(e: Event) {
  const el = e.target as HTMLImageElement | null;
  if (!el || el.dataset.fallback === "1") return;
  el.dataset.fallback = "1";
  el.src = PLACEHOLDER_IMAGE;
}
const {
  lines,
  summary,
  quickTiles,
  statusMessage,
  revision,
  appliedPromos,
  pointsDiscount,
  manualDiscount,
  memberName,
  memberPoints,
  memberId,
  pointsRedeemedPts,
  pointsToEarnPreview,
  pendingQty,
  heldBills,
  lastChange,
} = storeToRefs(cart);
const { isOpen, staff, floatCounted, summary: shiftSummary, device, exiting } =
  storeToRefs(session);

const scanBuffer = ref("");
const scanInput = ref<HTMLInputElement | null>(null);
const cartScroller = ref<HTMLElement | null>(null);
const selectedIndex = ref(-1);
const quickPage = ref(0);
/** 8×2 = 16/หน้า — ช่องใกล้ 1:1 ให้รูปเต็ม */
const pageSize = 16;

const payOpen = ref(false);
const openShiftOpen = ref(false);
const closeShiftOpen = ref(false);
const cashCountOpen = ref(false);
const cashMoveOpen = ref(false);
const cashMoveDir = ref<"in" | "out">("out");
const memberOpen = ref(false);
/** กันคลิกทะลุเปิดค้นหาสมาชิกซ้ำหลังเพิ่งปิด */
const memberOpenBlockUntil = ref(0);
const productSearchOpen = ref(false);
const holdOpen = ref(false);
const summaryOpen = ref(false);
const holdMode = ref<"hold" | "recall">("hold");
const confirmOpen = ref(false);
const confirmKind = ref<"bill" | "line">("bill");
const pendingVoidIndex = ref(-1);

const alertOpen = ref(false);
const alertTitle = ref("แจ้งเตือน");
const alertMessage = ref("");
const alertHint = ref("");
let syncTimer: number | undefined;
let unsubCloseBlocked: (() => void) | undefined;

watch(exiting, (v) => {
  if (v) openShiftOpen.value = false;
});

watch(
  isOpen,
  (open) => {
    window.apPos?.setShiftOpen?.(open);
  },
  { immediate: true },
);

async function runBackgroundSync() {
  try {
    const pull = await syncPullMasterData();
    await Promise.all([
      session.refreshStaffDirectory(),
      session.refreshDevice(),
    ]);
    // ดึงค่าใบเสร็จจาก Admin (ตามเครื่องที่ผูก) — ไม่ให้ตั้งที่ POS
    try {
      const dev = await getDeviceConfig();
      const terminals = await loadTerminals(dev.branchId);
      const mine = terminals.find((t) => t.id === dev.terminalId);
      if (mine) await applyPrinterConfigFromTerminal(mine);
    } catch {
      /* offline */
    }
    // สื่อไม่ค่อยเปลี่ยน — แคชเฉพาะเมื่อ settings/รูปสินค้าใน pull เปลี่ยน หรือยังขาดในเครื่อง
    if (pull.settings) {
      await ensureSettingsMediaCached(pull.settings);
    }
    if (pull.products.length) {
      await ensureProductImagesFromPull(pull.products);
    }
    if (pull.products.length || pull.removedProductIds.length) {
      cart.setCatalog(await loadCachedProducts(), "api");
    }
    if (pull.members.length || pull.removedMemberIds.length) {
      await members.replaceAll(await loadCachedMembers());
      if (memberId.value) {
        const latest = members.findById(memberId.value);
        if (latest) cart.setMember(latest);
      }
    }
    if (pull.promos?.length || pull.removedPromoIds?.length) {
      const promos = await loadCachedPromos();
      cart.setPromos(
        promos.map((p) => ({
          id: p.id,
          productCode: p.productCode,
          buyQty: p.buyQty,
          payAmount: p.payAmount,
          label: p.label,
        })),
      );
    } else if (pull.promos && !pull.promos.length) {
      const promos = await loadCachedPromos();
      if (promos.length) {
        cart.setPromos(
          promos.map((p) => ({
            id: p.id,
            productCode: p.productCode,
            buyQty: p.buyQty,
            payAmount: p.payAmount,
            label: p.label,
          })),
        );
      }
    }
    if (
      pull.settings?.points ||
      pull.settings?.display ||
      pull.settings?.branding ||
      pull.settings?.customerAds ||
      pull.settings?.keybindings
    ) {
      settings.applyFromBackend({
        points: pull.settings.points,
        display: pull.settings.display,
        branding: pull.settings.branding,
        customerAds: pull.settings.customerAds,
        keybindings: pull.settings.keybindings,
      });
    }
    // ส่งไปจอ 2 ทุกครั้งหลัง sync — กันโฆษณาค้างเวอร์ชันเก่า
    settings.publishSettingsToCustomer();
    await syncPushOutbox();
    if (window.apPos?.db?.purgeSyncedSales) {
      await window.apPos.db.purgeSyncedSales();
    }
    const pending = await pendingOutboxCount();
    if (pending > 0) {
      statusMessage.value = `มีบิลรอ sync ${pending} รายการ`;
    }
  } catch {
    // offline — ใช้สื่อจากดิสก์ที่มีอยู่แล้ว ไม่ดึงซ้ำ
    try {
      await loadMediaIndex();
      cart.setCatalog(await loadCachedProducts(), cart.catalogSource);
    } catch {
      /* ignore */
    }
  }
}

function showAlert(title: string, message: string, hint = "") {
  alertTitle.value = title;
  alertMessage.value = message;
  alertHint.value = hint;
  alertOpen.value = true;
  statusMessage.value = message;
}

const today = new Date().toLocaleDateString("th-TH");
void session.refreshDevice();
const billNo = computed(() => session.previewBillNo());

const anyModalOpen = computed(
  () =>
    payOpen.value ||
    openShiftOpen.value ||
    closeShiftOpen.value ||
    cashCountOpen.value ||
    cashMoveOpen.value ||
    memberOpen.value ||
    productSearchOpen.value ||
    holdOpen.value ||
    summaryOpen.value ||
    confirmOpen.value ||
    alertOpen.value,
);

const confirmTitle = computed(() =>
  confirmKind.value === "bill" ? "ยืนยันยกเลิกบิล" : "ยืนยันยกเลิกรายการ",
);

const confirmMessage = computed(() => {
  if (confirmKind.value === "bill") {
    return `ยกเลิกบิลนี้ทั้งหมด ${lines.value.length} รายการ · ยอด ${formatMoney(summary.value.total)} บาท?`;
  }
  const line =
    pendingVoidIndex.value >= 0
      ? lines.value[pendingVoidIndex.value]
      : lines.value[lines.value.length - 1];
  if (!line) return "ยกเลิกรายการนี้?";
  return `ยกเลิก “${line.name}” ×${line.qty} · ${formatMoney(line.lineTotal)} บาท?`;
});

const confirmLabel = computed(() =>
  confirmKind.value === "bill" ? "ยืนยันยกเลิกบิล" : "ยืนยันยกเลิกรายการ",
);

const quickPageCount = computed(() =>
  Math.max(1, Math.ceil(quickTiles.value.length / pageSize)),
);

const pagedQuick = computed(() => {
  const start = quickPage.value * pageSize;
  return quickTiles.value.slice(start, start + pageSize);
});

watch(quickPageCount, (n) => {
  if (quickPage.value > n - 1) quickPage.value = Math.max(0, n - 1);
});

const selectedLine = computed(() =>
  selectedIndex.value >= 0 ? lines.value[selectedIndex.value] : null,
);

type ActionBtn = {
  id: string;
  label: string;
  hint: string;
  tone: string;
  run: () => void;
};

function requireShift(): boolean {
  if (isOpen.value) return true;
  if (exiting.value) return false;
  showAlert(
    "ยังไม่ได้เปิดรอบ",
    "ต้องเปิดรอบก่อนขาย",
    "กดปุ่มเปิดรอบ แล้วใส่รหัส PIN ของคุณ",
  );
  openShiftOpen.value = true;
  return false;
}

function openMemberSearch() {
  if (Date.now() < memberOpenBlockUntil.value) return;
  if (!requireShift()) return;
  memberOpen.value = true;
}

function closeMemberSearch() {
  memberOpen.value = false;
  memberOpenBlockUntil.value = Date.now() + 800;
  void nextTick(() => focusScan());
}

function onMemberPick(m: Member) {
  // ปิดก่อน แล้วค่อย set — ไม่ให้แถบใน modal อัปเดตค้างแล้วไม่ปิด
  closeMemberSearch();
  cart.setMember({ id: m.id, name: m.name, points: m.points });
}

function onMemberClear() {
  closeMemberSearch();
  cart.clearMember();
}

function askCancelBill() {
  if (!lines.value.length) {
    // บิลว่าง — ไม่เด้งแจ้งเตือนใหญ่ (เช่น กด Esc ปิด modal แล้วหลุดมา)
    statusMessage.value = "ไม่มีรายการให้ยกเลิก";
    focusScan();
    return;
  }
  confirmKind.value = "bill";
  confirmOpen.value = true;
}

function askVoidLine(index?: number) {
  if (!lines.value.length) {
    showAlert(
      "ไม่มีรายการให้ยกเลิก",
      "ยังไม่มีสินค้าในบิล",
      "ใส่สินค้าก่อน ถ้าจะยกเลิกรายการให้เลือกรายการแล้วกด ×",
    );
    focusScan();
    return;
  }
  const idx =
    index != null && index >= 0
      ? index
      : selectedIndex.value >= 0
        ? selectedIndex.value
        : lines.value.length - 1;
  pendingVoidIndex.value = idx;
  confirmKind.value = "line";
  confirmOpen.value = true;
}

function onConfirmOk() {
  if (confirmKind.value === "bill") {
    cart.clearBill();
    selectedIndex.value = -1;
  } else {
    const idx = pendingVoidIndex.value;
    cart.removeAt(idx);
    selectedIndex.value = lines.value.length
      ? Math.min(idx, lines.value.length - 1)
      : -1;
  }
  pendingVoidIndex.value = -1;
  focusScan();
}

function onConfirmCancel() {
  pendingVoidIndex.value = -1;
  focusScan();
}

function scrollCartToBottom() {
  const run = () => {
    const scroller = cartScroller.value;
    if (!scroller) return;
    scroller.scrollTop = 0;
    scroller.scrollTop = scroller.scrollHeight;
    const last = scroller.querySelector("tbody tr:last-child") as HTMLElement | null;
    if (last && !last.querySelector("td.empty")) {
      const delta =
        last.getBoundingClientRect().bottom - scroller.getBoundingClientRect().bottom;
      if (delta > 0) scroller.scrollTop += delta + 8;
    }
  };
  void nextTick(() => {
    run();
    requestAnimationFrame(() => {
      run();
      setTimeout(run, 16);
      setTimeout(run, 100);
    });
  });
}

watch(
  () =>
    [revision.value, lines.value.length, lines.value[lines.value.length - 1]?.id] as const,
  () => {
    if (lines.value.length > 0) {
      selectedIndex.value = lines.value.length - 1;
      scrollCartToBottom();
    } else {
      selectedIndex.value = -1;
    }
  },
  { flush: "post" },
);

const primaryActions = computed<ActionBtn[]>(() => [
  {
    id: "member",
    label: "ลูกค้า",
    hint: settings.label("member"),
    tone: "tone-member",
    run: () => openMemberSearch(),
  },
  {
    id: "cancel-bill",
    label: "ยกเลิกบิล",
    hint: settings.label("cancel_bill"),
    tone: "tone-danger",
    run: () => askCancelBill(),
  },
  {
    id: "hold",
    label: "พักบิล",
    hint: settings.label("hold_bill"),
    tone: "tone-hold",
    run: () => {
      if (!requireShift()) return;
      if (!lines.value.length) {
        showAlert(
          "พักบิลไม่ได้",
          "ยังไม่มีสินค้าในบิล",
          "ใส่สินค้าก่อน แล้วค่อยกดพักบิล",
        );
        return;
      }
      // พักทันที ไม่เปิด popup ยืนยัน
      cart.holdBill();
      focusScan();
    },
  },
  {
    id: "recall",
    label: heldBills.value.length
      ? `เรียกบิลพัก (${heldBills.value.length})`
      : "เรียกบิลพัก",
    hint: settings.label("recall_bill"),
    tone: "tone-recall",
    run: () => {
      if (!requireShift()) return;
      if (lines.value.length) {
        showAlert(
          "เรียกบิลพักไม่ได้",
          "ยังมีรายการขายค้างอยู่บนจอ",
          "พักบิลนี้ หรือยกเลิกบิลนี้ก่อน แล้วค่อยเรียกบิลที่พักไว้",
        );
        return;
      }
      if (!heldBills.value.length) {
        showAlert(
          "ยังไม่มีบิลพัก",
          "ตอนนี้ยังไม่ได้พักบิลไว้",
          "เวลาจะพักบิล ให้กดปุ่มพักบิลตอนมีสินค้าบนจอ",
        );
        return;
      }
      // มีบิลพักใบเดียว — ดึงมาเลย ไม่ต้องเปิดเลือก
      if (heldBills.value.length === 1) {
        cart.recallBill(heldBills.value[0].id);
        focusScan();
        return;
      }
      holdMode.value = "recall";
      holdOpen.value = true;
    },
  },
  {
    id: "cash-in",
    label: "นำเงินเข้า",
    hint: settings.label("cash_in"),
    tone: "tone-cash-in",
    run: () => {
      if (!requireShift()) return;
      cashMoveDir.value = "in";
      cashMoveOpen.value = true;
    },
  },
  {
    id: "cash-out",
    label: "นำเงินออก",
    hint: settings.label("cash_out"),
    tone: "tone-cash-out",
    run: () => {
      if (!requireShift()) return;
      cashMoveDir.value = "out";
      cashMoveOpen.value = true;
    },
  },
  {
    id: "float-count",
    label: floatCounted.value ? "นับเงินทอน" : "นับเงินทอน*",
    hint: settings.label("float_count"),
    tone: floatCounted.value ? "tone-shift" : "tone-warn",
    run: () => {
      if (!requireShift()) return;
      cashCountOpen.value = true;
    },
  },
  {
    id: "summary",
    label: "สรุปการขาย",
    hint: settings.label("sale_summary"),
    tone: "tone-search",
    run: () => {
      if (!requireShift()) return;
      summaryOpen.value = true;
    },
  },
]);

const closeShiftAction = computed<ActionBtn>(() => ({
  id: "close-shift",
  label: "ปิดรอบ",
  hint: settings.label("close_shift"),
  tone: "tone-close",
  run: () => {
    if (!isOpen.value) {
      if (exiting.value) return;
      showAlert(
        "ยังไม่ได้เปิดรอบ",
        "ยังไม่มีรอบขายที่เปิดอยู่",
        "เปิดรอบก่อน แล้วค่อยปิดรอบเมื่อเลิกขาย",
      );
      openShiftOpen.value = true;
      return;
    }
    if (lines.value.length) {
      showAlert(
        "ปิดรอบไม่ได้",
        "ยังมีรายการขายค้างอยู่บนจอ",
        "ให้กดชำระเงินให้ลูกค้าก่อน หรือกดยกเลิกบิล แล้วค่อยปิดรอบ",
      );
      return;
    }
    closeShiftOpen.value = true;
  },
}));

/** ปุ่มฟังก์ชันแถวล่าง — 3×3 รวมปิดรอบขนาดเท่ากัน */
const funcActions = computed<ActionBtn[]>(() => [
  ...primaryActions.value,
  closeShiftAction.value,
]);

/** ถ้า quit ไม่ได้ (เช่นรันในเบราว์เซอร์) ค่อยกลับหน้าล็อกอิน */
function onShiftClosedFallback() {
  if (exiting.value) {
    openShiftOpen.value = false;
    return;
  }
  openShiftOpen.value = true;
}

function runAction(id: string) {
  if (id === "search") {
    if (!requireShift()) return;
    productSearchOpen.value = true;
    return;
  }
  if (id === "close-shift") {
    closeShiftAction.value.run();
    return;
  }
  primaryActions.value.find((b) => b.id === id)?.run();
}

function focusScan() {
  if (payOpen.value || anyModalOpen.value) return;
  void nextTick(() => {
    const el = scanInput.value;
    if (!el) return;
    el.focus({ preventScroll: true });
    el.select();
  });
}

function clearScanBuffer() {
  scanBuffer.value = "";
  const el = scanInput.value;
  if (el) el.value = "";
}

function openPayment() {
  if (!requireShift()) return;
  if (!lines.value.length) {
    // ไม่เด้ง modal บล็อก — กด Home ซ้ำได้เลยหลังสแกนสินค้า
    statusMessage.value = "ยังไม่มีรายการขาย — สแกนหรือกดสินค้าด่วนก่อน แล้วกด Home";
    focusScan();
    return;
  }
  payOpen.value = true;
}

let scanSubmitting = false;

function onScanSubmit() {
  if (scanSubmitting) return;
  scanSubmitting = true;
  try {
    if (!requireShift()) {
      clearScanBuffer();
      focusScan();
      return;
    }
    const raw = scanBuffer.value.trim();
    // กด Enter → เคลียร์เลขบาร์ทันที (เช่น พิมพ์ 25 แล้ว Enter)
    clearScanBuffer();
    focusScan();
    if (!raw) return;

    // คูณรายการล่าสุด: กดปุ่มคูณแล้วพิมพ์จำนวนอย่างเดียว
    if (/^\*\d+$/.test(raw) || raw === "*") {
      const n = Number(raw.replace(/^\*/, ""));
      if (Number.isFinite(n) && n > 0) cart.multiplyLast(n);
      scrollCartToBottom();
      return;
    }

    // 3* อย่างเดียว → ตั้ง pending แล้วรอสแกน
    if (/^\d+\*$/.test(raw)) {
      cart.scan(raw);
      return;
    }

    cart.scan(raw);
    scrollCartToBottom();
  } finally {
    scanSubmitting = false;
  }
}

function onScanInput() {
  const raw = scanBuffer.value;
  // พิมพ์ 3* แล้วหยุด — ตั้งคูณทันที (ยังไม่ต้อง Enter)
  const m = raw.match(/^(\d+)\*$/);
  if (m) {
    cart.setPendingQty(Number(m[1]));
    clearScanBuffer();
    focusScan();
  }
}

function onScanKeydown(e: KeyboardEvent) {
  if (e.key === "Escape") {
    e.preventDefault();
    clearScanBuffer();
    focusScan();
    return;
  }
  if (e.key === "Enter") {
    e.preventDefault();
    onScanSubmit();
  }
}

function onKeydown(e: KeyboardEvent) {
  // modal อื่นจัดการคีย์ไปแล้ว (เช่น Esc ปิดหน้าชำระ) — ห้ามไปโดนยกเลิกบิล
  if (anyModalOpen.value || e.defaultPrevented) return;

  const tag = (e.target as HTMLElement | null)?.tagName;
  if (tag !== "INPUT" && tag !== "TEXTAREA") focusScan();

  // ชำระเงินก่อน — Home ต้องมาก่อนคีย์อื่น และกันช่องสแกนแย่ง Home
  if (settings.matches("open_payment", e)) {
    e.preventDefault();
    e.stopPropagation();
    openPayment();
    return;
  }

  if (settings.matches("void_line", e)) {
    e.preventDefault();
    askVoidLine();
    return;
  }
  if (settings.matches("product_search", e)) {
    e.preventDefault();
    runAction("search");
    return;
  }
  if (settings.matches("sale_summary", e)) {
    e.preventDefault();
    runAction("summary");
    return;
  }
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    e.preventDefault();
    if (!lines.value.length) return;
    if (e.key === "ArrowDown") {
      selectedIndex.value =
        selectedIndex.value < 0
          ? 0
          : Math.min(lines.value.length - 1, selectedIndex.value + 1);
    } else {
      selectedIndex.value =
        selectedIndex.value < 0
          ? lines.value.length - 1
          : Math.max(0, selectedIndex.value - 1);
    }
    statusMessage.value = `เลือกรายการ: ${selectedLine.value?.name ?? ""}`;
    return;
  }
  if (settings.matches("cancel_bill", e)) {
    e.preventDefault();
    runAction("cancel-bill");
    return;
  }
  if (settings.matches("close_shift", e)) {
    e.preventDefault();
    runAction("close-shift");
    return;
  }
  if (settings.matches("open_shift", e)) {
    e.preventDefault();
    if (!isOpen.value && !exiting.value) openShiftOpen.value = true;
    return;
  }
  if (settings.matches("float_count", e)) {
    e.preventDefault();
    runAction("float-count");
    return;
  }
  if (settings.matches("member", e)) {
    e.preventDefault();
    runAction("member");
    return;
  }
  if (settings.matches("hold_bill", e)) {
    e.preventDefault();
    runAction("hold");
    return;
  }
  if (settings.matches("recall_bill", e)) {
    e.preventDefault();
    runAction("recall");
    return;
  }
  if (settings.matches("cash_in", e)) {
    e.preventDefault();
    runAction("cash-in");
    return;
  }
  if (settings.matches("cash_out", e)) {
    e.preventDefault();
    runAction("cash-out");
    return;
  }
}

onMounted(() => {
  window.addEventListener("keydown", onKeydown, true);
  void members.loadLocal();
  void (async () => {
    await loadMediaIndex();
    const [promos, cachedSettings] = await Promise.all([
      loadCachedPromos(),
      loadCachedSettings(),
    ]);
    // ครั้งแรกของรอบเปิดแอป — เติมเฉพาะที่ขาด / URL เปลี่ยน
    await ensureSettingsMediaCached(cachedSettings);
    if (promos.length) {
      cart.setPromos(
        promos.map((p) => ({
          id: p.id,
          productCode: p.productCode,
          buyQty: p.buyQty,
          payAmount: p.payAmount,
          label: p.label,
        })),
      );
    }
    if (
      cachedSettings?.points ||
      cachedSettings?.display ||
      cachedSettings?.branding ||
      cachedSettings?.customerAds ||
      cachedSettings?.keybindings
    ) {
      settings.applyFromBackend({
        points: cachedSettings.points,
        display: cachedSettings.display,
        branding: cachedSettings.branding,
        customerAds: cachedSettings.customerAds,
        keybindings: cachedSettings.keybindings,
      });
      settings.publishSettingsToCustomer();
    } else {
      settings.syncCustomerScreenToMain();
    }
  })();
  // เปิดระบบมาถ้ายังไม่เปิดรอบ → หน้า PIN (โฟกัสช่องรหัสใน OpenShiftModal)
  if (!isOpen.value && !exiting.value) {
    openShiftOpen.value = true;
  } else {
    void nextTick(() => focusScan());
  }
  void (async () => {
    await loadMediaIndex();
    await cart.loadCatalog();
    cart.publish();
    if (isOpen.value && !anyModalOpen.value) focusScan();
    // เติมรูปด่วนที่ยังไม่มีในดิสก์เท่านั้น (ข้ามถ้ารายการเดิมครบแล้ว)
    const changed = await cacheLocalProductImages({ awaitQuick: true });
    if (changed) {
      cart.setCatalog(await loadCachedProducts(), cart.catalogSource);
    }
  })();
  void runBackgroundSync();
  syncTimer = window.setInterval(() => {
    void runBackgroundSync();
  }, 15000);
  unsubCloseBlocked = window.apPos?.onCloseBlocked?.(() => {
    showAlert(
      "ปิดแอปไม่ได้",
      "ต้องปิดรอบขายก่อน ระบบถึงจะปิดได้",
      "กดปุ่มปิดรอบ → ปิดรอบเลย หรือนับเงินแล้วปิด",
    );
  });
});

onUnmounted(() => {
  window.removeEventListener("keydown", onKeydown, true);
  if (syncTimer) window.clearInterval(syncTimer);
  unsubCloseBlocked?.();
});
</script>

<template>
  <div class="cashier" @click="focusScan">
    <div class="cashier-body">
      <section class="work">
        <form class="scan-bar" @submit.prevent="onScanSubmit">
          <input
            ref="scanInput"
            v-model="scanBuffer"
            class="scan-input"
            :placeholder="pendingQty > 1 ? `คูณ x${pendingQty}` : 'บาร์โค้ด'"
            @input="onScanInput"
            @keydown="onScanKeydown"
          />
        </form>

        <div class="cart-panel">
          <div class="panel-head">
            <span>รายการขาย</span>
            <span class="panel-head-meta">
              {{ lines.length }} รายการ
              <template v-if="pendingQty > 1"> · คูณ x{{ pendingQty }}</template>
              <template v-if="heldBills.length"> · พัก {{ heldBills.length }}</template>
            </span>
          </div>
          <div ref="cartScroller" class="cart-scroller">
            <table class="cart-table">
              <thead>
                <tr>
                  <th class="col-seq">ลำดับ</th>
                  <th class="col-barcode">รหัสบาร์โค้ด</th>
                  <th class="col-name">ชื่อสินค้า</th>
                  <th class="col-qty">จำนวน</th>
                  <th class="col-unit">หน่วย</th>
                  <th class="col-price">ราคา</th>
                  <th class="col-disc">ลด/ชาร์จ</th>
                  <th class="col-total">รวมราคา</th>
                  <th class="col-act"></th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="(line, i) in lines"
                  :key="line.id"
                  :class="{ selected: i === selectedIndex }"
                  @click.stop="selectedIndex = i; focusScan()"
                >
                  <td class="col-seq">{{ i + 1 }}</td>
                  <td class="col-barcode">{{ line.barcode }}</td>
                  <td class="col-name">{{ line.name }}</td>
                  <td class="num col-qty">{{ line.qty }}</td>
                  <td class="col-unit">{{ line.unit }}</td>
                  <td class="num col-price">{{ formatMoney(line.unitPrice) }}</td>
                  <td class="num col-disc">{{ formatMoney(line.discount) }}</td>
                  <td class="num col-total">{{ formatMoney(line.lineTotal) }}</td>
                  <td class="col-act">
                    <button
                      type="button"
                      class="line-cancel"
                      title="ยกเลิกรายการนี้"
                      @click.stop="askVoidLine(i)"
                    >
                      ×
                    </button>
                  </td>
                </tr>
                <tr v-if="!lines.length">
                  <td colspan="9" class="empty">
                    <div class="empty-title">ยังไม่มีรายการขาย</div>
                    <div class="empty-sub">
                      {{
                        isOpen
                          ? "สแกนบาร์โค้ด หรือเลือกจากสินค้าด่วน"
                          : "เปิดรอบ / ล็อกอินก่อนเริ่มขาย"
                      }}
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div class="quick-area">
          <div class="quick-board">
            <div class="quick-grid">
              <button
                v-for="p in pagedQuick"
                :key="p.id"
                type="button"
                class="quick-tile"
                :title="p.name"
                @click.stop="
                  requireShift() &&
                    (cart.addQuick(p), focusScan(), scrollCartToBottom())
                "
              >
                <span class="quick-thumb">
                  <img
                    class="quick-thumb__img"
                    :src="productThumb(p.image)"
                    :alt="p.name"
                    loading="lazy"
                    @error="onThumbError"
                  />
                </span>
                <span class="quick-meta">
                  <span class="quick-name">{{ shortQuickName(p.name) }}</span>
                  <span v-if="p.price != null" class="quick-price">
                    {{ formatMoney(p.price) }}
                    <small>บ.</small>
                  </span>
                  <span v-else class="quick-price quick-price--open">เปิดราคา</span>
                </span>
              </button>
            </div>

            <div class="quick-side-nav">
              <button
                type="button"
                class="quick-side-nav__btn"
                :disabled="quickPageCount <= 1 || quickPage <= 0"
                aria-label="หน้าก่อน"
                @click.stop="quickPage = Math.max(0, quickPage - 1)"
              >
                <span class="quick-side-nav__arrow">‹</span>
                <span>ก่อน</span>
              </button>
              <div class="quick-side-nav__page">
                {{ quickPage + 1 }}/{{ quickPageCount }}
              </div>
              <button
                type="button"
                class="quick-side-nav__btn"
                :disabled="quickPageCount <= 1 || quickPage >= quickPageCount - 1"
                aria-label="หน้าถัดไป"
                @click.stop="quickPage = Math.min(quickPageCount - 1, quickPage + 1)"
              >
                <span>ถัดไป</span>
                <span class="quick-side-nav__arrow">›</span>
              </button>
            </div>
          </div>
        </div>

        <div class="func-row">
          <div class="func-grid primary">
            <button
              v-for="btn in funcActions"
              :key="btn.id"
              type="button"
              class="func-btn"
              :class="btn.tone"
              @click.stop="btn.run()"
            >
              <span class="func-label">{{ btn.label }}</span>
              <span v-if="btn.hint" class="func-hint">{{ btn.hint }}</span>
            </button>
          </div>
        </div>
      </section>

        <aside class="side">
        <div class="side-card side-hero">
          <div class="side-top">
            <div class="terminal">001</div>
            <div class="date">{{ today }}</div>
          </div>
          <div class="brand-block">
            <img
              class="brand-mark brand-mark--logo"
              :src="brandLogoSrc"
              alt=""
              width="44"
              height="44"
            />
            <div class="brand-text">
              <div class="brand-name">{{ storeName }}</div>
              <div class="brand-tag">{{ storeTagline }}</div>
            </div>
          </div>
          <div class="bill-no">{{ billNo }}</div>
          <div class="side-member-row">
            <button
              type="button"
              class="side-member-btn"
              :class="{ 'is-member': Boolean(memberId) }"
              @pointerdown.stop.prevent="openMemberSearch"
            >
              <div class="side-member-main">
                <span class="side-member-label">ลูกค้า</span>
                <strong class="side-member-name">{{ memberName }}</strong>
                <span v-if="memberId" class="side-mp side-mp--earn">
                  แต้มบิลนี้
                  <strong>+{{ pointsToEarnPreview }}</strong>
                </span>
                <span class="side-member-action">
                  {{ memberId ? "เปลี่ยน / ยกเลิก" : "เลือกสมาชิก" }}
                </span>
              </div>
              <div v-if="memberId" class="side-mp side-mp--usable">
                <em>แต้มใช้ได้</em>
                <strong>{{
                  Math.max(0, memberPoints - pointsRedeemedPts)
                }}</strong>
              </div>
            </button>
          </div>
          <div class="side-staff">
            {{
              isOpen
                ? `พนักงาน: ${staff?.name}`
                : "ยังไม่เปิดรอบ"
            }}
          </div>
        </div>

        <div class="side-card side-summary">
          <div class="count-row">
            <span>จำนวนสินค้า</span>
            <strong>{{ summary.itemCount }}</strong>
          </div>

          <div
            v-if="
              appliedPromos.length ||
              pointsDiscount > 0 ||
              manualDiscount > 0
            "
            class="disc-block"
          >
            <div v-for="p in appliedPromos" :key="p.promoId" class="disc-line">
              <span>โปร: {{ p.label }}</span>
              <strong>-{{ formatMoney(p.discount) }}</strong>
            </div>
            <div
              v-if="pointsDiscount > 0"
              class="disc-line disc-line--points"
            >
              <span>ส่วนลดแต้ม</span>
              <strong>-{{ formatMoney(pointsDiscount) }}</strong>
            </div>
            <div v-if="manualDiscount > 0" class="disc-line">
              <span>ส่วนลดอื่น</span>
              <strong>-{{ formatMoney(manualDiscount) }}</strong>
            </div>
          </div>

          <div class="total-block">
            <span>รวมเงิน</span>
            <strong>{{ formatMoney(summary.total) }}</strong>
          </div>
        </div>

        <div class="side-checkout">
          <div class="change-block" :class="{ 'has-change': lastChange > 0 }">
            <span>{{ lastChange > 0 ? "ทอนบิลล่าสุด" : "เงินทอน" }}</span>
            <strong>{{ formatMoney(lastChange) }}</strong>
          </div>

          <button type="button" class="pay-btn" @click.stop="openPayment">
            <span class="pay-btn-label">ชำระเงิน</span>
            <span class="pay-btn-amount">{{ formatMoney(summary.total) }}</span>
            <span class="pay-btn-hint">{{ settings.label("open_payment") }}</span>
          </button>
        </div>
      </aside>
    </div>

    <footer class="status-bar">
      <span>AP Retail — Version 0.1.0</span>
      <span class="status-bar__device" :title="`${device.branchId} / ${device.terminalId}`">
        {{ device.branchName }} · {{ device.terminalName || "เครื่อง POS" }}
        <template v-if="!device.setupDone"> · ยังไม่ลงทะเบียน</template>
      </span>
      <span>
        {{
          isOpen
            ? `รอบเปิด · ${staff?.name} · ${shiftSummary.billCount} บิล`
            : "ยังไม่เปิดรอบ"
        }}
      </span>
      <span class="status-msg">{{ statusMessage }}</span>
    </footer>

    <PaymentModal v-model:open="payOpen" />
    <OpenShiftModal
      v-model:open="openShiftOpen"
      :required="!isOpen && !exiting"
      :before-ready="runBackgroundSync"
      @opened="focusScan"
    />
    <CloseShiftModal
      v-model:open="closeShiftOpen"
      @closed="onShiftClosedFallback"
    />
    <CashCountModal v-model:open="cashCountOpen" purpose="float" />
    <CashMoveModal v-model:open="cashMoveOpen" :direction="cashMoveDir" />
    <MemberSearchModal
      v-if="memberOpen"
      :current-id="memberId"
      :current-name="memberName"
      :current-points="memberPoints"
      @select="onMemberPick"
      @clear="onMemberClear"
      @close="closeMemberSearch"
    />
    <ProductSearchModal v-model:open="productSearchOpen" />
    <HoldRecallModal v-model:open="holdOpen" v-model:mode="holdMode" />
    <SaleSummaryModal v-model:open="summaryOpen" />
    <ConfirmModal
      v-model:open="confirmOpen"
      :title="confirmTitle"
      :message="confirmMessage"
      :confirm-label="confirmLabel"
      cancel-label="ไม่ยกเลิก"
      @confirm="onConfirmOk"
      @cancel="onConfirmCancel"
    />
    <StaffAlert
      v-model:open="alertOpen"
      :title="alertTitle"
      :message="alertMessage"
      :hint="alertHint"
      @close="focusScan"
    />
  </div>
</template>
