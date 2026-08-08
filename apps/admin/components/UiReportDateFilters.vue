<script setup lang="ts">
/**
 * แถบช่วงวันที่ร่วมสำหรับหน้า report — รายวัน / ช่วงวันที่
 * ใช้กับ useReportDateFilter() จาก parent
 */
const props = withDefaults(
  defineProps<{
    dateMode: "day" | "range";
    day: string;
    from: string;
    to: string;
    /** แสดงปุ่ม preset วันนี้/เดือนนี้ */
    showPresets?: boolean;
    /** มี preset ปีนี้ด้วย */
    showYearPreset?: boolean;
  }>(),
  {
    showPresets: true,
    showYearPreset: false,
  },
);

const emit = defineEmits<{
  "update:dateMode": [mode: "day" | "range"];
  "update:day": [value: string];
  "update:from": [value: string];
  "update:to": [value: string];
  change: [];
  preset: [kind: "today" | "month" | "year"];
  "shift-day": [delta: -1 | 1];
}>();

function setMode(mode: "day" | "range") {
  if (mode === props.dateMode) return;
  emit("update:dateMode", mode);
  emit("change");
}

function onDay(value: string) {
  emit("update:day", value);
  emit("change");
}

function onFrom(value: string) {
  emit("update:from", value);
  emit("change");
}

function onTo(value: string) {
  emit("update:to", value);
  emit("change");
}

function shift(delta: -1 | 1) {
  emit("shift-day", delta);
  emit("change");
}

function preset(kind: "today" | "month" | "year") {
  emit("preset", kind);
}
</script>

<template>
  <div class="ui-rdf">
    <div v-if="showPresets" class="ui-rdf__presets" role="group" aria-label="ทางลัดช่วงเวลา">
      <button type="button" class="ui-btn ui-btn--ghost" @click="preset('today')">
        วันนี้
      </button>
      <button type="button" class="ui-btn ui-btn--ghost" @click="preset('month')">
        เดือนนี้
      </button>
      <button
        v-if="showYearPreset"
        type="button"
        class="ui-btn ui-btn--ghost"
        @click="preset('year')"
      >
        ปีนี้
      </button>
    </div>

    <div class="ui-rdf__when">
      <div class="ui-date-mode" role="group" aria-label="รูปแบบวันที่">
        <button
          type="button"
          class="ui-btn"
          :class="dateMode === 'day' ? 'ui-btn--primary' : 'ui-btn--ghost'"
          @click="setMode('day')"
        >
          รายวัน
        </button>
        <button
          type="button"
          class="ui-btn"
          :class="dateMode === 'range' ? 'ui-btn--primary' : 'ui-btn--ghost'"
          @click="setMode('range')"
        >
          ช่วงวันที่
        </button>
      </div>

      <div v-if="dateMode === 'day'" class="ui-date-daybar">
        <button
          type="button"
          class="ui-btn ui-btn--ghost ui-rdf__nav"
          title="วันก่อน"
          @click="shift(-1)"
        >
          ‹
        </button>
        <UiDateInput
          class="ui-rdf__date"
          :model-value="day"
          aria-label="วันที่"
          @update:model-value="onDay"
        />
        <button
          type="button"
          class="ui-btn ui-btn--ghost ui-rdf__nav"
          title="วันถัดไป"
          @click="shift(1)"
        >
          ›
        </button>
      </div>
      <div v-else class="ui-rdf__range">
        <UiDateInput
          class="ui-rdf__date"
          :model-value="from"
          aria-label="ตั้งแต่"
          @update:model-value="onFrom"
        />
        <span class="ui-rdf__range-sep">ถึง</span>
        <UiDateInput
          class="ui-rdf__date"
          :model-value="to"
          aria-label="ถึง"
          @update:model-value="onTo"
        />
      </div>
    </div>

    <div v-if="$slots.default" class="ui-rdf__fields">
      <slot />
    </div>
  </div>
</template>
