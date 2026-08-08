<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { storeToRefs } from "pinia";
import { useSessionStore } from "../stores/session";
import {
  claimThisTerminal,
  loadBranches,
  loadTerminals,
  type SyncBranch,
  type SyncTerminal,
} from "../services/sync";
import CashCountModal from "./CashCountModal.vue";

const open = defineModel<boolean>("open", { default: false });
const props = defineProps<{
  required?: boolean;
  /** ดึงข้อมูลก่อนขาย ถ้าออนไลน์ — ออฟไลน์ข้ามได้ */
  beforeReady?: () => Promise<void>;
}>();
const emit = defineEmits<{ opened: [] }>();

const session = useSessionStore();
const { isOpen, staffDirectory, device } = storeToRefs(session);

const PIN_MAX_LEN = 4;
const code = ref("");
const error = ref("");
const codeInput = ref<HTMLInputElement | null>(null);
/** กันกด/ออโต้ส่งซ้ำตอนกำลังเช็ค PIN */
const submittingPin = ref(false);

function normalizePin(raw: string) {
  return raw.replace(/\D/g, "").slice(0, PIN_MAX_LEN);
}

function onPinInput(e: Event) {
  const el = e.target as HTMLInputElement;
  const next = normalizePin(el.value);
  code.value = next;
  if (el.value !== next) el.value = next;
  if (next.length === PIN_MAX_LEN) {
    void tryAutoLogin();
  }
}

async function tryAutoLogin() {
  if (!canSubmit.value || submittingPin.value) return;
  await submitSkip();
}
const countOpen = ref(false);
const branches = ref<SyncBranch[]>([]);
const terminals = ref<SyncTerminal[]>([]);
const branchId = ref("");
const terminalId = ref("");
const loadingTerminals = ref(false);
/** โหมดลงทะเบียนเครื่องครั้งแรก / เปลี่ยนเครื่อง */
const setupMode = ref(false);
const savingSetup = ref(false);
/** กำลังอัปเดต master data หลังเปิดรอบ */
const refreshing = ref(false);
let focusTimers: ReturnType<typeof setTimeout>[] = [];

const selectedBranch = computed(
  () => branches.value.find((b) => b.id === branchId.value) ?? null,
);
const selectedTerminal = computed(
  () => terminals.value.find((t) => t.id === terminalId.value) ?? null,
);

const deviceLabel = computed(() => {
  const b =
    selectedBranch.value?.name ||
    device.value.branchName ||
    device.value.branchId;
  const t = selectedTerminal.value
    ? `${selectedTerminal.value.code} · ${selectedTerminal.value.name}`
    : device.value.terminalName || "เครื่อง POS";
  return `${b} · ${t}`;
});

const canSaveSetup = computed(
  () => Boolean(selectedBranch.value) && Boolean(selectedTerminal.value),
);

const canSubmit = computed(
  () =>
    !setupMode.value &&
    !refreshing.value &&
    !submittingPin.value &&
    code.value.trim().length === PIN_MAX_LEN &&
    Boolean(device.value.setupDone) &&
    Boolean(device.value.terminalId),
);

const mustStayOpen = computed(() => Boolean(props.required) || !isOpen.value);

function clearFocusTimers() {
  for (const t of focusTimers) clearTimeout(t);
  focusTimers = [];
}

function focusCode() {
  if (!open.value || countOpen.value || setupMode.value) return;
  void nextTick(() => {
    const el = codeInput.value;
    if (!el || !open.value || countOpen.value) return;
    el.focus({ preventScroll: true });
    el.select();
  });
}

function scheduleFocusCode() {
  clearFocusTimers();
  if (setupMode.value) return;
  focusCode();
  requestAnimationFrame(() => focusCode());
  for (const ms of [50, 100, 200, 400, 800]) {
    focusTimers.push(
      setTimeout(() => {
        if (!open.value || countOpen.value || setupMode.value) return;
        if (document.activeElement === codeInput.value) return;
        focusCode();
      }, ms),
    );
  }
}

async function reloadTerminals(preferTerminalId?: string) {
  if (!branchId.value) {
    terminals.value = [];
    terminalId.value = "";
    return;
  }
  loadingTerminals.value = true;
  try {
    const list = await loadTerminals(branchId.value);
    terminals.value = list;
    const prefer = preferTerminalId || terminalId.value;
    terminalId.value =
      list.find((t) => t.id === prefer)?.id ?? list[0]?.id ?? "";
  } finally {
    loadingTerminals.value = false;
  }
}

