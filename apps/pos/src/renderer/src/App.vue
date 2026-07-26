<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import CashierView from "./views/CashierView.vue";
import CustomerView from "./views/CustomerView.vue";

function readRoute(): "customer" | "cashier" {
  const params = new URLSearchParams(window.location.search);
  if (params.get("v") === "customer") return "customer";
  const hash = window.location.hash.replace(/^#/, "");
  return hash.startsWith("/customer") ? "customer" : "cashier";
}

const route = ref(readRoute());

onMounted(() => {
  window.addEventListener("hashchange", () => {
    route.value = readRoute();
  });
});

const isCustomer = computed(() => route.value === "customer");
</script>

<template>
  <CustomerView v-if="isCustomer" />
  <CashierView v-else />
</template>
