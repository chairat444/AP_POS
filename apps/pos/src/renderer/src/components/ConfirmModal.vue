<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref, watch } from "vue";

const open = defineModel<boolean>("open", { default: false });
withDefaults(
  defineProps<{
    title?: string;
    message?: string;
    confirmLabel?: string;
    cancelLabel?: string;
    danger?: boolean;
  }>(),
  {
    title: "ยืนยัน",
    message: "",
    confirmLabel: "ยืนยัน",
    cancelLabel: "ไม่ยกเลิก",
    danger: true,
  },
);
const emit = defineEmits<{
  confirm: [];
  cancel: [];
}>();

const confirmBtn = ref<HTMLButtonElement | null>(null);

function focusConfirm() {
  void nextTick(() => confirmBtn.value?.focus());
}

watch(open, (v) => {
  if (!v) return;
  focusConfirm();
  requestAnimationFrame(() => focusConfirm());
});

function onConfirm() {
  open.value = false;
  emit("confirm");
}

function onCancel() {
  open.value = false;
  emit("cancel");
}

function onKey(e: KeyboardEvent) {
  if (!open.value) return;
  if (e.key === "Escape") {
    e.preventDefault();
    e.stopPropagation();
    onCancel();
    return;
  }
  if (e.key === "Enter") {
    e.preventDefault();
    e.stopPropagation();
    onConfirm();
  }
}

onMounted(() => window.addEventListener("keydown", onKey, true));
onUnmounted(() => window.removeEventListener("keydown", onKey, true));
</script>

<template>
  <div v-if="open" class="pay-overlay confirm-overlay">
    <div class="pay-modal confirm-modal" @click.stop>
      <header class="pay-head">
        <h2>{{ title }}</h2>
        <span class="pay-esc-hint">Esc กลับ</span>
      </header>
      <p class="confirm-msg">{{ message }}</p>
      <footer class="pay-actions">
        <button type="button" class="pay-cancel" @click="onCancel">
          {{ cancelLabel }}
        </button>
        <button
          ref="confirmBtn"
          type="button"
          class="pay-confirm"
          :class="{ 'pay-confirm-danger': danger }"
          @click="onConfirm"
        >
          {{ confirmLabel }}
          <small>Enter</small>
        </button>
      </footer>
    </div>
  </div>
</template>
