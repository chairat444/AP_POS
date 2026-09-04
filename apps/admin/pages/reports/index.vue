<script setup lang="ts">
import { paginateItems } from "~/utils/pagination";

type Branch = { id: string; code: string; name: string };

type ReportSale = {
  id: string;
  billNo: string;
  branchId: string;
  shiftId?: string | null;
  customerId?: string | null;
  customerName?: string | null;
  total: number;
  discount?: number;
  pointsEarned?: number;
  pointsRedeemed?: number;
  createdAt: string;
  payments: Array<{ method: string; amount: number }>;
};

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
  sales: ReportSale[];
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
const billQ = ref("");
const showBreakdown = ref(false);

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

const filteredSales = computed(() => {
  const rows = report.value?.sales ?? [];
  const q = billQ.value.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((r) => {
    const hay = [
      r.billNo,
      r.customerName ?? "",
      branchName(r.branchId),
      shiftLabel(r.shiftId),
      ...(r.payments ?? []).map((p) => payLabel(p.method)),
    ]
      .join(" ")
      .toLowerCase();
    return hay.includes(q);
  });
});

const salesPage = ref(1);
const salesPerPage = ref(40);
const salesPaged = computed(() =>
  paginateItems(filteredSales.value, salesPage.value, salesPerPage.value),
);
const salesPageRows = computed(() => salesPaged.value.rows);
const salesMeta = computed(() => salesPaged.value.meta);

watch(billQ, () => {
  salesPage.value = 1;
});

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

function branchShort(id: string) {
  const b = branches.value.find((x) => x.id === id);
  if (!b) return id;
  return b.code || b.name;
}

function branchLabel(row: Report["byBranch"][number]) {
  return row.branchName || branchName(row.branchId);
}

const showAllBranches = computed(
  () => !filters.branchId && (report.value?.byBranch.length ?? 0) > 1,
);

/** ซ่อนคอลัมน์สาขาเมื่อกรองสาขาเดียว หรือมีแค่สาขาเดียวในช่วง */
const showBranchCol = computed(() => showAllBranches.value);

