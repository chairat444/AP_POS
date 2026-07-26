<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { storeToRefs } from "pinia";
import { useSessionStore } from "../stores/session";
import { DEMO_STAFF } from "../data/demo-staff";
import CashCountModal from "./CashCountModal.vue";

const open = defineModel<boolean>("open", { default: false });
const props = defineProps<{ required?: boolean }>();
const emit = defineEmits<{ opened: [] }>();

const session = useSessionStore();
const { isOpen } = storeToRefs(session);

const code = ref("");
const error = ref("");
const codeInput = ref<HTMLInputElement | null>(null);
const countOpen = ref(false);

const canSubmit = computed(() => code.value.trim().length > 0);
const mustStayOpen = computed(() => Boolean(props.required) || !isOpen.value);

function focusCode() {
  if (!open.value || countOpen.value) return;
  void nextTick(() => {
    codeInput.value?.focus();
    codeInput.value?.select();
  });
}

watch(open, (v) => {
  if (v) {
    code.value = "";
    error.value = "";
    countOpen.value = false;
    focusCode();
    requestAnimationFrame(() => focusCode());
    setTimeout(() => focusCode(), 50);
    return;
  }
  if (mustStayOpen.value) {
    void nextTick(() => {
      open.value = true;
      focusCode();
    });
  }
});

function finishOpened() {
  open.value = false;
  countOpen.value = false;
  emit("opened");
}

/** เปิดรอบเร็ว — นับเงินทอนทีหลัง */
function submitSkip() {
  error.value = "";
  const ok = session.loginAndOpen(code.value, 0);
  if (!ok) {
    error.value = session.statusMessage || "เข้าสู่ระบบไม่สำเร็จ";
    focusCode();
    return;
  }
  finishOpened();
}

/** เปิดรอบแล้วขึ้นนับเงินทอนทันที */
function submitWithCount() {
  error.value = "";
  const ok = session.loginAndOpen(code.value, 0);
  if (!ok) {
    error.value = session.statusMessage || "เข้าสู่ระบบไม่สำเร็จ";
    focusCode();
    return;
  }
  countOpen.value = true;
}

function onFloatSaved() {
  finishOpened();
}

function onFloatCancel() {
  // เปิดรอบไปแล้ว แค่ปิดหน้านับ — ไปขายนับทีหลังได้
  finishOpened();
}

function onKey(e: KeyboardEvent) {
  if (!open.value || countOpen.value) return;
  if (e.key === "Escape") {
    e.preventDefault();
    e.stopPropagation();
    if (mustStayOpen.value) {
      focusCode();
      return;
    }
    open.value = false;
    return;
  }
  if (e.key === "Enter") {
    e.preventDefault();
    e.stopPropagation();
    if (canSubmit.value) submitSkip();
  }
}

onMounted(() => {
  window.addEventListener("keydown", onKey, true);
  if (open.value) focusCode();
});
onUnmounted(() => window.removeEventListener("keydown", onKey, true));
</script>

<template>
  <div v-if="open" class="pay-overlay">
    <div class="pay-modal" @click.stop>
      <header class="pay-head">
        <h2>เปิดรอบ / เข้าสู่ระบบ</h2>
      </header>

      <p class="pay-note pay-note-compact">
        ใส่ PIN แล้วเปิดขายได้เลย · นับเงินทอนทีหลังก็ได้ · เดโม่
        <strong v-for="s in DEMO_STAFF" :key="s.id"> {{ s.pin }} </strong>
      </p>

      <label class="pay-field">
        <span>รหัสพนักงาน หรือ PIN</span>
        <input
          ref="codeInput"
          v-model="code"
          type="password"
          inputmode="numeric"
          placeholder="เช่น 1234"
        />
      </label>

      <div v-if="error" class="pay-warn">{{ error }}</div>

      <footer class="open-shift-actions">
        <button
          type="button"
          class="pay-cancel"
          :disabled="!canSubmit"
          @click="submitWithCount"
        >
          นับทอนแล้วเปิด
        </button>
        <button
          type="button"
          class="pay-confirm"
          :disabled="!canSubmit"
          @click="submitSkip"
        >
          เปิดรอบเลย
          <small>Enter · นับทีหลังได้</small>
        </button>
      </footer>
    </div>

    <CashCountModal
      v-model:open="countOpen"
      purpose="float"
      @saved="onFloatSaved"
      @cancel="onFloatCancel"
    />
  </div>
</template>
