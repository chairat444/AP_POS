<script setup lang="ts">
const route = useRoute();

const links = [
  {
    to: "/sales",
    label: "บิลขาย",
    hint: "ค้นหา · รายละเอียดบิล",
  },
  {
    to: "/shifts",
    label: "รอบกะ / เงินสด",
    hint: "เปิด–ปิดกะ · ส่วนต่างเงิน",
  },
] as const;

function isOn(to: string) {
  return route.path === to;
}
</script>

<template>
  <nav class="ui-report-tabs" aria-label="ขาย">
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
