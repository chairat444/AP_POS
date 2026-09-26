<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import CashierView from "./views/CashierView.vue";
import CustomerView from "./views/CustomerView.vue";
import { refreshApiOnline, loadPosNetworkConfig, envMode } from "./services/sync";

function readRoute(): "customer" | "cashier" {
  const params = new URLSearchParams(window.location.search);
  if (params.get("v") === "customer") return "customer";
  const hash = window.location.hash.replace(/^#/, "");
  return hash.startsWith("/customer") ? "customer" : "cashier";
}

const route = ref(readRoute());
const booting = ref(true);
const bootLabel = ref("กำลังเริ่มระบบ…");
const bootOnline = ref<boolean | null>(null);

onMounted(() => {
  window.addEventListener("hashchange", () => {
    route.value = readRoute();
  });

  void (async () => {
    // จอลูกค้าไม่ต้องรอเช็ค API
    if (route.value === "customer") {
      booting.value = false;
      return;
    }
    bootLabel.value = "โหลดตั้งค่าเครื่อง…";
    await loadPosNetworkConfig();
    bootLabel.value = "ตรวจสอบการเชื่อมต่อเซิร์ฟเวอร์…";
    try {
      const online = await refreshApiOnline({
        attempts: 2,
        timeoutMs: 700,
        gapMs: 150,
      });
      bootOnline.value = online;
      bootLabel.value = online
        ? envMode.value === "test"
          ? "โหมดทดสอบ · กำลังเปิดหน้าขาย…"
          : "เชื่อมต่อแล้ว · กำลังเปิดหน้าขาย…"
        : "โหมดออฟไลน์ · ใช้ข้อมูลในเครื่อง…";
    } catch {
      bootOnline.value = false;
      bootLabel.value = "โหมดออฟไลน์ · ใช้ข้อมูลในเครื่อง…";
    }
    // ให้ข้อความโชว์สั้น ๆ แล้วเปิด UI — กันกระตุกตอนโหลดคู่กับการรอเน็ต
    await new Promise<void>((r) => setTimeout(r, 180));
    booting.value = false;
  })();
});

const isCustomer = computed(() => route.value === "customer");
</script>

<template>
  <div v-if="booting && !isCustomer" class="boot-screen">
    <div class="boot-card">
      <div class="boot-brand">AP POS</div>
      <div class="boot-spinner" aria-hidden="true" />
      <p class="boot-label">{{ bootLabel }}</p>
      <p v-if="bootOnline === false" class="boot-hint">
        {{
          envMode === "test"
            ? "โหมดทดสอบ · ดึงข้อมูลได้ แต่ไม่ส่งขึ้นเซิร์ฟเวอร์"
            : "ขายได้ตามปกติ · จะ sync เมื่อเน็ตกลับมา"
        }}
      </p>
    </div>
  </div>
  <CustomerView v-else-if="isCustomer" />
  <CashierView v-else />
</template>

<style scoped>
.boot-screen {
  min-height: 100vh;
  display: grid;
  place-items: center;
  background: linear-gradient(160deg, #f5f5f4 0%, #e7e5e4 100%);
  padding: 24px;
}

.boot-card {
  width: min(380px, 100%);
  text-align: center;
  padding: 28px 24px;
  border-radius: 16px;
  background: #fff;
  border: 1px solid #d6d3d1;
  box-shadow: 0 12px 32px rgba(28, 25, 23, 0.08);
}

.boot-brand {
  font-size: 1.45rem;
  font-weight: 800;
  letter-spacing: 0.02em;
  color: #0f172a;
}

.boot-spinner {
  width: 28px;
  height: 28px;
  margin: 18px auto 14px;
  border-radius: 999px;
  border: 3px solid #e7e5e4;
  border-top-color: #0f766e;
  animation: boot-spin 0.7s linear infinite;
}

.boot-label {
  margin: 0;
  font-size: 0.95rem;
  font-weight: 650;
  color: #44403c;
}

.boot-hint {
  margin: 8px 0 0;
  font-size: 0.8rem;
  font-weight: 600;
  color: #78716c;
}

@keyframes boot-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
