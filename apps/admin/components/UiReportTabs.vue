<script setup lang="ts">
const route = useRoute();

const links = [
  {
    to: "/reports",
    label: "สรุปยอดขาย",
    hint: "ยอดรวม · แยกชำระ/สาขา",
  },
  {
    to: "/reports/cashflow",
    label: "รายรับ–รายจ่าย",
    hint: "เงินสด/โอน · ค่าใช้จ่าย",
  },
  {
    to: "/reports/commission",
    label: "ค่าแรงและค่าคอม",
    hint: "รายได้พนักงานรายเดือน",
  },
] as const;

function isOn(to: string) {
  return route.path === to;
}
</script>

<template>
  <nav class="ui-report-tabs" aria-label="รายงาน">
    <NuxtLink
      v-for="link in links"
      :key="link.to"
      :to="link.to"
      class="ui-report-tabs__item"
      :class="{ 'is-active': isOn(link.to) }"
    >
      <strong>{{ link.label }}</strong>
      <span>{{ link.hint }}</span>
    </NuxtLink>
  </nav>
</template>
