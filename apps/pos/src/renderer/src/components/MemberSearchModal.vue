<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from "vue";
import { useMembersStore } from "../stores/members";
import type { Member } from "../data/demo-members";

defineProps<{
  currentId?: string | null;
  currentName?: string;
  currentPoints?: number;
}>();

const emit = defineEmits<{
  select: [member: Member];
  clear: [];
  close: [];
}>();

const members = useMembersStore();

const query = ref("");
const results = ref<Member[]>([]);
const selected = ref(0);
const queryEl = ref<HTMLInputElement | null>(null);
const mode = ref<"search" | "create">("search");
const creating = ref(false);
const createError = ref("");
const newName = ref("");
const newPhone = ref("");
const nameEl = ref<HTMLInputElement | null>(null);
const lookingUp = ref(false);
let lookupTimer: ReturnType<typeof setTimeout> | null = null;
let lookupSeq = 0;

const hint = computed(() => {
  if (mode.value === "create") {
    return "ชื่อและเบอร์โทรจำเป็น · ต้องออนไลน์ · บันทึกที่เซิร์ฟเวอร์แล้วลงเครื่อง";
  }
  if (lookingUp.value) {
    return "กำลังค้นจากเซิร์ฟเวอร์…";
  }
  if (!query.value.trim()) {
    return "พิมพ์เบอร์โทรหรือชื่อ · ออนไลน์แล้วค้นจากเซิร์ฟได้ · หรือเพิ่มสมาชิกใหม่";
  }
  if (results.value.length === 1) {
    return "พบ 1 รายการ · กด Enter เพื่อเลือก";
  }
  return `พบ ${results.value.length} รายการ · คลิกหรือ ↑↓ แล้ว Enter`;
});

function refreshLocal() {
  results.value = members.search(query.value);
  selected.value = 0;
}

async function refreshWithServer() {
  const q = query.value;
  const digits = q.replace(/\D/g, "");
  if (digits.length < 9) return;
  const seq = ++lookupSeq;
  lookingUp.value = true;
  try {
    const next = await members.searchWithServer(q);
    if (seq !== lookupSeq || query.value !== q) return;
    results.value = next;
    selected.value = 0;
  } finally {
    if (seq === lookupSeq) lookingUp.value = false;
  }
}

function onQueryInput() {
  refreshLocal();
  if (lookupTimer) clearTimeout(lookupTimer);
  lookupTimer = setTimeout(() => {
    void refreshWithServer();
  }, 280);
}

function pick(m: Member) {
  emit("select", m);
}

function pickAt(index: number) {
  const m = results.value[index];
  if (m) pick(m);
}

function onClear() {
  emit("clear");
}

function onClose() {
  emit("close");
}

function openCreate() {
  mode.value = "create";
  createError.value = "";
  newName.value = query.value.trim().replace(/\d/g, "").trim() || "";
  newPhone.value = query.value.replace(/\D/g, "") || "";
  void nextTick(() => nameEl.value?.focus());
}

function backToSearch() {
  mode.value = "search";
  createError.value = "";
  void nextTick(() => queryEl.value?.focus());
}

function onPhoneInput(e: Event) {
  const el = e.target as HTMLInputElement;
  newPhone.value = String(el.value || "").replace(/\D/g, "");
}

async function submitCreate() {
  if (creating.value) return;
  creating.value = true;
  createError.value = "";
  try {
    const created = await members.create({
      name: newName.value,
      phone: newPhone.value.replace(/\D/g, ""),
      points: 0,
    });
    emit("select", created);
  } catch (e) {
    createError.value =
      e instanceof Error ? e.message : "สร้างสมาชิกไม่สำเร็จ";
  } finally {
    creating.value = false;
  }
}

function onKey(e: KeyboardEvent) {
  if (e.key === "Escape") {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    if (mode.value === "create") {
      backToSearch();
      return;
    }
    onClose();
    return;
  }
  if (mode.value === "create") {
    if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      void submitCreate();
    }
    return;
  }
  if (e.key === "ArrowDown") {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    if (!results.value.length) return;
    selected.value = (selected.value + 1) % results.value.length;
    return;
  }
  if (e.key === "ArrowUp") {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    if (!results.value.length) return;
    selected.value =
      (selected.value - 1 + results.value.length) % results.value.length;
    return;
  }
  if (e.key === "Enter") {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    if (results.value.length === 1) {
      pickAt(0);
      return;
    }
    pickAt(selected.value);
  }
}

