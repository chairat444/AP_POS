<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref, watch } from "vue";

const open = defineModel<boolean>("open", { default: false });
withDefaults(
  defineProps<{
    title?: string;
    message?: string;
    hint?: string;
    okLabel?: string;
  }>(),
  {
    title: "แจ้งเตือน",
    message: "",
    hint: "",
    okLabel: "เข้าใจแล้ว",
  },
);
const emit = defineEmits<{ close: [] }>();

const okBtn = ref<HTMLButtonElement | null>(null);

function focusOk() {
  void nextTick(() => okBtn.value?.focus());
}

watch(open, (v) => {
  if (!v) return;
  focusOk();
  requestAnimationFrame(() => focusOk());
});

function dismiss() {
  open.value = false;
  emit("close");
}

function onKey(e: KeyboardEvent) {
  if (!open.value) return;
  if (e.key === "Escape" || e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    e.stopPropagation();
    dismiss();
  }
}

onMounted(() => window.addEventListener("keydown", onKey, true));
onUnmounted(() => window.removeEventListener("keydown", onKey, true));
</script>

<template>
  <div v-if="open" class="staff-alert-overlay" @click.self="dismiss">
    <div class="staff-alert" @click.stop>
      <div class="staff-alert-badge">!</div>
      <h2 class="staff-alert-title">{{ title }}</h2>
      <p class="staff-alert-msg">{{ message }}</p>
      <p v-if="hint" class="staff-alert-hint">{{ hint }}</p>
      <button ref="okBtn" type="button" class="staff-alert-ok" @click="dismiss">
        {{ okLabel }}
        <small>Enter</small>
      </button>
    </div>
  </div>
</template>
