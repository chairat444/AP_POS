<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { storeToRefs } from "pinia";
import { useSessionStore } from "../stores/session";
import { formatMoney } from "../utils/format";

const open = defineModel<boolean>("open", { default: false });

const session = useSessionStore();
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

const closeBtn = ref<HTMLButtonElement | null>(null);

const hasVoids = computed(
  () => summary.value.voidLineCount > 0 || summary.value.voidBillCount > 0,
);
const recentAudits = computed(() => audits.value.slice(-5).reverse());
const recentMoves = computed(() => cashMoves.value.slice(-5).reverse());

function fmt(iso: string | null | undefined) {
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

function close() {
  open.value = false;
}

function focusClose() {
  void nextTick(() => closeBtn.value?.focus());
}

watch(open, (v) => {
  if (!v) return;
  focusClose();
  requestAnimationFrame(() => focusClose());
});

function onKey(e: KeyboardEvent) {
  if (!open.value) return;
  if (e.key === "Escape" || e.key === "Enter") {
    e.preventDefault();
    e.stopPropagation();
    close();
  }
}

onMounted(() => window.addEventListener("keydown", onKey, true));
onUnmounted(() => window.removeEventListener("keydown", onKey, true));
</script>

<template>
  <div v-if="open" class="pay-overlay" @mousedown.self="close">
    <div class="pay-modal pay-modal-wide sale-summary-modal" @click.stop>
      <header class="pay-head">
        <h2>สรุปการขาย</h2>
        <span class="pay-esc-hint">Esc / Enter ปิด</span>
      </header>

      <p class="pay-note pay-note-compact">
        {{ device.branchName || "สาขา" }} ·
        {{ device.terminalName || "เครื่อง POS" }} · รอบปัจจุบัน
      </p>

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
            {{ floatCounted ? formatMoney(openCash) : "ยังไม่นับ" }}
          </strong>
        </div>
        <div class="shift-cell">
          <span>จำนวนบิล</span>
          <strong>{{ summary.billCount }}</strong>
        </div>
        <div class="shift-cell shift-cell-wide shift-total">
          <span>ยอดขายรวม (รอบนี้)</span>
          <strong>{{ formatMoney(summary.grossTotal) }}</strong>
        </div>
        <div class="shift-cell">
          <span>ขายเงินสด</span>
          <strong>{{ formatMoney(summary.byMethod.cash) }}</strong>
        </div>
        <div class="shift-cell">
          <span>เงินโอน</span>
          <strong>{{ formatMoney(summary.byMethod.transfer) }}</strong>
        </div>
        <div class="shift-cell">
          <span>เงินสวัสดิการ</span>
          <strong>{{ formatMoney(summary.byMethod.government) }}</strong>
        </div>
        <div class="shift-cell">
          <span>ใช้แต้ม</span>
          <strong>{{ formatMoney(summary.byMethod.points) }}</strong>
        </div>
        <div class="shift-cell">
          <span>นำเงินเข้า</span>
          <strong>+{{ formatMoney(summary.cashInTotal) }}</strong>
        </div>
        <div class="shift-cell">
          <span>นำเงินออก</span>
          <strong>-{{ formatMoney(summary.cashOutTotal) }}</strong>
        </div>
        <div class="shift-cell shift-cell-wide shift-expected">
          <span>เงินในลิ้นชัก (ระบบคาด)</span>
          <strong>{{ formatMoney(summary.expectedCash) }}</strong>
        </div>
        <div
          class="shift-cell"
          :class="{ 'shift-alert': summary.voidLineCount > 0 }"
        >
          <span>ยกเลิกรายการ</span>
          <strong>
            {{ summary.voidLineCount }} /
            {{ formatMoney(summary.voidLineAmount) }}฿
          </strong>
        </div>
        <div
          class="shift-cell"
          :class="{ 'shift-alert': summary.voidBillCount > 0 }"
        >
          <span>ยกเลิกบิล</span>
          <strong>
            {{ summary.voidBillCount }} /
            {{ formatMoney(summary.voidBillAmount) }}฿
          </strong>
        </div>
        <div class="shift-cell">
          <span>แต้มที่แลก</span>
          <strong>{{ formatMoney(summary.pointsRedeemed) }}</strong>
        </div>
        <div class="shift-cell">
          <span>แต้มที่สะสม</span>
          <strong>{{ formatMoney(summary.pointsEarned) }}</strong>
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
            {{ m.direction === "out" ? "-" : "+" }}{{ formatMoney(m.amount) }}
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
          <strong>-{{ formatMoney(a.amount) }}</strong>
        </div>
      </div>

      <footer class="open-shift-actions">
        <button
          ref="closeBtn"
          type="button"
          class="pay-confirm"
          @click="close"
        >
          ปิด
          <small>Enter</small>
        </button>
      </footer>
    </div>
  </div>
</template>
