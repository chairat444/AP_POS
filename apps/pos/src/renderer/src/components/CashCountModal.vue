<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { storeToRefs } from "pinia";
import {
  emptyDenomCounts,
  hydrateDenomCounts,
  denomMeta,
  denomSubtotal,
  sumDenomCounts,
  type DenomCount,
} from "../data/cash-denoms";
import { useSessionStore } from "../stores/session";

const open = defineModel<boolean>("open", { default: false });
const props = defineProps<{
  purpose?: "float" | "close";
  expected?: number;
}>();
const emit = defineEmits<{
  saved: [payload: { total: number; denoms: DenomCount[]; note: string }];
  cancel: [];
}>();

const session = useSessionStore();
const { openCash, floatCounted, floatDenoms, summary } = storeToRefs(session);

const rows = ref<DenomCount[]>(emptyDenomCounts());
const inputs = ref<(HTMLInputElement | null)[]>([]);
const error = ref("");
const note = ref("");

const purpose = computed(() => props.purpose ?? "float");
const isEditingFloat = computed(
  () => purpose.value === "float" && floatCounted.value,
);
const total = computed(() => sumDenomCounts(rows.value));
const expected = computed(() =>
  purpose.value === "close"
    ? (props.expected ?? summary.value.expectedCash)
    : null,
);
const variance = computed(() => {
  if (expected.value == null) return null;
  return Math.round((total.value - expected.value) * 100) / 100;
});
const hasVariance = computed(
  () => variance.value != null && variance.value !== 0,
);

function setInputRef(el: unknown, i: number) {
  const node =
    el && typeof el === "object" && "$el" in el
      ? (el as { $el?: unknown }).$el
      : el;
  inputs.value[i] = node instanceof HTMLInputElement ? node : null;
}

function focusAt(i: number) {
  void nextTick(() => {
    const el = inputs.value[i];
    el?.focus();
    el?.select();
  });
}

function loadRows() {
  if (
    purpose.value === "float" &&
    floatCounted.value &&
    floatDenoms.value.length
  ) {
    rows.value = hydrateDenomCounts(floatDenoms.value);
    return;
  }
  rows.value = emptyDenomCounts();
}

watch(open, (v) => {
  if (!v) return;
  loadRows();
  note.value = "";
  error.value = "";
  focusAt(0);
  requestAnimationFrame(() => focusAt(0));
});

function setQty(index: number, raw: string) {
  const n = Math.max(0, Math.floor(Number(raw.replace(/\D/g, "")) || 0));
  rows.value[index] = { ...rows.value[index], qty: n };
}

function clearAll() {
  rows.value = emptyDenomCounts();
  note.value = "";
  focusAt(0);
}

function save() {
  error.value = "";
  if (total.value <= 0) {
    error.value = "ยังไม่ได้ใส่จำนวนใบเงิน";
    focusAt(0);
    return;
  }
  const payload = {
    total: total.value,
    denoms: rows.value.filter((r) => r.qty > 0).map((r) => ({ ...r })),
    note: note.value.trim(),
  };
  if (purpose.value === "float") {
    session.saveFloatCount(rows.value);
  }
  emit("saved", payload);
  open.value = false;
}

function close() {
  open.value = false;
  emit("cancel");
}

function onTileKey(e: KeyboardEvent, index: number) {
  if (e.key === "Enter") {
    e.preventDefault();
    e.stopPropagation();
    if (index >= rows.value.length - 1) {
      save();
      return;
    }
    focusAt(index + 1);
    return;
  }
  if (e.key === "ArrowRight" || e.key === "ArrowDown") {
    e.preventDefault();
    focusAt(Math.min(rows.value.length - 1, index + 1));
    return;
  }
  if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
    e.preventDefault();
    focusAt(Math.max(0, index - 1));
  }
}

function onKey(e: KeyboardEvent) {
  if (!open.value) return;
  if (e.key === "Escape") {
    e.preventDefault();
    e.stopPropagation();
    close();
  }
}

onMounted(() => window.addEventListener("keydown", onKey, true));
onUnmounted(() => window.removeEventListener("keydown", onKey, true));
</script>

<template>
  <div v-if="open" class="pay-overlay">
    <div class="cash-count-sheet" @click.stop>
      <header class="cash-count-head">
        <div>
          <h2>
            {{
              purpose === "float"
                ? isEditingFloat
                  ? "แก้ไขเงินทอน"
                  : "นับเงินทอน"
                : "นับเงินในลิ้นชัก"
            }}
          </h2>
          <p v-if="purpose === 'float'" class="cash-count-sub">
            <template v-if="isEditingFloat">
              ค่าเดิม {{ openCash.toFixed(0) }}฿ · แก้จำนวนแล้วกดบันทึก
            </template>
            <template v-else>ใส่จำนวนใบ/เหรียญ</template>
          </p>
          <p v-else class="cash-count-sub">
            ระบบคาดไว้ {{ (expected ?? 0).toFixed(0) }}฿
          </p>
        </div>
        <span class="pay-esc-hint">Esc ปิด</span>
      </header>

      <div class="denom-tiles">
        <label
          v-for="(row, i) in rows"
          :key="row.denom"
          class="denom-tile"
          :class="[
            `denom-d${row.denom}`,
            `denom-${denomMeta(row.denom).tone}`,
            { filled: row.qty > 0 },
          ]"
        >
          <span class="denom-tile-top">
            <span class="denom-tile-face">{{ row.denom }}</span>
            <span class="denom-tile-kind">{{ denomMeta(row.denom).label }}</span>
          </span>
          <input
            :ref="(el) => setInputRef(el, i)"
            type="text"
            inputmode="numeric"
            :value="row.qty || ''"
            placeholder="0"
            @input="setQty(i, ($event.target as HTMLInputElement).value)"
            @keydown="onTileKey($event, i)"
            @focus="($event.target as HTMLInputElement).select()"
          />
          <span class="denom-tile-sum">= {{ denomSubtotal(row).toFixed(0) }}</span>
        </label>
      </div>

      <div class="cash-count-footer">
        <div class="cash-count-sum">
          <span>รวมนับได้</span>
          <strong>{{ total.toFixed(0) }}</strong>
          <span class="cash-count-baht">บาท</span>
        </div>
        <div
          v-if="variance != null"
          class="cash-count-diff"
          :class="{ bad: variance !== 0 }"
        >
          <span>{{ variance === 0 ? "ตรงกับระบบ" : "ต่างจากระบบ (ปิดได้)" }}</span>
          <strong>{{ variance > 0 ? "+" : "" }}{{ variance.toFixed(0) }}</strong>
        </div>

        <label v-if="purpose === 'close'" class="cash-count-note">
          <span>
            หมายเหตุ
            <template v-if="hasVariance"> · เช่น ลืมบันทึกนำเงินออก</template>
          </span>
          <input
            v-model="note"
            type="text"
            :placeholder="
              hasVariance ? 'อธิบายว่าทำไมยอดไม่ตรง (ไม่บังคับ)' : 'ไม่บังคับ'
            "
          />
        </label>

        <div v-if="error" class="pay-warn cash-count-err">{{ error }}</div>
        <div class="cash-count-actions">
          <button type="button" class="pay-cancel" @click="clearAll">ล้าง</button>
          <button type="button" class="pay-confirm" @click="save">
            {{
              purpose === "float"
                ? isEditingFloat
                  ? "บันทึกการแก้ไข"
                  : "บันทึก"
                : "ปิดรอบ"
            }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
