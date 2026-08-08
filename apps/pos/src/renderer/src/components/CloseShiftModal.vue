<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { storeToRefs } from "pinia";
import type { CommissionResult } from "@ap-pos/shared";
import { useSessionStore } from "../stores/session";
import { useCartStore } from "../stores/cart";
import { useSettingsStore } from "../stores/settings";
import CashCountModal from "./CashCountModal.vue";
import type { DenomCount } from "../data/cash-denoms";
import { printShiftCloseReport } from "../services/shift-close-report";

const open = defineModel<boolean>("open", { default: false });
const emit = defineEmits<{ closed: [] }>();

const session = useSessionStore();
const cart = useCartStore();
const settings = useSettingsStore();
const {
  staff,
  openedAt,
  openCash,
  floatCounted,
  summary,
  audits,
  cashMoves,
  device,
} = storeToRefs(session);
const { storeName, storeTagline } = storeToRefs(settings);

const countOpen = ref(false);
const countBtn = ref<HTMLButtonElement | null>(null);
const closing = ref(false);
const commission = ref<CommissionResult | null>(null);
const commissionLoading = ref(false);

const hasVoids = computed(
  () => summary.value.voidLineCount > 0 || summary.value.voidBillCount > 0,
);
const recentAudits = computed(() => audits.value.slice(-4).reverse());
const recentMoves = computed(() => cashMoves.value.slice(-4).reverse());

async function refreshCommission() {
  if (!open.value) return;
  commissionLoading.value = true;
  try {
    commission.value = await session.getCloseCommission();
  } catch {
    commission.value = null;
  } finally {
    commissionLoading.value = false;
  }
}

