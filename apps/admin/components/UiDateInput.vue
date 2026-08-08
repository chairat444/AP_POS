<script setup lang="ts">
import {
  computed,
  nextTick,
  onMounted,
  onUnmounted,
  ref,
  watch,
} from "vue";

const props = withDefaults(
  defineProps<{
    modelValue?: string;
    ariaLabel?: string;
    disabled?: boolean;
  }>(),
  {
    modelValue: "",
    ariaLabel: "เลือกวันที่",
    disabled: false,
  },
);

const emit = defineEmits<{
  "update:modelValue": [value: string];
  change: [value: string];
}>();

const TH_MONTHS = [
  "มกราคม",
  "กุมภาพันธ์",
  "มีนาคม",
  "เมษายน",
  "พฤษภาคม",
  "มิถุนายน",
  "กรกฎาคม",
  "สิงหาคม",
  "กันยายน",
  "ตุลาคม",
  "พฤศจิกายน",
  "ธันวาคม",
] as const;

const TH_MONTHS_SHORT = [
  "ม.ค.",
  "ก.พ.",
  "มี.ค.",
  "เม.ย.",
  "พ.ค.",
  "มิ.ย.",
  "ก.ค.",
  "ส.ค.",
  "ก.ย.",
  "ต.ค.",
  "พ.ย.",
  "ธ.ค.",
] as const;

const TH_WEEKDAYS = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"] as const;

const POP_WIDTH = 280;

const open = ref(false);
const root = ref<HTMLElement | null>(null);
const pop = ref<HTMLElement | null>(null);
const viewYear = ref(new Date().getFullYear());
const viewMonth = ref(new Date().getMonth());
const popStyle = ref<Record<string, string>>({
  position: "fixed",
  top: "0px",
  left: "0px",
  width: `${POP_WIDTH}px`,
  zIndex: "5000",
});
/** กันคลิกเปิดแล้วถูก document listener ปิดในทันที */
let ignoreOutsideUntil = 0;

function parseIso(iso?: string) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  if (
    dt.getFullYear() !== y ||
    dt.getMonth() !== m - 1 ||
    dt.getDate() !== d
  ) {
    return null;
  }
  return dt;
}

