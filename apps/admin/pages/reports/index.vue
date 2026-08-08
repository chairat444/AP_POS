<script setup lang="ts">
import { paginateItems } from "~/utils/pagination";

type Branch = { id: string; code: string; name: string };

type Report = {
  filters: {
    from: string | null;
    to: string | null;
    branchId: string | null;
    paymentMethod: string | null;
    groupBy: string;
  };
  summary: {
    billCount: number;
    grossTotal: number;
    discountTotal: number;
    avgBill: number;
    pointsEarned: number;
    pointsRedeemed: number;
  };
  byPayment: Array<{ method: string; amount: number; count: number }>;
  byBranch: Array<{
    branchId: string;
    branchName?: string;
    billCount: number;
    grossTotal: number;
    discountTotal?: number;
    avgBill?: number;
    pointsEarned?: number;
    pointsRedeemed?: number;
  }>;
  series: Array<{ period: string; billCount: number; grossTotal: number }>;
  sales: Array<{
    id: string;
    billNo: string;
    branchId: string;
    shiftId?: string | null;
    customerName?: string | null;
    total: number;
    createdAt: string;
    payments: Array<{ method: string; amount: number }>;
  }>;
};

const PAY_LABELS: Record<string, string> = {
  cash: "เงินสด",
  transfer: "เงินโอน",
  government: "เงินสวัสดิการ",
  points: "ส่วนลดแต้ม",
};

const { get } = useAdminApi();
const pending = ref(false);
const error = ref("");
const branches = ref<Branch[]>([]);
const report = ref<Report | null>(null);

const {
  dateMode,
  day,
  from,
  to,
  rangeFrom,
  rangeTo,
  setDateMode,
  shiftDay,
  setPreset: setDatePreset,
} = useReportDateFilter();

const filters = reactive({
  branchId: "",
  paymentMethod: "",
  groupBy: "day" as "day" | "month" | "year",
});

const salesPage = ref(1);
const salesPerPage = ref(20);
const salesPaged = computed(() =>
  paginateItems(report.value?.sales ?? [], salesPage.value, salesPerPage.value),
);
const salesPageRows = computed(() => salesPaged.value.rows);
const salesMeta = computed(() => salesPaged.value.meta);

function onSalesPageChange(payload: { page: number; per_page: number }) {
  salesPage.value = payload.page;
  salesPerPage.value = payload.per_page;
}

