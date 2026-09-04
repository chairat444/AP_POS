<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from "vue";
import { storeToRefs } from "pinia";
import { useCartStore } from "../stores/cart";

const open = defineModel<boolean>("open", { default: false });
const mode = defineModel<"hold" | "recall">("mode", { default: "recall" });

const cart = useCartStore();
const { heldBills, lines } = storeToRefs(cart);

const selected = ref(0);

watch(open, (v) => {
  if (!v) return;
  selected.value = 0;
});

watch(
  () => heldBills.value.length,
  () => {
    if (selected.value >= heldBills.value.length) {
      selected.value = Math.max(0, heldBills.value.length - 1);
    }
  },
);

function close() {
  open.value = false;
}

function doHold() {
  open.value = false;
  cart.holdBill();
}

function doRecall(id: string) {
  open.value = false;
  cart.recallBill(id);
}

function doDelete(id: string) {
  cart.deleteHeldBill(id);
  if (!heldBills.value.length) close();
}

function recallSelected() {
  if (lines.value.length) return;
  const b = heldBills.value[selected.value] ?? heldBills.value[0];
  if (b) doRecall(b.id);
}

function deleteSelected() {
  const b = heldBills.value[selected.value];
  if (b) doDelete(b.id);
}

function onKey(e: KeyboardEvent) {
  if (!open.value) return;

  if (e.key === "Escape") {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    close();
    return;
  }

  if (mode.value === "hold") {
    if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      doHold();
    }
    return;
  }

  if (e.key === "ArrowDown") {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    if (!heldBills.value.length) return;
    selected.value = (selected.value + 1) % heldBills.value.length;
    return;
  }
  if (e.key === "ArrowUp") {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    if (!heldBills.value.length) return;
    selected.value =
      (selected.value - 1 + heldBills.value.length) % heldBills.value.length;
    return;
  }
  if (e.key === "Delete" || e.key === "Backspace") {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    deleteSelected();
    return;
  }
  if (e.key === "Enter") {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    recallSelected();
  }
}

onMounted(() => window.addEventListener("keydown", onKey, true));
onUnmounted(() => window.removeEventListener("keydown", onKey, true));

function fmt(iso: string) {
  return new Date(iso).toLocaleTimeString("th-TH", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function billTotal(linesIn: { lineTotal: number }[]) {
  return linesIn.reduce((s, l) => s + l.lineTotal, 0).toFixed(2);
}
</script>

<template>
  <div v-if="open" class="pay-overlay" @mousedown.self="close">
    <div class="pay-modal pay-modal-wide" @click.stop @mousedown.stop>
      <header class="pay-head">
        <h2>{{ mode === "hold" ? "พักบิล" : "เรียกบิลที่พัก" }}</h2>
        <button
          type="button"
          class="pay-cancel"
          style="padding: 8px 12px"
          @mousedown.prevent.stop="close"
        >
          ปิด Esc
        </button>
      </header>

      <template v-if="mode === 'hold'">
        <p class="pay-note">
          พักบิลปัจจุบัน ({{ lines.length }} รายการ) แล้วเคลียร์จอเพื่อรับลูกค้าใหม่
          · กด Enter เพื่อยืนยัน
        </p>
        <footer class="pay-actions">
          <button type="button" class="pay-cancel" @mousedown.prevent.stop="close">
            ยกเลิก
          </button>
          <button
            type="button"
            class="pay-confirm"
            :disabled="!lines.length"
            @mousedown.prevent.stop="doHold"
          >
            ยืนยันพักบิล Enter
          </button>
        </footer>
      </template>

      <template v-else>
        <p v-if="lines.length" class="pay-warn">
          มีรายการบนจออยู่ — พักหรือยกเลิกบิลปัจจุบันก่อนเรียกบิลที่พัก
        </p>
        <p v-else class="pay-note">
          คลิกเรียก · Delete ลบ · Enter เรียกบิลที่เลือก
        </p>
        <ul v-if="heldBills.length" class="search-list">
          <li v-for="(b, i) in heldBills" :key="b.id" class="held-row">
            <button
              type="button"
              class="search-row"
              :class="{ active: i === selected }"
              :disabled="lines.length > 0"
              @pointerdown.prevent.stop="doRecall(b.id)"
              @mouseenter="selected = i"
            >
              <span class="search-main">
                <strong>{{ b.label }}</strong>
                <span>
                  {{ fmt(b.heldAt) }} · {{ b.lines.length }} รายการ ·
                  {{ b.memberName }}
                </span>
              </span>
              <span class="search-meta">{{ billTotal(b.lines) }}</span>
            </button>
            <button
              type="button"
              class="held-del"
              title="ลบบิลพัก"
              @pointerdown.prevent.stop="doDelete(b.id)"
            >
              ลบ
            </button>
          </li>
        </ul>
        <p v-else class="pay-note">ยังไม่มีบิลที่พักไว้</p>
        <footer class="pay-actions">
          <button type="button" class="pay-cancel" @mousedown.prevent.stop="close">
            ปิด
          </button>
        </footer>
      </template>
    </div>
  </div>
</template>