async function prepareOpen() {
  code.value = "";
  error.value = "";
  countOpen.value = false;
  savingSetup.value = false;

  const [dev] = await Promise.all([
    session.refreshDevice(),
    session.refreshStaffDirectory(),
  ]);
  const list = await loadBranches();
  branches.value = list;
  branchId.value =
    list.find((b) => b.id === dev.branchId)?.id ?? list[0]?.id ?? "";
  await reloadTerminals(dev.terminalId);

  const terminalOk = Boolean(
    terminals.value.find((t) => t.id === (terminalId.value || dev.terminalId)),
  );
  // ต้องลงทะเบียนถ้ายังไม่เสร็จ หรือ ID ในเครื่องไม่ตรงกับ Admin
  setupMode.value = !dev.setupDone || !terminalOk;
  if (!setupMode.value) scheduleFocusCode();
}

watch(branchId, (id, prev) => {
  if (!open.value || !setupMode.value) return;
  if (id === prev) return;
  void reloadTerminals();
});

watch(open, (v) => {
  if (v) {
    void prepareOpen();
    return;
  }
  clearFocusTimers();
  if (mustStayOpen.value) {
    void nextTick(() => {
      open.value = true;
      scheduleFocusCode();
    });
  }
});

function onWindowFocus() {
  if (open.value && !countOpen.value && !setupMode.value) focusCode();
}

async function finishOpened() {
  refreshing.value = true;
  try {
    await props.beforeReady?.();
  } catch {
    // ออฟไลน์ / เน็ตพัง — ขายด้วยข้อมูลในเครื่องต่อได้
  } finally {
    refreshing.value = false;
  }
  open.value = false;
  countOpen.value = false;
  emit("opened");
}

async function saveSetup() {
  error.value = "";
  const branch = selectedBranch.value;
  const terminal = selectedTerminal.value;
  if (!branch) {
    error.value = "เลือกสาขา";
    return;
  }
  if (!terminal) {
    error.value = terminals.value.length
      ? "เลือกเครื่อง POS"
      : "ยังไม่มีเครื่องในสาขานี้ — เพิ่มที่ Admin ก่อน (องค์กร → เครื่อง POS)";
    return;
  }
  savingSetup.value = true;
  try {
    await session.selectBranch(branch);
    // ผูก ID เครื่องจาก Admin ลงเครื่องนี้ก่อน (กันค้าง ID อัตโนมัติเก่า)
    await session.selectTerminal({
      id: terminal.id,
      name: terminal.name,
      setupDone: false,
    });
    const claimed = await claimThisTerminal({
      id: terminal.id,
      branchId: branch.id,
    });
    if (!claimed.ok) {
      error.value = claimed.message;
      await session.resetDeviceSetup();
      await reloadTerminals();
      return;
    }
    // ใช้ค่าจาก claim โดยตรง — เขียนทับ device-config ทั้งก้อน
    const saved = await session.applyDeviceConfig({
      branchId: branch.id,
      branchName: branch.name,
      terminalId: terminal.id,
      terminalName: claimed.device.terminalName || terminal.name,
      setupDone: true,
    });
    if (saved.terminalId !== terminal.id || !saved.setupDone) {
      error.value =
        "บันทึกเครื่องไม่สำเร็จ — ปิดแอปแล้วเปิดใหม่ แล้วลงทะเบียนอีกครั้ง";
      await session.resetDeviceSetup();
      return;
    }
    setupMode.value = false;
    scheduleFocusCode();
  } catch (e) {
    error.value =
      e instanceof Error ? e.message : "บันทึกการลงทะเบียนไม่สำเร็จ";
  } finally {
    savingSetup.value = false;
  }
}

async function changeDevice() {
  error.value = "";
  code.value = "";
  await session.resetDeviceSetup();
  setupMode.value = true;
}

async function submitSkip() {
  error.value = "";
  if (setupMode.value) {
    error.value = "บันทึกสาขาและเครื่องก่อน";
    return;
  }
  if (refreshing.value || submittingPin.value) return;
  if (code.value.trim().length !== PIN_MAX_LEN) return;
  submittingPin.value = true;
  try {
    const ok = await session.loginAndOpen(code.value, 0);
    if (!ok) {
      error.value = session.statusMessage || "เข้าสู่ระบบไม่สำเร็จ";
      code.value = "";
      await session.refreshDevice();
      if (!device.value.setupDone) {
        setupMode.value = true;
        await reloadTerminals(device.value.terminalId);
      } else {
        focusCode();
      }
      return;
    }
    await finishOpened();
  } finally {
    submittingPin.value = false;
  }
}

async function submitWithCount() {
  error.value = "";
  if (setupMode.value) {
    error.value = "บันทึกสาขาและเครื่องก่อน";
    return;
  }
  if (refreshing.value || submittingPin.value) return;
  if (code.value.trim().length !== PIN_MAX_LEN) return;
  submittingPin.value = true;
  try {
    const ok = await session.loginAndOpen(code.value, 0);
    if (!ok) {
      error.value = session.statusMessage || "เข้าสู่ระบบไม่สำเร็จ";
      code.value = "";
      await session.refreshDevice();
      if (!device.value.setupDone) {
        setupMode.value = true;
        await reloadTerminals(device.value.terminalId);
      } else {
        focusCode();
      }
      return;
    }
    countOpen.value = true;
  } finally {
    submittingPin.value = false;
  }
}