function baht(n: number) {
  return n.toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function payLabel(method: string) {
  return PAY_LABELS[method] ?? method;
}

function branchName(id: string) {
  return branches.value.find((b) => b.id === id)?.name ?? id;
}

function branchLabel(row: Report["byBranch"][number]) {
  return row.branchName || branchName(row.branchId);
}

const showAllBranches = computed(
  () => !filters.branchId && (report.value?.byBranch.length ?? 0) > 1,
);

function fmtAt(iso: string) {
  return new Date(iso).toLocaleString("th-TH");
}

function shiftLabel(shiftId?: string | null) {
  if (!shiftId) return "-";
  const m = shiftId.match(/^shift-[^-]+-(.+)$/);
  return m?.[1] || shiftId;
}

function setPreset(kind: "today" | "month" | "year") {
  setDatePreset(kind);
  if (kind === "year") filters.groupBy = "month";
  else filters.groupBy = "day";
  void load();
}

async function loadBranches() {
  try {
    const data = await get<{ branches: Branch[] }>("/sales/branches");
    branches.value = data.branches ?? [];
  } catch {
    branches.value = [];
  }
}

async function load() {
  pending.value = true;
  error.value = "";
  try {
    const qs = new URLSearchParams();
    qs.set("from", rangeFrom.value);
    qs.set("to", rangeTo.value);
    if (filters.branchId) qs.set("branchId", filters.branchId);
    if (filters.paymentMethod) qs.set("paymentMethod", filters.paymentMethod);
    qs.set("groupBy", filters.groupBy);
    report.value = await get<Report>(`/sales/report?${qs.toString()}`);
    salesPage.value = 1;
  } catch (e) {
    error.value = e instanceof Error ? e.message : "โหลดรายงานไม่สำเร็จ";
    report.value = null;
  } finally {
    pending.value = false;
  }
}

onMounted(async () => {
  await loadBranches();
  await load();
});
</script>

<template>
  <div>
    <div class="ui-page-head">
      <div>
        <h1 class="ui-page-title">สรุปยอดขาย</h1>
        <p class="ui-page-sub">
          ยอดรวมตามวันหรือช่วง · แยกช่องทางชำระและสาขา
        </p>
      </div>
      <div class="ui-page-head__actions">
        <NuxtLink to="/sales" class="ui-btn ui-btn--ghost">ค้นหาบิล</NuxtLink>
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

    <UiReportTabs />

    <div class="ui-card ui-report-filters">
      <UiReportDateFilters
        :date-mode="dateMode"
        :day="day"
        :from="from"
        :to="to"
        show-year-preset
        @update:date-mode="setDateMode"
        @update:day="day = $event"
        @update:from="from = $event"
        @update:to="to = $event"
        @shift-day="shiftDay"
        @preset="setPreset"
        @change="load"
      >
        <label class="ui-field">
          <span>สาขา</span>
          <select v-model="filters.branchId" class="ui-input" @change="load">
            <option value="">ทุกสาขา</option>
            <option v-for="b in branches" :key="b.id" :value="b.id">
              {{ b.name }}
            </option>
          </select>
        </label>
        <label class="ui-field">
          <span>ชำระด้วย</span>
          <select
            v-model="filters.paymentMethod"
            class="ui-input"
            @change="load"
          >
            <option value="">ทุกช่องทาง</option>
            <option value="cash">เงินสด</option>
            <option value="transfer">เงินโอน</option>
            <option value="government">เงินสวัสดิการ</option>
          </select>
        </label>
        <label class="ui-field">
          <span>สรุปเป็น</span>
          <select v-model="filters.groupBy" class="ui-input" @change="load">
            <option value="day">รายวัน</option>
            <option value="month">รายเดือน</option>
            <option value="year">รายปี</option>
          </select>
        </label>
      </UiReportDateFilters>
    </div>

    <div v-if="error" class="ui-empty">{{ error }}</div>
    <div v-else-if="pending && !report" class="ui-empty">กำลังโหลดรายงาน...</div>

    <template v-if="report">
      <div
        v-if="showAllBranches"
        class="ui-card"
        style="margin-top: 1rem"
      >
        <div class="ui-card__toolbar">
          <span class="ui-toolbar-meta ui-toolbar-meta--alone">สรุปแยกตามสาขา</span>
        </div>
        <div class="ui-table-wrap">
          <table class="ui-table ui-table--fit">
            <thead>
              <tr>
                <th>สาขา</th>
                <th>บิล</th>
                <th>ยอดขาย</th>
                <th>เฉลี่ย/บิล</th>
                <th>ส่วนลด</th>
                <th>แต้มได้</th>
                <th>ใช้แต้ม</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in report.byBranch" :key="row.branchId">
                <td>{{ branchLabel(row) }}</td>
                <td>{{ row.billCount }}</td>
                <td>{{ baht(row.grossTotal) }}</td>
                <td>{{ baht(row.avgBill ?? (row.billCount ? row.grossTotal / row.billCount : 0)) }}</td>
                <td>{{ baht(row.discountTotal ?? 0) }}</td>
                <td>{{ row.pointsEarned ?? 0 }}</td>
                <td>{{ row.pointsRedeemed ?? 0 }}</td>
              </tr>
            </tbody>
            <tfoot>
              <tr>
                <th>รวมทุกสาขา</th>
                <th>{{ report.summary.billCount }}</th>
                <th>{{ baht(report.summary.grossTotal) }}</th>
                <th>{{ baht(report.summary.avgBill) }}</th>
                <th>{{ baht(report.summary.discountTotal) }}</th>
                <th>{{ report.summary.pointsEarned }}</th>
                <th>{{ report.summary.pointsRedeemed }}</th>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      <div class="ui-dash__kpi-strip" style="margin-top: 1rem">
        <div class="ui-dash__kpi">
          <p class="ui-dash__kpi-label">
            {{ showAllBranches ? "ยอดขายรวมทุกสาขา" : "ยอดขายรวม" }}
          </p>
          <p class="ui-dash__kpi-value">{{ baht(report.summary.grossTotal) }}</p>
          <p class="ui-dash__kpi-hint">
            {{ report.summary.billCount }} บิล · ส่วนลดรวม {{ baht(report.summary.discountTotal) }}
          </p>
        </div>
        <div class="ui-dash__kpi">
          <p class="ui-dash__kpi-label">เฉลี่ยต่อบิล</p>
          <p class="ui-dash__kpi-value">{{ baht(report.summary.avgBill) }}</p>
          <p class="ui-dash__kpi-hint">ส่วนลดรวม {{ baht(report.summary.discountTotal) }}</p>
        </div>
        <div class="ui-dash__kpi">
          <p class="ui-dash__kpi-label">แต้มสมาชิกที่ได้</p>
          <p class="ui-dash__kpi-value">{{ report.summary.pointsEarned }}</p>
          <p class="ui-dash__kpi-hint">ใช้แต้มไป {{ report.summary.pointsRedeemed }}</p>
        </div>
        <div class="ui-dash__kpi">
          <p class="ui-dash__kpi-label">สาขาที่มีขาย</p>
          <p class="ui-dash__kpi-value">{{ report.byBranch.length }}</p>
          <p class="ui-dash__kpi-hint">ในช่วงที่เลือก</p>
        </div>
      </div>

      <div class="ui-report-grid">
        <div class="ui-card">
          <div class="ui-card__toolbar">
            <span class="ui-toolbar-meta ui-toolbar-meta--alone">ยอดแยกตามช่องทางชำระ</span>
          </div>
          <div v-if="!report.byPayment.length" class="ui-empty">ไม่มีข้อมูลการชำระ</div>
          <div v-else class="ui-table-wrap">
            <table class="ui-table ui-table--fit">
              <thead>
                <tr>
                  <th>ช่องทาง</th>
                  <th>ครั้ง</th>
                  <th>ยอด</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in report.byPayment" :key="row.method">
                  <td>{{ payLabel(row.method) }}</td>
                  <td>{{ row.count }}</td>
                  <td>{{ baht(row.amount) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div v-if="!showAllBranches" class="ui-card">
          <div class="ui-card__toolbar">
            <span class="ui-toolbar-meta ui-toolbar-meta--alone">ยอดแยกตามสาขา</span>
          </div>
          <div v-if="!report.byBranch.length" class="ui-empty">ไม่มีข้อมูลสาขา</div>
          <div v-else class="ui-table-wrap">
            <table class="ui-table ui-table--fit">
              <thead>
                <tr>
                  <th>สาขา</th>
                  <th>บิล</th>
                  <th>ยอด</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in report.byBranch" :key="row.branchId">
                  <td>{{ branchLabel(row) }}</td>
                  <td>{{ row.billCount }}</td>
                  <td>{{ baht(row.grossTotal) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div class="ui-card" style="margin-top: 1rem">
        <div class="ui-card__toolbar">
          <span class="ui-toolbar-meta ui-toolbar-meta--alone">
            สรุป
            {{
              filters.groupBy === "year"
                ? "รายปี"
                : filters.groupBy === "month"
                  ? "รายเดือน"
                  : "รายวัน"
            }}
          </span>
        </div>
        <div v-if="!report.series.length" class="ui-empty">ไม่มีข้อมูลในช่วงนี้</div>
        <div v-else class="ui-table-wrap">
          <table class="ui-table ui-table--fit">
            <thead>
              <tr>
                <th>ช่วง</th>
                <th>บิล</th>
                <th>ยอดขาย</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in report.series" :key="row.period">
                <td>{{ row.period }}</td>
                <td>{{ row.billCount }}</td>
                <td>{{ baht(row.grossTotal) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="ui-card" style="margin-top: 1rem">
        <div class="ui-card__toolbar">
          <span class="ui-toolbar-meta">
            บิลในช่วงนี้ ({{ salesMeta.total }})
          </span>
          <NuxtLink to="/sales" class="ui-btn ui-btn--ghost">เปิดหน้าค้นหาบิล</NuxtLink>
        </div>
        <div v-if="!salesMeta.total" class="ui-empty">ไม่มีบิลในช่วงนี้</div>
        <div v-else class="ui-table-wrap">
          <table class="ui-table ui-table--fit">
            <thead>
              <tr>
                <th>เวลา</th>
                <th>เลขบิล</th>
                <th>รอบขาย</th>
                <th>สาขา</th>
                <th>สมาชิก</th>
                <th>ชำระ</th>
                <th>ยอด</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in salesPageRows" :key="row.id">
                <td>{{ fmtAt(row.createdAt) }}</td>
                <td>{{ row.billNo }}</td>
                <td>{{ shiftLabel(row.shiftId) }}</td>
                <td>{{ branchName(row.branchId) }}</td>
                <td>{{ row.customerName || "-" }}</td>
                <td>
                  {{
                    row.payments
                      .map((p) => `${payLabel(p.method)} ${baht(p.amount)}`)
                      .join(" · ") || "-"
                  }}
                </td>
                <td>{{ baht(row.total) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <UiPagination :meta="salesMeta" @change="onSalesPageChange" />
      </div>
    </template>
  </div>
</template>
