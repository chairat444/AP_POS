<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from "vue";
import { useMembersStore } from "../stores/members";
import type { Member } from "../data/demo-members";

const props = defineProps<{
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

const hint = computed(() => {
  if (!query.value.trim()) {
    return "พิมพ์เบอร์โทรหรือชื่อ · คลิกชื่อเพื่อเลือก · Esc ปิด";
  }
  if (results.value.length === 1) {
    return "พบ 1 รายการ · กด Enter เพื่อเลือก";
  }
  return `พบ ${results.value.length} รายการ · คลิกหรือ ↑↓ แล้ว Enter`;
});

function refresh() {
  results.value = members.search(query.value);
  selected.value = 0;
}

function onQueryInput() {
  refresh();
}

function pick(m: Member) {
  // ส่งให้พ่อปิด modal เอง — ไม่ set สมาชิกในนี้ เพื่อไม่ให้ UI ใน modal อัปเดตค้าง
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

function onKey(e: KeyboardEvent) {
  if (e.key === "Escape") {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    onClose();
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
  refresh();
  window.addEventListener("keydown", onKey, true);
  void nextTick(() => queryEl.value?.focus());
});
onUnmounted(() => window.removeEventListener("keydown", onKey, true));
</script>

<template>
  <div class="pay-overlay member-search-overlay" @pointerdown.self="onClose">
    <div class="pay-modal pay-modal-wide" @pointerdown.stop>
      <header class="pay-head">
        <h2>ค้นหาสมาชิก</h2>
        <button type="button" class="member-close-x" @pointerdown.prevent.stop="onClose">
          ปิด
        </button>
      </header>

      <div v-if="currentId" class="member-current">
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

      <label class="pay-field">
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
        <li v-if="!results.length" class="search-empty">ไม่พบสมาชิก</li>
      </ul>
    </div>
  </div>
</template>