onMounted(() => {
  refreshLocal();
  window.addEventListener("keydown", onKey, true);
  void nextTick(() => queryEl.value?.focus());
});
onUnmounted(() => {
  if (lookupTimer) clearTimeout(lookupTimer);
  window.removeEventListener("keydown", onKey, true);
});
</script>

<template>
  <div class="pay-overlay member-search-overlay" @pointerdown.self="onClose">
    <div class="pay-modal pay-modal-wide" @pointerdown.stop>
      <header class="pay-head">
        <h2>{{ mode === "create" ? "เพิ่มสมาชิกใหม่" : "ค้นหาสมาชิก" }}</h2>
        <button
          type="button"
          class="member-close-x"
          @pointerdown.prevent.stop="onClose"
        >
          ปิด
        </button>
      </header>

      <div v-if="currentId && mode === 'search'" class="member-current">
        <div>
          <span class="member-current-label">สมาชิกตอนนี้</span>
          <strong>{{ currentName }}</strong>
          <span v-if="(currentPoints ?? 0) > 0">
            · {{ currentPoints }} แต้ม
          </span>
        </div>
        <button
          type="button"
          class="member-clear-btn"
          @pointerdown.prevent.stop="onClear"
        >
          เป็นลูกค้าทั่วไป
        </button>
      </div>

      <template v-if="mode === 'search'">
        <div class="member-toolbar">
          <label class="pay-field member-search-field">
            <span>เบอร์โทร / ชื่อ</span>
            <input
              ref="queryEl"
              v-model="query"
              type="search"
              autofocus
              placeholder="เช่น 081 หรือ สมชาย"
              @input="onQueryInput"
            />
          </label>
          <button type="button" class="member-add-btn" @click="openCreate">
            + เพิ่มสมาชิก
          </button>
        </div>
        <p class="pay-note pay-note-compact">{{ hint }}</p>

        <ul class="search-list">
          <li v-for="(m, i) in results" :key="m.id">
            <button
              type="button"
              class="search-row"
              :class="{
                active: i === selected,
                current: m.id === currentId,
              }"
              @pointerdown.prevent.stop="pick(m)"
              @mouseenter="selected = i"
            >
              <span class="search-main">
                <strong>{{ m.name }}</strong>
                <span>{{ m.phone }} · {{ m.code }}</span>
              </span>
              <span class="search-meta">{{ m.points }} แต้ม</span>
            </button>
          </li>
          <li v-if="!results.length" class="search-empty">
            {{ lookingUp ? "กำลังค้นจากเซิร์ฟเวอร์…" : "ไม่พบสมาชิก" }}
            <button
              v-if="!lookingUp"
              type="button"
              class="member-empty-add"
              @click="openCreate"
            >
              เพิ่มสมาชิกใหม่
            </button>
          </li>
        </ul>
      </template>

      <template v-else>
        <p class="pay-note pay-note-compact">{{ hint }}</p>
        <label class="pay-field">
          <span>ชื่อ *</span>
          <input
            ref="nameEl"
            v-model="newName"
            type="text"
            maxlength="80"
            placeholder="ชื่อ-นามสกุล"
            autocomplete="off"
          />
        </label>
        <label class="pay-field">
          <span>เบอร์โทร *</span>
          <input
            v-model="newPhone"
            type="tel"
            inputmode="numeric"
            maxlength="12"
            placeholder="08xxxxxxxx"
            autocomplete="off"
            @input="onPhoneInput"
          />
        </label>
        <div v-if="createError" class="pay-warn">{{ createError }}</div>
        <footer class="member-create-actions">
          <button type="button" class="pay-cancel" @click="backToSearch">
            กลับค้นหา
          </button>
          <button
            type="button"
            class="pay-confirm"
            :disabled="creating || !newName.trim() || newPhone.replace(/\D/g, '').length < 9"
            @click="submitCreate"
          >
            {{ creating ? "กำลังบันทึก…" : "บันทึกสมาชิก" }}
          </button>
        </footer>
      </template>
    </div>
  </div>
</template>

<style scoped>
.member-toolbar {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 10px;
  align-items: end;
}

.member-search-field {
  margin: 0;
}

.member-add-btn {
  border: 0;
  border-radius: 10px;
  padding: 10px 14px;
  font-weight: 700;
  cursor: pointer;
  background: #0f766e;
  color: #fff;
  white-space: nowrap;
}

.member-empty-add {
  display: inline-block;
  margin-top: 8px;
  border: 0;
  background: transparent;
  color: #0f766e;
  font-weight: 700;
  cursor: pointer;
  text-decoration: underline;
}

.member-create-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 14px;
}
</style>
