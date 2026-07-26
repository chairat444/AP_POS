<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { storeToRefs } from "pinia";
import { useCartStore } from "../stores/cart";
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

const cart = useCartStore();
const session = useSessionStore();
const settings = useSettingsStore();
const {
  lines,
  summary,
  quickTiles,
  statusMessage,
  revision,
  appliedPromos,
  billDiscount,
  memberName,
  memberPoints,
  memberId,
  pendingQty,
  heldBills,
  lastChange,
} = storeToRefs(cart);
const { isOpen, staff, floatCounted, summary: shiftSummary } = storeToRefs(session);

const scanBuffer = ref("");
const scanInput = ref<HTMLInputElement | null>(null);
const cartScroller = ref<HTMLElement | null>(null);
const selectedIndex = ref(-1);
const quickPage = ref(0);
const pageSize = 10;

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
const holdMode = ref<"hold" | "recall">("hold");
const confirmOpen = ref(false);
const confirmKind = ref<"bill" | "line">("bill");
const pendingVoidIndex = ref(-1);

const alertOpen = ref(false);
const alertTitle = ref("แจ้งเตือน");
const alertMessage = ref("");
const alertHint = ref("");

function showAlert(title: string, message: string, hint = "") {
  alertTitle.value = title;
  alertMessage.value = message;
  alertHint.value = hint;
  alertOpen.value = true;
  statusMessage.value = message;
}

const today = new Date().toLocaleDateString("th-TH");
const billNo = computed(() => {
  const n = String((session.sales?.length ?? 0) + 1).padStart(6, "0");
  return `S2607-001-${n}`;
});

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
    confirmOpen.value ||
    alertOpen.value,
);

const confirmTitle = computed(() =>
  confirmKind.value === "bill" ? "ยืนยันยกเลิกบิล" : "ยืนยันยกเลิกรายการ",
);

const confirmMessage = computed(() => {
  if (confirmKind.value === "bill") {
    return `ยกเลิกบิลนี้ทั้งหมด ${lines.value.length} รายการ · ยอด ${summary.value.total.toFixed(2)} บาท?`;
  }
  const line =
    pendingVoidIndex.value >= 0
      ? lines.value[pendingVoidIndex.value]
      : lines.value[lines.value.length - 1];
  if (!line) return "ยกเลิกรายการนี้?";
  return `ยกเลิก “${line.name}” ×${line.qty} · ${line.lineTotal.toFixed(2)} บาท?`;
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
    tone: "tone-soft",
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
    tone: "tone-soft",
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
    tone: floatCounted.value ? "tone-soft" : "tone-warn",
    run: () => {
      if (!requireShift()) return;
      cashCountOpen.value = true;
    },
  },
  {
    id: "summary",
    label: "สรุปการขาย",
    hint: settings.label("sale_summary"),
    tone: "tone-soft",
    run: () => {
      if (!requireShift()) return;
      const v = shiftSummary.value;
      statusMessage.value =
        `รอบนี้ ${v.billCount} บิล · ยอด ${v.grossTotal.toFixed(2)}` +
        ` · ลิ้นชักคาด ${v.expectedCash.toFixed(0)}` +
        (v.voidLineCount || v.voidBillCount
          ? ` · ยกเลิก ${v.voidLineCount} รายการ / ${v.voidBillCount} บิล`
          : "") +
        (v.floatCounted ? "" : " · ยังไม่นับทอน");
      focusScan();
    },
  },
]);