async function onFloatSaved() {
  await finishOpened();
}

async function onFloatCancel() {
  await finishOpened();
}

function onKey(e: KeyboardEvent) {
  if (!open.value || countOpen.value) return;
  if (e.key === "Escape") {
    e.preventDefault();
    e.stopPropagation();
    if (mustStayOpen.value) {
      if (!setupMode.value) focusCode();
      return;
    }
    open.value = false;
    return;
  }
  if (e.key === "Enter") {
    e.preventDefault();
    e.stopPropagation();
    if (setupMode.value) {
      if (canSaveSetup.value) void saveSetup();
      return;
    }
    if (canSubmit.value) void submitSkip();
  }
}

onMounted(() => {
  window.addEventListener("keydown", onKey, true);
  window.addEventListener("focus", onWindowFocus);
  if (open.value) void prepareOpen();
});
onUnmounted(() => {
  window.removeEventListener("keydown", onKey, true);
  window.removeEventListener("focus", onWindowFocus);
  clearFocusTimers();
});
</script>

<template>
  <div v-if="open" class="pay-overlay" @mousedown.self.prevent="focusCode">
    <div
      class="pay-modal"
      :class="{ 'pin-login-modal': !setupMode }"
      @click.stop
    >
      <!-- ลงทะเบียนครั้งแรก -->
      <template v-if="setupMode">
        <header class="pay-head">
          <h2>ลงทะเบียนเครื่อง</h2>
        </header>
        <p class="pay-note pay-note-compact">
          เลือกสาขาและเครื่อง POS ครั้งเดียว · รอบถัดไปใส่แค่ PIN
        </p>

        <label class="pay-field">
          <span>สาขาที่ขาย</span>
          <select v-model="branchId" class="pay-select">
            <option disabled value="">เลือกสาขา</option>
            <option v-for="b in branches" :key="b.id" :value="b.id">
              {{ b.code }} — {{ b.name }}
            </option>
          </select>
        </label>

        <label class="pay-field">
          <span>เครื่อง POS</span>
          <select
            v-model="terminalId"
            class="pay-select"
            :disabled="!branchId || loadingTerminals"
          >
            <option disabled value="">
              {{
                loadingTerminals
                  ? "กำลังโหลด..."
                  : terminals.length
                    ? "เลือกเครื่อง"
                    : "ยังไม่มีเครื่องในสาขานี้"
              }}
            </option>
            <option v-for="t in terminals" :key="t.id" :value="t.id">
              {{ t.code }} — {{ t.name }}
            </option>
          </select>
        </label>

        <p
          v-if="branchId && !loadingTerminals && !terminals.length"
          class="pay-warn"
        >
          ยังไม่มีเครื่อง POS ในสาขานี้ — ไปเพิ่มที่ Admin ก่อน
        </p>
        <div v-if="error" class="pay-warn">{{ error }}</div>

        <footer class="open-shift-actions">
          <button
            type="button"
            class="pay-confirm"
            :disabled="!canSaveSetup || savingSetup"
            @click="saveSetup"
          >
            {{ savingSetup ? "กำลังบันทึก..." : "บันทึกแล้วไปใส่ PIN" }}
            <small>Enter</small>
          </button>
        </footer>
      </template>

      <!-- เปิดรอบ — โฟกัส PIN -->
      <template v-else>
        <div class="pin-login-meta">{{ deviceLabel }}</div>
        <header class="pay-head pin-login-head">
          <h2>ใส่ PIN</h2>
        </header>

        <label class="pay-field pin-login-field">
          <input
            ref="codeInput"
            :value="code"
            class="pin-login-input"
            type="password"
            inputmode="numeric"
            maxlength="4"
            pattern="[0-9]*"
            autocomplete="off"
            autofocus
            placeholder="••••"
            @input="onPinInput"
          />
        </label>

        <p v-if="staffDirectory.length" class="pin-login-hint">
          ตัวอย่าง PIN
          <strong v-for="s in staffDirectory.slice(0, 3)" :key="s.id">
            {{ s.pin }}
          </strong>
        </p>

        <div v-if="error" class="pay-warn">{{ error }}</div>
        <div v-if="refreshing" class="pay-warn" style="color: var(--text, #333)">
          กำลังอัปเดตข้อมูลก่อนขาย...
        </div>

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
            {{ refreshing ? "กำลังอัปเดต..." : "เปิดรอบเลย" }}
            <small v-if="!refreshing">Enter</small>
          </button>
        </footer>

        <button type="button" class="pin-login-change" @click="changeDevice">
          เปลี่ยนสาขา / เครื่อง
        </button>
      </template>
    </div>

    <CashCountModal
      v-model:open="countOpen"
      purpose="float"
      @saved="onFloatSaved"
      @cancel="onFloatCancel"
    />
  </div>
</template>
