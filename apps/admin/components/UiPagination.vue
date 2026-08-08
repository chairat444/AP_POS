<template>
  <div v-if="meta.total > 0" class="ui-pagination">
    <p class="ui-pagination__meta">
      แสดง {{ meta.from }}–{{ meta.to }} จาก {{ meta.total }} รายการ
    </p>

    <div class="ui-pagination__controls">
      <label class="ui-pagination__size">
        <span>ต่อหน้า</span>
        <select :value="meta.per_page" @change="onPerPage">
          <option v-for="n in pageSizeOptions" :key="n" :value="n">{{ n }}</option>
        </select>
      </label>

      <div class="ui-pagination__nav">
        <button
          type="button"
          class="ui-pagination__btn"
          :disabled="meta.page <= 1"
          title="หน้าก่อน"
          @click="go(meta.page - 1)"
        >
          ‹
        </button>

        <button
          v-for="item in pageItems"
          :key="String(item.key)"
          type="button"
          class="ui-pagination__btn"
          :class="{
            'is-active': item.page === meta.page,
            'is-ellipsis': item.type === 'ellipsis',
          }"
          :disabled="item.type === 'ellipsis'"
          @click="item.page ? go(item.page) : undefined"
        >
          {{ item.label }}
        </button>

        <button
          type="button"
          class="ui-pagination__btn"
          :disabled="meta.page >= meta.last_page"
          title="หน้าถัดไป"
          @click="go(meta.page + 1)"
        >
          ›
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { PaginationMeta } from "~/utils/pagination";

const props = withDefaults(
  defineProps<{
    meta: PaginationMeta;
    pageSizeOptions?: number[];
  }>(),
  {
    pageSizeOptions: () => [10, 20, 50, 100],
  },
);

const emit = defineEmits<{
  change: [payload: { page: number; per_page: number }];
}>();

const pageItems = computed(() => {
  const current = props.meta.page;
  const last = props.meta.last_page;
  const items: Array<{
    key: string | number;
    type: "page" | "ellipsis";
    label: string;
    page?: number;
  }> = [];

  const pushPage = (page: number) => {
    items.push({ key: page, type: "page", label: String(page), page });
  };
  const pushEllipsis = (key: string) => {
    items.push({ key, type: "ellipsis", label: "…" });
  };

  if (last <= 7) {
    for (let i = 1; i <= last; i += 1) pushPage(i);
    return items;
  }

  pushPage(1);
  if (current > 3) pushEllipsis("l");
  for (
    let i = Math.max(2, current - 1);
    i <= Math.min(last - 1, current + 1);
    i += 1
  ) {
    pushPage(i);
  }
  if (current < last - 2) pushEllipsis("r");
  pushPage(last);
  return items;
});

function go(page: number) {
  if (page < 1 || page > props.meta.last_page || page === props.meta.page) return;
  emit("change", { page, per_page: props.meta.per_page });
}

function onPerPage(event: Event) {
  const value = Number((event.target as HTMLSelectElement).value);
  emit("change", { page: 1, per_page: value });
}
</script>