function fmtTime(iso: string) {
  const d = new Date(iso);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function fmtDate(iso: string) {
  const d = new Date(iso);
  return `${d.getDate()}/${d.getMonth() + 1}`;
}

const showDateInTime = computed(
  () => !(dateMode.value === "day" && rangeFrom.value === rangeTo.value),
);

function shiftLabel(shiftId?: string | null) {
  if (!shiftId) return "-";
  const m = shiftId.match(/^shift-[^-]+-(.+)$/);
  return m?.[1] || shiftId;
}

/** ช่องทาง + ยอด แสดงครบ */
function payFull(row: ReportSale) {
  const pays = (row.payments ?? []).filter((p) => p.method !== "points" && Number(p.amount));
  if (!pays.length) return "—";
  return pays.map((p) => `${payLabel(p.method)} ${baht(Number(p.amount))}`).join(" · ");
}

function saleLink(row: ReportSale) {
  return {
    path: "/sales",
    query: { id: row.id, q: row.billNo },
  };
}

function memberLink(row: ReportSale) {
  if (!row.customerId) return { path: "/members/points" };
  // ส่งแค่ id พอ — หน้าประวัติจะโหลดจาก id ตรง ๆ
  return {
    path: "/members/points",
    query: { id: row.customerId },
  };
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
  <div class="ui-rpt">
    <div class="ui-page-head">
      <div>
        <h1 class="ui-page-title">สรุปยอดขาย</h1>
        <p class="ui-page-sub">
          ดูเลขบิลและยอดในช่วงที่เลือก · คลิกเลขบิลเพื่อเปิดรายละเอียด
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
      <div class="ui-rpt__stats">
        <div class="ui-rpt__stat">
          <span class="ui-rpt__stat-label">ยอดขาย</span>
          <strong class="ui-rpt__stat-value">{{ baht(report.summary.grossTotal) }}</strong>
        </div>
        <div class="ui-rpt__stat">
          <span class="ui-rpt__stat-label">จำนวนบิล</span>
          <strong class="ui-rpt__stat-value">{{ report.summary.billCount.toLocaleString("th-TH") }}</strong>
        </div>
        <div class="ui-rpt__stat">
          <span class="ui-rpt__stat-label">เฉลี่ย/บิล</span>
          <strong class="ui-rpt__stat-value">{{ baht(report.summary.avgBill) }}</strong>
        </div>
        <div class="ui-rpt__stat">
          <span class="ui-rpt__stat-label">ส่วนลด</span>
          <strong class="ui-rpt__stat-value">{{ baht(report.summary.discountTotal) }}</strong>
        </div>
        <div class="ui-rpt__stat">
          <span class="ui-rpt__stat-label">แต้มได้ / ใช้</span>
          <strong class="ui-rpt__stat-value">
            {{ report.summary.pointsEarned.toLocaleString("th-TH") }}
            /
            {{ report.summary.pointsRedeemed.toLocaleString("th-TH") }}
          </strong>
        </div>
      </div>

      <div class="ui-card ui-rpt__bills">
        <div class="ui-card__toolbar ui-rpt__bills-bar">
          <div class="ui-rpt__bills-title">
            <strong>รายการบิล</strong>
            <span>
              {{ salesMeta.total.toLocaleString("th-TH") }}
              <template v-if="billQ.trim()">จาก {{ report.sales.length.toLocaleString("th-TH") }}</template>
              บิล
            </span>
          </div>
          <label class="ui-rpt__search">
            <span class="ui-sr-only">ค้นหาเลขบิล</span>
            <input
              v-model="billQ"
              class="ui-input"
              type="search"
              placeholder="ค้นหาเลขบิล / สมาชิก / สาขา"
            />
          </label>
        </div>

        <div v-if="!salesMeta.total" class="ui-empty">
          {{ billQ.trim() ? "ไม่พบบิลที่ตรงกับคำค้น" : "ไม่มีบิลในช่วงนี้" }}
        </div>
        <div v-else class="ui-table-wrap">
          <table class="ui-table ui-table--fit ui-rpt__table">
            <thead>
              <tr>
                <th class="ui-rpt__col-time">เวลา</th>
                <th class="ui-table__col-bill">เลขบิล</th>
                <th v-if="showBranchCol" class="ui-rpt__col-branch">สาขา</th>
                <th>สมาชิก</th>
                <th class="ui-rpt__col-pay">ชำระ</th>
                <th class="ui-rpt__num">ยอด</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in salesPageRows" :key="row.id">
                <td class="ui-rpt__time ui-rpt__col-time">
                  <template v-if="showDateInTime">
                    <span class="ui-rpt__time-date">{{ fmtDate(row.createdAt) }}</span>
                    <span class="ui-rpt__time-clock">{{ fmtTime(row.createdAt) }}</span>
                  </template>
                  <template v-else>{{ fmtTime(row.createdAt) }}</template>
                </td>
                <td class="ui-table__col-bill">
                  <NuxtLink
                    :to="saleLink(row)"
                    class="ui-link ui-rpt__bill"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {{ row.billNo }}
                  </NuxtLink>
                </td>
                <td
                  v-if="showBranchCol"
                  class="ui-rpt__col-branch"
                  :title="branchName(row.branchId)"
                >
                  {{ branchShort(row.branchId) }}
                </td>
                <td class="ui-rpt__col-member">
                  <NuxtLink
                    v-if="row.customerId"
                    :to="memberLink(row)"
                    class="ui-link"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {{ row.customerName || "สมาชิก" }}
                  </NuxtLink>
                  <span v-else class="ui-rpt__muted">
                    {{ row.customerName || "ลูกค้าทั่วไป" }}
                  </span>
                </td>
                <td class="ui-rpt__col-pay">{{ payFull(row) }}</td>
                <td class="ui-rpt__num ui-rpt__amt">{{ baht(row.total) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <UiPagination :meta="salesMeta" @change="onSalesPageChange" />
      </div>

      <div class="ui-rpt__more">
        <button
          type="button"
          class="ui-btn ui-btn--ghost"
          @click="showBreakdown = !showBreakdown"
        >
          {{ showBreakdown ? "ซ่อนสรุปย่อย" : "แสดงสรุปย่อย (ช่องทาง / สาขา / ช่วง)" }}
        </button>
      </div>

      <template v-if="showBreakdown">
        <div
          v-if="showAllBranches"
          class="ui-card"
          style="margin-top: 0.75rem"
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
            </table>
          </div>
        </div>

        <div class="ui-report-grid" style="margin-top: 0.75rem">
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

          <div class="ui-card">
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
        </div>
      </template>
    </template>
  </div>
</template>

<style scoped>
.ui-rpt__stats {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem 1rem;
  margin-top: 1rem;
  padding: 0.75rem 1rem;
  border: 1px solid var(--ui-border, #e5e7eb);
  border-radius: 0.75rem;
  background: var(--ui-surface, #fff);
}

.ui-rpt__stat {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  min-width: 8rem;
}

.ui-rpt__stat-label {
  font-size: 0.8rem;
  color: var(--ui-muted, #6b7280);
}

.ui-rpt__stat-value {
  font-size: 1.05rem;
  font-variant-numeric: tabular-nums;
}

.ui-rpt__bills {
  margin-top: 1rem;
}

.ui-rpt__bills-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}

.ui-rpt__bills-title {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
}

.ui-rpt__bills-title span {
  font-size: 0.85rem;
  color: var(--ui-muted, #6b7280);
}

.ui-rpt__search {
  flex: 1;
  min-width: 12rem;
  max-width: 22rem;
}

.ui-rpt__bill {
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.01em;
}

.ui-rpt__table :deep(.ui-table__col-bill) {
  width: auto;
  min-width: 12rem;
  max-width: none;
  overflow: visible !important;
  text-overflow: clip !important;
  white-space: nowrap !important;
}

.ui-rpt__table :deep(.ui-table__col-bill .ui-link) {
  overflow: visible;
  text-overflow: clip;
  white-space: nowrap;
}

.ui-rpt__table :deep(.ui-rpt__col-branch) {
  width: 3.25rem;
  min-width: 3.25rem;
  max-width: 4rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--ui-muted, #6b7280);
  font-variant-numeric: tabular-nums;
}

.ui-rpt__table :deep(.ui-rpt__col-time) {
  width: 3.6rem;
  min-width: 3.6rem;
  max-width: 4.2rem;
  overflow: visible !important;
  text-overflow: clip !important;
  white-space: nowrap !important;
  padding-left: 0.75rem !important;
  padding-right: 0.5rem !important;
}

.ui-rpt__time {
  font-variant-numeric: tabular-nums;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  color: var(--ui-muted, #4b5563);
  font-size: 0.82rem;
}

.ui-rpt__time-date,
.ui-rpt__time-clock {
  display: block;
  white-space: nowrap;
}

.ui-rpt__time-date {
  font-size: 0.72rem;
  line-height: 1.15;
  opacity: 0.85;
}

.ui-rpt__time-clock {
  line-height: 1.2;
}

.ui-rpt__table :deep(.ui-rpt__col-pay) {
  width: auto;
  min-width: 9rem;
  max-width: none;
  overflow: visible !important;
  text-overflow: clip !important;
  white-space: normal !important;
  line-height: 1.35;
  color: var(--ui-muted, #4b5563);
  font-size: 0.86rem;
}

.ui-rpt__muted {
  color: var(--ui-muted, #94a3b8);
}

.ui-rpt__bills :deep(.ui-table-wrap) {
  overflow-x: auto;
}

.ui-rpt__num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.ui-rpt__amt {
  font-weight: 650;
}

.ui-rpt__more {
  margin-top: 0.75rem;
}

.ui-sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

@media (max-width: 720px) {
  .ui-rpt__stat {
    min-width: calc(50% - 0.5rem);
  }

  .ui-rpt__search {
    max-width: none;
  }
}
</style>