function toIso(y: number, m0: number, d: number) {
  return `${y}-${String(m0 + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function todayIso() {
  const n = new Date();
  return toIso(n.getFullYear(), n.getMonth(), n.getDate());
}

const selected = computed(() => parseIso(props.modelValue));

const displayText = computed(() => {
  const dt = selected.value;
  if (!dt) return "เลือกวันที่";
  return `${dt.getDate()} ${TH_MONTHS_SHORT[dt.getMonth()]} ${dt.getFullYear() + 543}`;
});

const viewTitle = computed(
  () => `${TH_MONTHS[viewMonth.value]} ${viewYear.value + 543}`,
);

const cells = computed(() => {
  const first = new Date(viewYear.value, viewMonth.value, 1);
  const startPad = first.getDay();
  const daysInMonth = new Date(
    viewYear.value,
    viewMonth.value + 1,
    0,
  ).getDate();
  const prevDays = new Date(viewYear.value, viewMonth.value, 0).getDate();
  const out: Array<{
    day: number;
    iso: string;
    inMonth: boolean;
    isToday: boolean;
    isSelected: boolean;
  }> = [];
  const today = todayIso();
  const sel = props.modelValue;

  for (let i = startPad - 1; i >= 0; i--) {
    const day = prevDays - i;
    const m0 = viewMonth.value - 1;
    const y = m0 < 0 ? viewYear.value - 1 : viewYear.value;
    const mm = (m0 + 12) % 12;
    const iso = toIso(y, mm, day);
    out.push({
      day,
      iso,
      inMonth: false,
      isToday: iso === today,
      isSelected: iso === sel,
    });
  }
  for (let day = 1; day <= daysInMonth; day++) {
    const iso = toIso(viewYear.value, viewMonth.value, day);
    out.push({
      day,
      iso,
      inMonth: true,
      isToday: iso === today,
      isSelected: iso === sel,
    });
  }
  while (out.length % 7 !== 0 || out.length < 42) {
    const day = out.length - (startPad + daysInMonth) + 1;
    const m0 = viewMonth.value + 1;
    const y = m0 > 11 ? viewYear.value + 1 : viewYear.value;
    const mm = m0 % 12;
    const iso = toIso(y, mm, day);
    out.push({
      day,
      iso,
      inMonth: false,
      isToday: iso === today,
      isSelected: iso === sel,
    });
  }
  return out;
});

function syncViewFromModel() {
  const dt = selected.value ?? new Date();
  viewYear.value = dt.getFullYear();
  viewMonth.value = dt.getMonth();
}

function placePop(preferredHeight = 320) {
  const el = root.value;
  if (!el) return;
  const r = el.getBoundingClientRect();
  const gap = 6;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const h = pop.value?.offsetHeight || preferredHeight;

  let left = r.left;
  if (left + POP_WIDTH > vw - 8) left = Math.max(8, vw - POP_WIDTH - 8);
  if (left < 8) left = 8;

  const below = r.bottom + gap;
  const above = r.top - gap - h;
  const fitsBelow = below + h <= vh - 8;
  const top = fitsBelow ? below : Math.max(8, above);

  popStyle.value = {
    position: "fixed",
    top: `${top}px`,
    left: `${left}px`,
    width: `${POP_WIDTH}px`,
    zIndex: "5000",
  };
}

function openPicker() {
  if (props.disabled) return;
  syncViewFromModel();
  placePop();
  ignoreOutsideUntil = Date.now() + 400;
  open.value = true;
  void nextTick(() => {
    placePop();
  });
}

function close() {
  open.value = false;
}

function toggle(e: Event) {
  e.preventDefault();
  e.stopPropagation();
  if (props.disabled) return;
  if (open.value) close();
  else openPicker();
}

function pick(iso: string) {
  emit("update:modelValue", iso);
  emit("change", iso);
  close();
}

function shiftMonth(delta: number) {
  const d = new Date(viewYear.value, viewMonth.value + delta, 1);
  viewYear.value = d.getFullYear();
  viewMonth.value = d.getMonth();
}

function pickToday() {
  pick(todayIso());
}

function onDocPointer(e: PointerEvent) {
  if (!open.value) return;
  if (Date.now() < ignoreOutsideUntil) return;
  const t = e.target as Node;
  if (root.value?.contains(t) || pop.value?.contains(t)) return;
  close();
}

function onKey(e: KeyboardEvent) {
  if (e.key === "Escape" && open.value) close();
}

function onReposition() {
  if (open.value) placePop();
}

watch(
  () => props.modelValue,
  () => {
    if (open.value) syncViewFromModel();
  },
);

onMounted(() => {
  document.addEventListener("pointerdown", onDocPointer, true);
  document.addEventListener("keydown", onKey, true);
  window.addEventListener("resize", onReposition);
  window.addEventListener("scroll", onReposition, true);
});
onUnmounted(() => {
  document.removeEventListener("pointerdown", onDocPointer, true);
  document.removeEventListener("keydown", onKey, true);
  window.removeEventListener("resize", onReposition);
  window.removeEventListener("scroll", onReposition, true);
});
</script>

<template>
  <div ref="root" class="ui-date">
    <button
      type="button"
      class="ui-input ui-date__trigger"
      :disabled="disabled"
      :aria-label="ariaLabel"
      :aria-expanded="open"
      @pointerdown="toggle"
    >
      <span :class="{ 'is-placeholder': !selected }">{{ displayText }}</span>
      <svg
        class="ui-date__icon"
        viewBox="0 0 24 24"
        width="16"
        height="16"
        aria-hidden="true"
      >
        <rect
          x="3"
          y="5"
          width="18"
          height="16"
          rx="2"
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
        />
        <path
          d="M3 10h18M8 3v4M16 3v4"
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
        />
      </svg>
    </button>

    <Teleport to="body">
      <div
        v-show="open"
        ref="pop"
        class="ui-date__pop"
        role="dialog"
        :aria-label="ariaLabel"
        :style="popStyle"
        @pointerdown.stop
      >
        <div class="ui-date__head">
          <button
            type="button"
            class="ui-btn ui-btn--ghost ui-date__nav"
            title="เดือนก่อน"
            @click="shiftMonth(-1)"
          >
            ‹
          </button>
          <strong>{{ viewTitle }}</strong>
          <button
            type="button"
            class="ui-btn ui-btn--ghost ui-date__nav"
            title="เดือนถัดไป"
            @click="shiftMonth(1)"
          >
            ›
          </button>
        </div>

        <div class="ui-date__weekdays">
          <span v-for="w in TH_WEEKDAYS" :key="w">{{ w }}</span>
        </div>

        <div class="ui-date__grid">
          <button
            v-for="cell in cells"
            :key="`${cell.iso}-${cell.inMonth ? 1 : 0}`"
            type="button"
            class="ui-date__cell"
            :class="{
              'is-out': !cell.inMonth,
              'is-today': cell.isToday,
              'is-selected': cell.isSelected,
            }"
            @click="pick(cell.iso)"
          >
            {{ cell.day }}
          </button>
        </div>

        <div class="ui-date__foot">
          <button type="button" class="ui-btn ui-btn--ghost" @click="pickToday">
            วันนี้
          </button>
          <button type="button" class="ui-btn ui-btn--ghost" @click="close">
            ปิด
          </button>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.ui-date {
  position: relative;
  display: inline-block;
  min-width: 10.5rem;
  vertical-align: top;
}

.ui-date__trigger {
  width: 100%;
  display: inline-flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  text-align: left;
  cursor: pointer;
  font: inherit;
  color: inherit;
  white-space: nowrap;
}

.ui-date__trigger .is-placeholder {
  color: #94a3b8;
}

.ui-date__trigger:disabled {
  cursor: not-allowed;
  opacity: 0.65;
}

.ui-date__icon {
  flex: 0 0 auto;
  opacity: 0.55;
  color: #64748b;
}
</style>

<style>
.ui-date__pop {
  box-sizing: border-box;
  padding: 0.75rem;
  border-radius: 0.85rem;
  border: 1px solid #e2e8f0;
  background: #fff;
  box-shadow: 0 16px 40px rgba(15, 23, 42, 0.18);
}

.ui-date__pop[style*="display: none"] {
  pointer-events: none;
}

.ui-date__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.35rem;
  margin-bottom: 0.55rem;
}

.ui-date__head strong {
  font-size: 0.92rem;
  font-weight: 700;
  color: #0f172a;
}

.ui-date__nav {
  min-width: 2rem;
  padding: 0.25rem 0.45rem;
}

.ui-date__weekdays {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 0.15rem;
  margin-bottom: 0.25rem;
  text-align: center;
  font-size: 0.72rem;
  font-weight: 700;
  color: #94a3b8;
}

.ui-date__grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 0.15rem;
}

.ui-date__cell {
  appearance: none;
  border: 0;
  background: transparent;
  border-radius: 0.45rem;
  height: 2rem;
  font: inherit;
  font-size: 0.86rem;
  font-weight: 600;
  color: #0f172a;
  cursor: pointer;
}

.ui-date__cell:hover {
  background: #f1f5f9;
}

.ui-date__cell.is-out {
  color: #cbd5e1;
  font-weight: 500;
}

.ui-date__cell.is-today {
  box-shadow: inset 0 0 0 1px
    color-mix(in srgb, var(--ui-primary, #0f766e) 55%, #94a3b8);
}

.ui-date__cell.is-selected {
  background: var(--ui-primary, #0f766e);
  color: #fff;
}

.ui-date__cell.is-selected:hover {
  background: var(--ui-primary-dark, #0f5a3d);
  color: #fff;
}

.ui-date__foot {
  display: flex;
  justify-content: space-between;
  gap: 0.5rem;
  margin-top: 0.55rem;
  padding-top: 0.45rem;
  border-top: 1px solid #f1f5f9;
}

.ui-date__foot .ui-btn {
  padding: 0.3rem 0.65rem;
  font-size: 0.82rem;
}
</style>
