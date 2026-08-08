<script setup lang="ts">
type ProductOption = {
  id: string;
  productCode?: string | null;
  barcode: string;
  name: string;
  price?: number | null;
  unit?: string;
};

const model = defineModel<string>({ default: "" });
const props = defineProps<{
  products: ProductOption[];
  placeholder?: string;
}>();

const open = ref(false);
const query = ref("");
const root = ref<HTMLElement | null>(null);

const selected = computed(() => {
  const code = model.value.trim();
  if (!code) return null;
  return (
    props.products.find((p) => (p.productCode ?? "").trim() === code) ??
    props.products.find((p) => p.barcode === code) ??
    null
  );
});

const filtered = computed(() => {
  const s = query.value.trim().toLowerCase();
  const list = props.products.filter((p) => (p.productCode ?? "").trim());
  if (!s) return list.slice(0, 40);
  return list
    .filter(
      (p) =>
        p.name.toLowerCase().includes(s) ||
        (p.productCode ?? "").toLowerCase().includes(s) ||
        p.barcode.toLowerCase().includes(s),
    )
    .slice(0, 40);
});

function displayLabel(p: ProductOption) {
  const code = (p.productCode ?? "").trim() || p.barcode;
  return `${code} — ${p.name}`;
}

function openPicker() {
  open.value = true;
  query.value = "";
}

function pick(p: ProductOption) {
  model.value = (p.productCode ?? "").trim() || p.barcode;
  open.value = false;
  query.value = "";
}

function clear() {
  model.value = "";
  query.value = "";
  open.value = true;
}

function onDocClick(e: MouseEvent) {
  if (!root.value) return;
  if (!root.value.contains(e.target as Node)) open.value = false;
}

onMounted(() => document.addEventListener("mousedown", onDocClick));
onUnmounted(() => document.removeEventListener("mousedown", onDocClick));
</script>

<template>
  <div ref="root" class="ui-product-picker">
    <button
      type="button"
      class="ui-product-picker__trigger ui-input"
      @click="openPicker"
    >
      <span v-if="selected" class="ui-product-picker__value">
        {{ displayLabel(selected) }}
      </span>
      <span v-else-if="model" class="ui-product-picker__value">
        {{ model }}
      </span>
      <span v-else class="ui-product-picker__placeholder">
        {{ placeholder || "ค้นหาสินค้า..." }}
      </span>
      <span class="ui-product-picker__caret" aria-hidden="true">▾</span>
    </button>

    <div v-if="open" class="ui-product-picker__dropdown">
      <input
        v-model="query"
        class="ui-input ui-product-picker__search"
        type="search"
        placeholder="พิมพ์ชื่อ / รหัส / บาร์โค้ด"
        autofocus
        @keydown.esc="open = false"
      />
      <ul class="ui-product-picker__list">
        <li v-if="!filtered.length" class="ui-product-picker__empty">ไม่พบสินค้า</li>
        <li
          v-for="p in filtered"
          :key="p.id"
          class="ui-product-picker__option"
          :class="{ 'is-active': (p.productCode ?? '') === model }"
          @mousedown.prevent="pick(p)"
        >
          <strong>{{ (p.productCode || p.barcode).trim() }}</strong>
          <span>{{ p.name }}</span>
          <em v-if="p.price != null">{{ p.price.toFixed(2) }}฿</em>
        </li>
      </ul>
      <button
        v-if="model"
        type="button"
        class="ui-product-picker__clear"
        @mousedown.prevent="clear"
      >
        ล้างค่า
      </button>
    </div>
  </div>
</template>
