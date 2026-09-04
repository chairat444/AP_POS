<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { useCartStore, type QuickProduct } from "../stores/cart";

const open = defineModel<boolean>("open", { default: false });

const cart = useCartStore();
const query = ref("");
const results = ref<QuickProduct[]>([]);
const selected = ref(0);
const queryEl = ref<HTMLInputElement | null>(null);

const hint = computed(() =>
  query.value.trim()
    ? `พบ ${results.value.length} รายการ · ↑↓ เลือก · Enter เพิ่ม`
    : "พิมพ์ชื่อ / บาร์โค้ด · ↑↓ Enter",
);

watch(open, (v) => {
  if (!v) return;
  query.value = "";
  results.value = cart.searchProducts("");
  selected.value = 0;
  void nextTick(() => queryEl.value?.focus());
});

watch(query, (q) => {
  results.value = cart.searchProducts(q);
  selected.value = 0;
});

function pick(p: QuickProduct) {
  cart.addQuick(p);
  open.value = false;
}

function close() {
  open.value = false;
}

function onKey(e: KeyboardEvent) {
  if (!open.value) return;
  if (e.key === "Escape") {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    close();
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
    const p = results.value[selected.value];
    if (p) pick(p);
  }
}

onMounted(() => window.addEventListener("keydown", onKey, true));
onUnmounted(() => window.removeEventListener("keydown", onKey, true));

function priceLabel(p: QuickProduct) {
  if (p.price == null) return "บาร์โค้ดราคา";
  return `${p.price.toFixed(2)}`;
}
</script>

<template>
  <div v-if="open" class="pay-overlay">
    <div class="pay-modal pay-modal-wide" @click.stop>
      <header class="pay-head">
        <h2>ค้นหาสินค้า</h2>
        <button type="button" class="pay-cancel" style="padding: 8px 12px" @click="close">
          ปิด Esc
        </button>
      </header>

      <label class="pay-field">
        <span>ชื่อ / บาร์โค้ด / รหัส</span>
        <input
          ref="queryEl"
          v-model="query"
          type="search"
          autofocus
          placeholder="เช่น สันใน หรือ 00001"
        />
      </label>
      <p class="pay-note">{{ hint }}</p>

      <ul class="search-list">
        <li v-for="(p, i) in results" :key="p.id">
          <button
            type="button"
            class="search-row"
            :class="{ active: i === selected }"
            @mousedown.prevent.stop="pick(p)"
            @mouseenter="selected = i"
          >
            <span class="search-main">
              <strong>{{ p.name }}</strong>
              <span>{{ p.barcode }} · {{ p.unit }}</span>
            </span>
            <span class="search-meta">{{ priceLabel(p) }}</span>
          </button>
        </li>
        <li v-if="!results.length" class="search-empty">ไม่พบสินค้า</li>
      </ul>
    </div>
  </div>
</template>