const closeShiftAction = computed<ActionBtn>(() => ({
  id: "close-shift",
  label: "ปิดรอบ",
  hint: settings.label("close_shift"),
  tone: "tone-warn",
  run: () => {
    if (!isOpen.value) {
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
  void nextTick(() => scanInput.value?.focus());
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

function onScanSubmit() {
  if (!requireShift()) {
    scanBuffer.value = "";
    return;
  }
  const raw = scanBuffer.value.trim();
  if (!raw) return;

  // คูณรายการล่าสุด: กดปุ่มคูณแล้วพิมพ์จำนวนอย่างเดียว
  if (/^\*\d+$/.test(raw) || raw === "*") {
    const n = Number(raw.replace(/^\*/, ""));
    if (Number.isFinite(n) && n > 0) cart.multiplyLast(n);
    scanBuffer.value = "";
    focusScan();
    scrollCartToBottom();
    return;
  }

  // 3* อย่างเดียว → ตั้ง pending แล้วรอสแกน
  if (/^\d+\*$/.test(raw)) {
    cart.scan(raw);
    scanBuffer.value = "";
    focusScan();
    return;
  }

  cart.scan(raw);
  scanBuffer.value = "";
  focusScan();
  scrollCartToBottom();
}

function onScanInput() {
  const raw = scanBuffer.value;
  // พิมพ์ 3* แล้วหยุด — ตั้งคูณทันที (ยังไม่ต้อง Enter)
  const m = raw.match(/^(\d+)\*$/);
  if (m) {
    cart.setPendingQty(Number(m[1]));
    scanBuffer.value = "";
    focusScan();
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
    if (!isOpen.value) openShiftOpen.value = true;
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
  settings.resetKeybindings();
  window.addEventListener("keydown", onKeydown, true);
  // เปิดระบบมาถ้ายังไม่เปิดรอบ ให้ขึ้นหน้าเปิดรอบรอเลย
  if (!isOpen.value) openShiftOpen.value = true;
  void cart.loadCatalog().then(() => {
    cart.publish();
    if (isOpen.value) focusScan();
  });
});

onUnmounted(() => {
  window.removeEventListener("keydown", onKeydown, true);
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
            autofocus
            :placeholder="pendingQty > 1 ? `คูณ x${pendingQty}` : 'บาร์โค้ด'"
            @input="onScanInput"
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
                  <td class="num col-price">{{ line.unitPrice.toFixed(2) }}</td>
                  <td class="num col-disc">{{ line.discount.toFixed(2) }}</td>
                  <td class="num col-total">{{ line.lineTotal.toFixed(2) }}</td>
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
            <button
              v-if="quickPageCount > 1"
              type="button"
              class="quick-nav"
              :disabled="quickPage <= 0"
              aria-label="หน้าก่อน"
              @click.stop="quickPage = Math.max(0, quickPage - 1)"
            >
              ‹
            </button>

            <div class="quick-grid">
              <button
                v-for="p in pagedQuick"
                :key="p.id"
                type="button"
                class="quick-tile"
                @click.stop="
                  requireShift() &&
                    (cart.addQuick(p), focusScan(), scrollCartToBottom())
                "
              >
                <span class="quick-thumb">
                  <img :src="p.image" :alt="p.name" loading="lazy" />
                </span>
                <span class="quick-copy">
                  <span class="quick-name">{{ p.name }}</span>
                  <span class="quick-price">{{ p.price!.toFixed(2) }} ฿</span>
                </span>
              </button>
            </div>

            <button
              v-if="quickPageCount > 1"
              type="button"
              class="quick-nav"
              :disabled="quickPage >= quickPageCount - 1"
              aria-label="หน้าถัดไป"
              @click.stop="quickPage = Math.min(quickPageCount - 1, quickPage + 1)"
            >
              ›
            </button>
          </div>
          <div v-if="quickPageCount > 1" class="quick-page-dots">
            {{ quickPage + 1 }} / {{ quickPageCount }}
          </div>
        </div>

        <div class="func-row">
          <div class="func-grid primary">
            <button
              v-for="btn in primaryActions"
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
          <button
            type="button"
            class="func-btn func-btn-tall"
            :class="closeShiftAction.tone"
            @click.stop="closeShiftAction.run()"
          >
            <span class="func-label">{{ closeShiftAction.label }}</span>
            <span v-if="closeShiftAction.hint" class="func-hint">
              {{ closeShiftAction.hint }}
            </span>
          </button>
        </div>
      </section>

      <aside class="side">
        <div class="side-card side-meta">
          <div class="side-top">
            <div class="terminal">001</div>
            <div class="date">{{ today }}</div>
          </div>
          <div class="brand-block">
            <div class="brand-mark">AP</div>
            <div class="brand-text">
              <div class="brand-name">AP หมูสด</div>
              <div class="brand-tag">Fresh Pork POS</div>
            </div>
          </div>
        </div>

        <div class="side-card">
          <div class="bill-no">{{ billNo }}</div>
          <div class="side-member-row">
            <button
              type="button"
              class="side-member-btn"
              :class="{ 'is-member': Boolean(memberId) }"
              @pointerdown.stop.prevent="openMemberSearch"
            >
              <span class="side-member-label">ลูกค้า</span>
              <strong class="side-member-name">{{ memberName }}</strong>
              <span v-if="memberPoints > 0" class="side-points">
                {{ memberPoints }} แต้ม
              </span>
              <span class="side-member-action">
                {{ memberId ? "เปลี่ยน / ยกเลิก" : "เลือกสมาชิก" }}
              </span>
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

          <div v-if="appliedPromos.length || billDiscount > 0" class="disc-block">
            <div v-for="p in appliedPromos" :key="p.promoId" class="disc-line">
              <span>{{ p.label }}</span>
              <strong>-{{ p.discount.toFixed(2) }}</strong>
            </div>
            <div class="disc-line">
              <span>ส่วนลดรวม</span>
              <strong>-{{ billDiscount.toFixed(2) }}</strong>
            </div>
          </div>

          <div class="total-block">
            <span>รวมเงิน</span>
            <strong>{{ summary.total.toFixed(2) }}</strong>
          </div>
        </div>

        <div class="change-block" :class="{ 'has-change': lastChange > 0 }">
          <span>{{ lastChange > 0 ? "ทอนบิลล่าสุด" : "เงินทอน" }}</span>
          <strong>{{ lastChange.toFixed(2) }}</strong>
        </div>

        <button type="button" class="pay-btn" @click.stop="openPayment">
          <span class="pay-btn-label">ชำระเงิน</span>
          <span class="pay-btn-amount">{{ summary.total.toFixed(2) }}</span>
          <span class="pay-btn-hint">{{ settings.label("open_payment") }}</span>
        </button>
      </aside>
    </div>

    <footer class="status-bar">
      <span>AP Retail — Version 0.1.0</span>
      <span>สาขา (00001) สาขาหลุมดิน</span>
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
    <OpenShiftModal v-model:open="openShiftOpen" :required="!isOpen" @opened="focusScan" />
    <CloseShiftModal
      v-model:open="closeShiftOpen"
      @closed="openShiftOpen = true"
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
