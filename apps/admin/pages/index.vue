<script setup lang="ts">
type Summary = {
  today: { billCount: number; grossTotal: number };
  all: { billCount: number; grossTotal: number };
  productCount: number;
  memberCount: number;
};

const { get } = useAdminApi();
const pending = ref(false);
const error = ref("");
const summary = ref<Summary | null>(null);

function baht(n: number) {
  return n.toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

async function load() {
  pending.value = true;
  error.value = "";
  try {
    summary.value = await get<Summary>("/sales/summary");
  } catch (e) {
    error.value =
      e instanceof Error ? e.message : "โหลดแดชบอร์ดไม่สำเร็จ — ตรวจว่า API รันอยู่";
  } finally {
    pending.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div class="ui-dash">
    <div class="ui-page-head">
      <div>
        <h1 class="ui-page-title">แดชบอร์ด</h1>
        <p class="ui-page-sub">สรุปยอดขายจาก Postgres · AP POS</p>
      </div>
      <div class="ui-page-head__actions">
        <button
          type="button"
          class="ui-btn ui-btn--ghost"
          :disabled="pending"
          @click="load"
        >
          {{ pending ? "กำลังโหลด..." : "รีเฟรช" }}
        </button>
      </div>
    </div>

    <div v-if="error" class="ui-empty">{{ error }}</div>
    <template v-else-if="summary">
      <div class="ui-dash__kpi-strip">
        <div class="ui-dash__kpi">
          <p class="ui-dash__kpi-label">ยอดขายวันนี้</p>
          <p class="ui-dash__kpi-value">{{ baht(summary.today.grossTotal) }}</p>
          <p class="ui-dash__kpi-hint">{{ summary.today.billCount }} บิล</p>
        </div>
        <div class="ui-dash__kpi">
          <p class="ui-dash__kpi-label">ยอดขายทั้งหมด</p>
          <p class="ui-dash__kpi-value">{{ baht(summary.all.grossTotal) }}</p>
          <p class="ui-dash__kpi-hint">{{ summary.all.billCount }} บิล</p>
        </div>
        <div class="ui-dash__kpi">
          <p class="ui-dash__kpi-label">สินค้า</p>
          <p class="ui-dash__kpi-value">{{ summary.productCount }}</p>
          <p class="ui-dash__kpi-hint">รายการในระบบ</p>
        </div>
        <div class="ui-dash__kpi">
          <p class="ui-dash__kpi-label">สมาชิก</p>
          <p class="ui-dash__kpi-value">{{ summary.memberCount }}</p>
          <p class="ui-dash__kpi-hint">รายการในระบบ</p>
        </div>
      </div>

      <div class="ui-card" style="margin-top: 1.15rem">
        <div class="ui-card__toolbar">
          <span class="ui-toolbar-meta ui-toolbar-meta--alone">ทางลัด</span>
        </div>
        <div class="ui-page-head__actions" style="padding: 1.15rem 1.25rem 1.25rem">
          <NuxtLink to="/products" class="ui-btn ui-btn--primary">จัดการสินค้า</NuxtLink>
          <NuxtLink to="/members" class="ui-btn ui-btn--ghost">จัดการสมาชิก</NuxtLink>
          <NuxtLink to="/staff" class="ui-btn ui-btn--ghost">พนักงาน</NuxtLink>
          <NuxtLink to="/reports" class="ui-btn ui-btn--ghost">สรุปยอดขาย</NuxtLink>
          <NuxtLink to="/sales" class="ui-btn ui-btn--ghost">บิลขาย</NuxtLink>
        </div>
      </div>
    </template>
    <div v-else class="ui-empty">กำลังโหลด...</div>
  </div>
</template>
