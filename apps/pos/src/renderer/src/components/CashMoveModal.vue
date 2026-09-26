<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { CASH_IN_REASONS, CASH_OUT_REASONS } from "../data/cash-denoms";
import { kickCashDrawer } from "../services/drawer";
import { useSessionStore } from "../stores/session";

const open = defineModel<boolean>("open", { default: false });
const props = defineProps<{ direction?: "in" | "out" }>();

const session = useSessionStore();
const amountText = ref("");
const reason = ref("");
const note = ref("");
const error = ref("");
const amountEl = ref<HTMLInputElement | null>(null);

const direction = computed(() => props.direction ?? "out");
const reasons = computed(() =>
  direction.value === "out" ? [...CASH_OUT_REASONS] : [...CASH_IN_REASONS],
);
const title = computed(() =>
  direction.value === "out" ? "นำเงินออก" : "นำเงินเข้า",
);

function focusAmount() {
  void nextTick(() => {
    amountEl.value?.focus();
    amountEl.value?.select();
  });
}

watch(open, (v) => {
  if (!v) return;
  amountText.value = "";
  reason.value = reasons.value[0] ?? "อื่นๆ";
  note.value = "";
  error.value = "";
  kickCashDrawer();
  focusAmount();
});

watch(direction, () => {
  reason.value = reasons.value[0] ?? "อื่นๆ";
});

const submitting = ref(false);

async function submit() {
  error.value = "";
  const amount = Number(amountText.value.replace(/\D/g, ""));
  if (!amount || amount <= 0) {
    error.value = "ใส่จำนวนเงิน";
    focusAmount();
    return;
  }
  if (submitting.value) return;
  submitting.value = true;
  try {
    // เตะกับบันทึก/sync คนละทาง — ไม่รอซึ่งกันและกัน
    kickCashDrawer();
    const ok = await session.recordCashMove({
      direction: direction.value,
      amount,
      reason: reason.value,
      note: note.value,
    });
    if (!ok) {
      error.value = session.statusMessage || "บันทึกไม่สำเร็จ";
      return;
    }
    open.value = false;
  } finally {
    submitting.value = false;
  }
}

function close() {
  open.value = false;
}

function onKey(e: KeyboardEvent) {
  if (!open.value) return;
  if (e.key === "Escape") {
    e.preventDefault();
    e.stopPropagation();
    close();
    return;
  }
  if (e.key === "Enter") {
    e.preventDefault();
    submit();
  }
}

onMounted(() => window.addEventListener("keydown", onKey, true));
onUnmounted(() => window.removeEventListener("keydown", onKey, true));
</script>

<template>
  <div v-if="open" class="pay-overlay">
    <div class="pay-modal" @click.stop>
      <header class="pay-head">
        <h2>{{ title }}</h2>
        <span class="pay-esc-hint">Esc ปิด</span>
      </header>

      <p class="pay-note pay-note-compact">
        <template v-if="direction === 'out'">
          เช่น จ่ายค่าน้ำ ค่าของ — ระบบจะหักจากเงินลิ้นชักที่ควรมี
        </template>
        <template v-else>
          เช่น เติมเงินทอนจากสำนักงาน — ระบบจะบวกเข้าลิ้นชักที่ควรมี
        </template>
      </p>

      <label class="pay-field">
        <span>จำนวนเงิน (บาท)</span>
        <input
          ref="amountEl"
          v-model="amountText"
          type="text"
          inputmode="numeric"
          placeholder="เช่น 200"
        />
      </label>

      <label class="pay-field">
        <span>เหตุผล</span>
        <select v-model="reason" class="cash-reason">
          <option v-for="r in reasons" :key="r" :value="r">{{ r }}</option>
        </select>
      </label>

      <label class="pay-field">
        <span>หมายเหตุ (ถ้ามี)</span>
        <input v-model="note" type="text" placeholder="ไม่บังคับ" />
      </label>

      <div v-if="error" class="pay-warn">{{ error }}</div>

      <footer class="pay-actions">
        <button type="button" class="pay-cancel" @click="close">ยกเลิก</button>
        <button
          type="button"
          class="pay-confirm"
          :disabled="submitting"
          @click="submit"
        >
          {{ submitting ? "กำลังส่ง…" : "บันทึก" }}
        </button>
      </footer>
    </div>
  </div>
</template>