function money(n: number) {
  return n.toLocaleString("th-TH", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

function startCount() {
  if (closing.value) return;
  countOpen.value = true;
}

async function printClosedReport(
  closed: Awaited<ReturnType<typeof session.closeShift>> | undefined,
) {
  if (!closed) return;
  try {
    await printShiftCloseReport(closed, {
      storeName: storeName.value || "AP หมูสด",
      branchName: device.value.branchName || "",
      terminalName: device.value.terminalName || "เครื่อง POS",
      tagline: storeTagline.value || undefined,
    }, {
      preview: false,
      silent: true,
    });
  } catch {
    // พิมพ์พังก็ปิดรอบต่อได้
  }
}

async function shutdownAfterClose() {
  // ปิดจอลูกค้าก่อน แล้วค่อยปิดแอป — ไม่ให้จอ 2 ค้างหลังปิดรอบ
  try {
    window.apPos?.setCustomerScreenEnabled?.(false);
  } catch {
    // ignore
  }
  if (window.apPos?.quit) {
    try {
      await window.apPos.quit();
      return;
    } catch {
      // fall through
    }
  }
  emit("closed");
}

async function closeWithoutCount() {
  if (closing.value) return;
  closing.value = true;
  session.markExiting();
  try {
    const closed = await session.closeShift().catch(() => undefined);
    cart.clearHeldBills();
    await printClosedReport(closed);
  } finally {
    // ปิดระบบเสมอ — ออฟไลน์ข้อมูลค้าง outbox ไว้รอบถัดไป
    await shutdownAfterClose();
    closing.value = false;
  }
}

async function onCounted(payload: {
  total: number;
  denoms: DenomCount[];
  note?: string;
}) {
  if (closing.value) return;
  closing.value = true;
  session.markExiting();
  try {
    const closed = await session.closeShift(payload).catch(() => undefined);
    cart.clearHeldBills();
    await printClosedReport(closed);
  } finally {
    await shutdownAfterClose();
    closing.value = false;
  }
}

function cancel() {
  if (closing.value) return;
  open.value = false;
}

function focusFirst() {
  if (!open.value || countOpen.value) return;
  void nextTick(() => countBtn.value?.focus());
}

watch(open, (v) => {
  if (!v) {
    countOpen.value = false;
    commission.value = null;
    return;
  }
  focusFirst();
  requestAnimationFrame(() => focusFirst());
  void refreshCommission();
});

function onKey(e: KeyboardEvent) {
  if (!open.value || countOpen.value) return;
  if (e.key === "Escape") {
    e.preventDefault();
    e.stopPropagation();
    cancel();
    return;
  }
  if (e.key === "Enter" && !closing.value) {
    e.preventDefault();
    e.stopPropagation();
    startCount();
  }
}

onMounted(() => window.addEventListener("keydown", onKey, true));
onUnmounted(() => window.removeEventListener("keydown", onKey, true));

function fmt(iso: string | null) {
  if (!iso) return "-";
  return new Date(iso).toLocaleString("th-TH", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function auditLabel(type: string) {
  return type === "line_void" ? "ยกเลิกรายการ" : "ยกเลิกบิล";
}
</script>

<template>
  <div v-if="open" class="pay-overlay">
    <div class="pay-modal pay-modal-compact" @click.stop>
      <header class="pay-head">
        <h2>ปิดรอบการขาย</h2>
        <span class="pay-esc-hint">Esc ปิด</span>
      </header>

      <div
        v-if="commissionLoading"
        class="shift-commission shift-commission--loading"
      >
        กำลังคำนวณค่าคอม...
      </div>
      <div
        v-else-if="commission?.enabled"
        class="shift-commission"
        :class="{ 'shift-commission--earned': commission.amount > 0 }"
      >
        <div class="shift-commission-label">ค่าคอมมิชชั่นวันนี้</div>
        <div class="shift-commission-amount">
          {{ money(commission.amount) }}
          <small>บาท</small>
        </div>
        <div class="shift-commission-meta">
          ยอดขายวันนี้ {{ money(commission.daySales) }}฿
          <template v-if="commission.amount > 0">
            · ได้ {{ commission.steps }} ขั้น
          </template>
          <template v-else-if="commission.nextTierAt != null">
            · เริ่มได้คอมที่ {{ money(commission.nextTierAt) }}฿
          </template>
        </div>
        <div
          v-if="commission.nextTierAt != null && commission.amount > 0"
          class="shift-commission-next"
        >
          ขั้นถัดไป {{ money(commission.nextTierAt) }}฿ → คอม
          {{ money(commission.nextTierAmount ?? 0) }}฿
        </div>
      </div>

      <div v-if="!floatCounted" class="pay-warn">
        ยังไม่ได้นับเงินทอนเริ่มรอบ — ยอดคาดในลิ้นชักอาจไม่ตรง
      </div>

      <div class="shift-summary-grid">
        <div class="shift-cell">
          <span>พนักงาน</span>
          <strong>{{ staff?.name ?? "-" }}</strong>
        </div>
        <div class="shift-cell">
          <span>เปิดรอบ</span>
          <strong>{{ fmt(openedAt) }}</strong>
        </div>
        <div class="shift-cell">
          <span>เงินทอนเริ่ม</span>
          <strong>
            {{ floatCounted ? openCash.toFixed(0) : "ยังไม่นับ" }}
          </strong>
        </div>
        <div class="shift-cell">
          <span>จำนวนบิล</span>
          <strong>{{ summary.billCount }}</strong>
        </div>
        <div class="shift-cell shift-cell-wide shift-total">
          <span>ยอดขายรวม (รอบนี้)</span>
          <strong>{{ summary.grossTotal.toFixed(2) }}</strong>
        </div>
        <div class="shift-cell">
          <span>ขายเงินสด</span>
          <strong>{{ summary.byMethod.cash.toFixed(0) }}</strong>
        </div>
        <div class="shift-cell">
          <span>เงินโอน</span>
          <strong>{{ summary.byMethod.transfer.toFixed(0) }}</strong>
        </div>
        <div class="shift-cell">
          <span>เงินสวัสดิการ</span>
          <strong>{{ summary.byMethod.government.toFixed(0) }}</strong>
        </div>
        <div class="shift-cell">
          <span>นำเงินเข้า</span>
          <strong>+{{ summary.cashInTotal.toFixed(0) }}</strong>
        </div>
        <div class="shift-cell">
          <span>นำเงินออก</span>
          <strong>-{{ summary.cashOutTotal.toFixed(0) }}</strong>
        </div>
        <div class="shift-cell shift-cell-wide shift-expected">
          <span>เงินในลิ้นชัก (ระบบคาด)</span>
          <strong>{{ summary.expectedCash.toFixed(0) }}</strong>
        </div>
        <div class="shift-cell" :class="{ 'shift-alert': summary.voidLineCount > 0 }">
          <span>ยกเลิกรายการ</span>
          <strong>
            {{ summary.voidLineCount }} / {{ summary.voidLineAmount.toFixed(0) }}฿
          </strong>
        </div>
        <div class="shift-cell" :class="{ 'shift-alert': summary.voidBillCount > 0 }">
          <span>ยกเลิกบิล</span>
          <strong>
            {{ summary.voidBillCount }} / {{ summary.voidBillAmount.toFixed(0) }}฿
          </strong>
        </div>
      </div>

      <div v-if="recentMoves.length" class="shift-moves-box">
        <div class="shift-moves-head">เงินเข้า–ออกล่าสุด</div>
        <div v-for="m in recentMoves" :key="m.id" class="shift-audit-row">
          <span>
            {{ fmt(m.at) }} · {{ m.direction === "out" ? "ออก" : "เข้า" }} ·
            {{ m.reason }}
          </span>
          <strong :class="m.direction === 'out' ? 'move-out' : 'move-in'">
            {{ m.direction === "out" ? "-" : "+" }}{{ m.amount.toFixed(0) }}
          </strong>
        </div>
      </div>

      <div v-if="hasVoids" class="shift-audit-box">
        <div class="shift-audit-head">ประวัติยกเลิกล่าสุด</div>
        <div v-for="a in recentAudits" :key="a.id" class="shift-audit-row">
          <span>
            {{ fmt(a.at) }} · {{ auditLabel(a.type) }}
            <template v-if="a.productName"> · {{ a.productName }}</template>
          </span>
          <strong>-{{ a.amount.toFixed(0) }}</strong>
        </div>
      </div>

      <p class="pay-note pay-note-compact">
        แนะนำให้นับเงินแล้วปิด · พิมพ์ใบปิดรอบอัตโนมัติก่อนปิดแอป
      </p>

      <footer class="open-shift-actions close-shift-actions">
        <button
          type="button"
          class="pay-cancel"
          :disabled="closing"
          @click="cancel"
        >
          ยกเลิก
        </button>
        <button
          type="button"
          class="pay-cancel"
          :disabled="closing"
          @click="closeWithoutCount"
        >
          {{ closing ? "กำลังส่งข้อมูลแล้วปิด..." : "ปิดรอบเลย" }}
          <small>ไม่นับเงิน · ปิดระบบ</small>
        </button>
        <button
          ref="countBtn"
          type="button"
          class="pay-confirm"
          :disabled="closing"
          @click="startCount"
        >
          {{ closing ? "กำลังส่งข้อมูลแล้วปิด..." : "นับเงินแล้วปิด" }}
          <small>Enter · ค่าเริ่มต้น</small>
        </button>
      </footer>
    </div>

    <CashCountModal
      v-model:open="countOpen"
      purpose="close"
      :expected="summary.expectedCash"
      @saved="onCounted"
    />
  </div>
</template>
