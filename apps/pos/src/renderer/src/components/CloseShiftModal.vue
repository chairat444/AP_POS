<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { storeToRefs } from "pinia";
import { useSessionStore } from "../stores/session";
import { useCartStore } from "../stores/cart";
import CashCountModal from "./CashCountModal.vue";
import type { DenomCount } from "../data/cash-denoms";

const open = defineModel<boolean>("open", { default: false });
const emit = defineEmits<{ closed: [] }>();

const session = useSessionStore();
const cart = useCartStore();
const { staff, openedAt, openCash, floatCounted, summary, audits, cashMoves } =
  storeToRefs(session);

const countOpen = ref(false);
const countBtn = ref<HTMLButtonElement | null>(null);

const hasVoids = computed(
  () => summary.value.voidLineCount > 0 || summary.value.voidBillCount > 0,
);
const recentAudits = computed(() => audits.value.slice(-4).reverse());
const recentMoves = computed(() => cashMoves.value.slice(-4).reverse());

function startCount() {
  countOpen.value = true;
}

function onCounted(payload: {
  total: number;
  denoms: DenomCount[];
  note?: string;
}) {
  session.closeShift(payload);
  cart.clearHeldBills();
  open.value = false;
  emit("closed");
}

function cancel() {
  open.value = false;
}

function focusFirst() {
  if (!open.value || countOpen.value) return;
  void nextTick(() => countBtn.value?.focus());
}

watch(open, (v) => {
  if (!v) {
    countOpen.value = false;
    return;
  }
  focusFirst();
  requestAnimationFrame(() => focusFirst());
});

function onKey(e: KeyboardEvent) {
  if (!open.value || countOpen.value) return;
  if (e.key === "Escape") {
    e.preventDefault();
    e.stopPropagation();
    cancel();
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
          <span>ยอดขายรวม</span>
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
        นับเงินในลิ้นชักแล้วปิดรอบ · ถ้ายอดไม่ตรงระบบก็ปิดได้ ใส่หมายเหตุไว้ได้
      </p>

      <footer class="pay-actions">
        <button type="button" class="pay-cancel" @click="cancel">ยกเลิก</button>
        <button
          ref="countBtn"
          type="button"
          class="pay-confirm"
          @click="startCount"
        >
          นับเงินแล้วปิดรอบ
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
