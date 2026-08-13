<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import {
  getAdminUrl,
  getApiBase,
  getDefaultApiBase,
  refreshApiOnline,
  savePosNetworkConfig,
} from "../services/sync";

const open = defineModel<boolean>("open", { default: false });
const emit = defineEmits<{ saved: [] }>();

const apiBase = ref("");
const adminUrl = ref("");
const saving = ref(false);
const testing = ref(false);
const error = ref("");
const message = ref("");
const apiInput = ref<HTMLInputElement | null>(null);

function hydrate() {
  apiBase.value = getApiBase();
  adminUrl.value = getAdminUrl();
  error.value = "";
  message.value = "";
}

watch(open, (v) => {
  if (!v) return;
  hydrate();
  void nextTick(() => apiInput.value?.focus());
});

async function save() {
  if (saving.value) return;
  saving.value = true;
  error.value = "";
  message.value = "";
  try {
    await savePosNetworkConfig({
      apiBase: apiBase.value,
      adminUrl: adminUrl.value,
    });
    message.value = "บันทึกแล้ว · จะใช้ URL ใหม่ทันที";
    emit("saved");
  } catch (e) {
    error.value = e instanceof Error ? e.message : "บันทึกไม่สำเร็จ";
  } finally {
    saving.value = false;
  }
}

async function testApi() {
  if (testing.value) return;
  testing.value = true;
  error.value = "";
  message.value = "";
  try {
    await savePosNetworkConfig({
      apiBase: apiBase.value,
      adminUrl: adminUrl.value,
    });
    const ok = await refreshApiOnline({ attempts: 2, timeoutMs: 800 });
    message.value = ok
      ? "ติดต่อ API ได้"
      : "ติดต่อ API ไม่ได้ — ตรวจ URL / เน็ต / เซิร์ฟเวอร์";
    if (!ok) error.value = message.value;
  } catch (e) {
    error.value = e instanceof Error ? e.message : "ทดสอบไม่สำเร็จ";
  } finally {
    testing.value = false;
  }
}

async function openAdmin() {
  error.value = "";
  const url = (adminUrl.value.trim() || getAdminUrl()).replace(/\/$/, "");
  if (!url) {
    error.value = "ยังไม่มี URL Admin";
    return;
  }
  try {
    await savePosNetworkConfig({
      apiBase: apiBase.value || getApiBase(),
      adminUrl: url,
    });
  } catch {
    /* เปิดลิงก์ได้แม้ยังไม่บันทึกสำเร็จ */
  }
  const res = await window.apPos?.openExternal?.(url);
  if (res && !res.ok) {
    error.value = res.message || "เปิด Admin ไม่สำเร็จ";
  }
}

function resetDefault() {
  apiBase.value = getDefaultApiBase();
  adminUrl.value = "";
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
  }
}

onMounted(() => window.addEventListener("keydown", onKey, true));
onUnmounted(() => window.removeEventListener("keydown", onKey, true));
</script>

<template>
  <div v-if="open" class="pay-overlay" @click.stop>
    <div class="pay-modal pay-modal-compact pos-config-modal" @click.stop>
      <header class="pay-head">
        <h2>ตั้งค่าเครื่อง</h2>
        <button type="button" class="pay-cancel-sm" @click="close">
          ปิด Esc
        </button>
      </header>

      <p class="pos-config-note">
        ตั้ง URL ของ API และหน้า Admin บนเครื่องนี้ · ไม่ต้อง build ใหม่
      </p>

      <label class="pos-config-field">
        <span>URL API</span>
        <input
          ref="apiInput"
          v-model="apiBase"
          class="ui-input"
          type="url"
          placeholder="http://192.168.1.10:3000"
          autocomplete="off"
          spellcheck="false"
        />
      </label>

      <label class="pos-config-field">
        <span>URL Admin (ไม่บังคับ)</span>
        <input
          v-model="adminUrl"
          class="ui-input"
          type="url"
          placeholder="ว่างไว้ = เดาจาก API (พอร์ต 3100)"
          autocomplete="off"
          spellcheck="false"
        />
      </label>

      <div v-if="error" class="pay-warn">{{ error }}</div>
      <div v-else-if="message" class="pos-config-ok">{{ message }}</div>

      <footer class="pos-config-actions">
        <button type="button" class="pay-cancel" @click="close">ปิด</button>
        <button type="button" class="pay-cancel" @click="resetDefault">
          ค่าเริ่มต้น
        </button>
        <button
          type="button"
          class="pay-cancel"
          :disabled="testing"
          @click="testApi"
        >
          {{ testing ? "กำลังทดสอบ…" : "ทดสอบ API" }}
        </button>
        <button
          type="button"
          class="pay-cancel"
          @click="openAdmin"
        >
          เปิด Admin
        </button>
        <button
          type="button"
          class="pay-confirm"
          :disabled="saving"
          @click="save"
        >
          {{ saving ? "กำลังบันทึก…" : "บันทึก" }}
        </button>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.pos-config-modal {
  width: min(480px, 100%);
}

.pos-config-note {
  margin: 0;
  font-size: 0.82rem;
  font-weight: 600;
  color: #78716c;
  line-height: 1.4;
}

.pos-config-field {
  display: grid;
  gap: 6px;
}

.pos-config-field span {
  font-size: 0.8rem;
  font-weight: 700;
  color: #44403c;
}

.pos-config-field input {
  width: 100%;
  height: 40px;
  border: 2px solid #a8a29e;
  border-radius: 10px;
  padding: 0 12px;
  font: inherit;
  font-weight: 600;
}

.pos-config-ok {
  padding: 8px 10px;
  border-radius: 8px;
  background: #ecfdf5;
  color: #047857;
  font-weight: 700;
  font-size: 0.85rem;
}

.pos-config-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.pos-config-actions .pay-confirm {
  grid-column: 1 / -1;
}
</style>
