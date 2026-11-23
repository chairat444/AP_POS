<script setup lang="ts">
type Branch = { id: string; code: string; name: string };

type Cashflow = {
  filters: { from: string; to: string; branchId: string | null };
  summary: {
    incomeTotal: number;
    cashIncome: number;
    transferIncome: number;
    governmentIncome: number;
    expenseTotal: number;
    expenseDrawer: number;
    expenseExternal: number;
    officeTransferOut: number;
    floatIn: number;
    netIncomeExpense: number;
  };
  byBranch?: Array<{
    branchId: string;
    branchName: string;
    incomeTotal: number;
    cashIncome: number;
    transferIncome: number;
    governmentIncome: number;
    expenseTotal: number;
    expenseDrawer: number;
    expenseExternal: number;
    officeTransferOut: number;
    floatIn: number;
    netIncomeExpense: number;
  }>;
  incomeByMethod: Array<{ method: string; amount: number; count: number }>;
  expenseByCategory: Array<{
    categoryId: string;
    categoryName: string;
    amount: number;
    count: number;
  }>;
  expenses: Array<{
    id: string;
    categoryName?: string;
    amount: number;
    paidFrom: string;
    spentAt: string;
    description: string | null;
    staffName: string | null;
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
const report = ref<Cashflow | null>(null);

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
});

function baht(n: number) {
  return n.toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function payLabel(m: string) {
  return PAY_LABELS[m] ?? m;
}

function paidLabel(v: string) {
  return v === "external" ? "นอกลิ้นชัก" : "ลิ้นชัก";
}

function fmtAt(iso: string) {
  return new Date(iso).toLocaleString("th-TH");
}

function setPreset(kind: "today" | "month") {
  setDatePreset(kind);
  void load();
}

const showAllBranches = computed(
  () => !filters.branchId && (report.value?.byBranch?.length ?? 0) > 1,
);

async function load() {
  pending.value = true;
  error.value = "";
  try {
    const qs = new URLSearchParams();
    qs.set("from", rangeFrom.value);
    qs.set("to", rangeTo.value);
    if (filters.branchId) qs.set("branchId", filters.branchId);
    report.value = await get<Cashflow>(`/reports/cashflow?${qs}`);
  } catch (e) {
    error.value = e instanceof Error ? e.message : "โหลดรายงานไม่สำเร็จ";
    report.value = null;
  } finally {
    pending.value = false;
  }
}

onMounted(async () => {
  try {
    const data = await get<{ branches: Branch[] }>("/branches");
    branches.value = data.branches ?? [];
  } catch {
    branches.value = [];
  }
  await load();
});
</script>

<template>
  <div>
    <div class="ui-page-head">
      <div>
        <h1 class="ui-page-title">รายรับ–รายจ่าย</h1>
        <p class="ui-page-sub">
          รายรับจากการขาย · ค่าใช้จ่าย · ส่งเงินเข้าสำนักงาน
        </p>
      </div>
      <div class="ui-page-head__actions">
        <NuxtLink to="/expenses" class="ui-btn ui-btn--ghost">
          จัดการค่าใช้จ่ายหน้าร้าน
        </NuxtLink>
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
      </UiReportDateFilters>
    </div>

    <div v-if="error" class="ui-empty">{{ error }}</div>
    <div v-else-if="pending && !report" class="ui-empty">กำลังโหลด...</div>

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
          <table class="ui-table ui-table--fit ui-table--cards ui-cf-branch">
            <thead>
              <tr>
                <th>สาขา</th>
                <th>รายรับ</th>
                <th>เงินสด</th>
                <th>โอน</th>
                <th>รัฐ</th>
                <th>ค่าใช้จ่าย</th>
                <th>สุทธิ</th>
                <th>ส่งสำนักงาน</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in report.byBranch" :key="row.branchId">
                <td>{{ row.branchName }}</td>
                <td>{{ baht(row.incomeTotal) }}</td>
                <td>{{ baht(row.cashIncome) }}</td>
                <td>{{ baht(row.transferIncome) }}</td>
                <td>{{ baht(row.governmentIncome) }}</td>
                <td>{{ baht(row.expenseTotal) }}</td>
                <td>{{ baht(row.netIncomeExpense) }}</td>
                <td>{{ baht(row.officeTransferOut) }}</td>
              </tr>
            </tbody>
            <tfoot>
              <tr>
                <th>รวมทุกสาขา</th>
                <th>{{ baht(report.summary.incomeTotal) }}</th>
                <th>{{ baht(report.summary.cashIncome) }}</th>
                <th>{{ baht(report.summary.transferIncome) }}</th>
                <th>{{ baht(report.summary.governmentIncome) }}</th>
                <th>{{ baht(report.summary.expenseTotal) }}</th>
                <th>{{ baht(report.summary.netIncomeExpense) }}</th>
                <th>{{ baht(report.summary.officeTransferOut) }}</th>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      <div class="ui-dash__kpi-strip" style="margin-top: 1rem">
        <div class="ui-dash__kpi">
          <p class="ui-dash__kpi-label">
            {{ showAllBranches ? "รายรับรวมทุกสาขา" : "รายรับจากการขาย" }}
          </p>
          <p class="ui-dash__kpi-value">{{ baht(report.summary.incomeTotal) }}</p>
          <p class="ui-dash__kpi-hint">
            สด {{ baht(report.summary.cashIncome) }} · โอน
            {{ baht(report.summary.transferIncome) }} · รัฐ
            {{ baht(report.summary.governmentIncome) }}
          </p>
        </div>
        <div class="ui-dash__kpi">
          <p class="ui-dash__kpi-label">ค่าใช้จ่ายรวม</p>
          <p class="ui-dash__kpi-value">{{ baht(report.summary.expenseTotal) }}</p>
          <p class="ui-dash__kpi-hint">
            ลิ้นชัก {{ baht(report.summary.expenseDrawer) }} · นอก
            {{ baht(report.summary.expenseExternal) }}
          </p>
        </div>
        <div class="ui-dash__kpi">
          <p class="ui-dash__kpi-label">สุทธิ (รับ − จ่าย)</p>
          <p class="ui-dash__kpi-value">{{ baht(report.summary.netIncomeExpense) }}</p>
          <p class="ui-dash__kpi-hint">ไม่รวมส่งเงินสำนักงาน / เติมทอน</p>
        </div>
        <div class="ui-dash__kpi">
          <p class="ui-dash__kpi-label">ส่งเงินเข้าสำนักงาน</p>
          <p class="ui-dash__kpi-value">{{ baht(report.summary.officeTransferOut) }}</p>
          <p class="ui-dash__kpi-hint">
            เติมเงินทอนเข้าลิ้นชัก {{ baht(report.summary.floatIn) }}
          </p>
        </div>
      </div>

      <div class="ui-report-grid">
        <div class="ui-card">
          <div class="ui-card__toolbar">
            <span class="ui-toolbar-meta ui-toolbar-meta--alone">รายรับแยกช่องทางชำระ</span>
          </div>
          <div v-if="!report.incomeByMethod.length" class="ui-empty">ไม่มีรายรับ</div>
          <div v-else class="ui-table-wrap">
            <table class="ui-table ui-table--fit ui-table--cards ui-cf-simple">
              <thead>
                <tr>
                  <th>ช่องทาง</th>
                  <th>ครั้ง</th>
                  <th>ยอด</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in report.incomeByMethod" :key="row.method">
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
            <span class="ui-toolbar-meta ui-toolbar-meta--alone">ค่าใช้จ่ายแยกหมวด</span>
          </div>
          <div v-if="!report.expenseByCategory.length" class="ui-empty">ไม่มีค่าใช้จ่าย</div>
          <div v-else class="ui-table-wrap">
            <table class="ui-table ui-table--fit ui-table--cards ui-cf-simple">
              <thead>
                <tr>
                  <th>หมวด</th>
                  <th>รายการ</th>
                  <th>ยอด</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in report.expenseByCategory" :key="row.categoryId">
                  <td>{{ row.categoryName }}</td>
                  <td>{{ row.count }}</td>
                  <td>{{ baht(row.amount) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div class="ui-card" style="margin-top: 1rem">
        <div class="ui-card__toolbar">
          <span class="ui-toolbar-meta">รายการค่าใช้จ่ายล่าสุด</span>
          <NuxtLink to="/expenses" class="ui-btn ui-btn--ghost">ดูทั้งหมด</NuxtLink>
        </div>
        <div v-if="!report.expenses.length" class="ui-empty">ไม่มีรายการ</div>
        <div v-else class="ui-table-wrap">
          <table class="ui-table ui-table--fit ui-table--cards ui-cf-expense">
            <thead>
              <tr>
                <th>เวลา</th>
                <th>หมวด</th>
                <th>รายละเอียด</th>
                <th>จ่ายจาก</th>
                <th>โดย</th>
                <th>ยอด</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in report.expenses" :key="row.id">
                <td>{{ fmtAt(row.spentAt) }}</td>
                <td>{{ row.categoryName || "-" }}</td>
                <td>{{ row.description || "-" }}</td>
                <td>{{ paidLabel(row.paidFrom) }}</td>
                <td>{{ row.staffName || "-" }}</td>
                <td>{{ baht(row.amount) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
@media (max-width: 800px) {
  .ui-table-wrap:has(.ui-table--fit) {
    overflow-x: visible !important;
  }

  .ui-table--fit {
    width: 100% !important;
    min-width: 0 !important;
    table-layout: auto !important;
  }

  .ui-table--fit thead {
    display: none;
  }

  .ui-table--fit tbody,
  .ui-table--fit tfoot {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .ui-table--fit tbody tr,
  .ui-table--fit tfoot tr {
    display: grid;
    gap: 0.28rem 0.55rem;
    padding: 0.7rem 0.75rem;
    border: 1px solid #e2e8f0;
    border-radius: 0.65rem;
    background: #fff;
  }

  .ui-table--fit tfoot tr {
    background: #f8fafc;
    border-color: #cbd5e1;
  }

  .ui-table--fit td,
  .ui-table--fit th {
    border: 0 !important;
    padding: 0 !important;
    overflow: visible !important;
    white-space: normal !important;
    position: static !important;
    box-shadow: none !important;
    text-align: left !important;
    font-weight: inherit;
  }

  .ui-cf-branch tbody tr,
  .ui-cf-branch tfoot tr {
    grid-template-columns: minmax(0, 1fr) auto;
    grid-template-areas:
      "branch net"
      "income expense"
      "cash xfer"
      "gov office";
  }

  .ui-cf-branch tr > *:nth-child(1) {
    grid-area: branch;
    font-weight: 700;
    font-size: 0.95rem;
  }

  .ui-cf-branch tr > *:nth-child(2) {
    grid-area: income;
    font-size: 0.84rem;
  }

  .ui-cf-branch tr > *:nth-child(2)::before {
    content: "รับ ";
    color: #94a3b8;
    font-weight: 600;
  }

  .ui-cf-branch tr > *:nth-child(3) {
    grid-area: cash;
    font-size: 0.8rem;
    color: #64748b;
  }

  .ui-cf-branch tr > *:nth-child(3)::before {
    content: "สด ";
    color: #94a3b8;
    font-weight: 600;
  }

  .ui-cf-branch tr > *:nth-child(4) {
    grid-area: xfer;
    font-size: 0.8rem;
    color: #64748b;
    text-align: right !important;
  }

  .ui-cf-branch tr > *:nth-child(4)::before {
    content: "โอน ";
    color: #94a3b8;
    font-weight: 600;
  }

  .ui-cf-branch tr > *:nth-child(5) {
    grid-area: gov;
    font-size: 0.8rem;
    color: #64748b;
  }

  .ui-cf-branch tr > *:nth-child(5)::before {
    content: "รัฐ ";
    color: #94a3b8;
    font-weight: 600;
  }

  .ui-cf-branch tr > *:nth-child(6) {
    grid-area: expense;
    font-size: 0.84rem;
    text-align: right !important;
  }

  .ui-cf-branch tr > *:nth-child(6)::before {
    content: "จ่าย ";
    color: #94a3b8;
    font-weight: 600;
  }

  .ui-cf-branch tr > *:nth-child(7) {
    grid-area: net;
    font-weight: 800;
    text-align: right !important;
  }

  .ui-cf-branch tr > *:nth-child(8) {
    grid-area: office;
    font-size: 0.8rem;
    color: #64748b;
    text-align: right !important;
  }

  .ui-cf-branch tr > *:nth-child(8)::before {
    content: "สำนักงาน ";
    color: #94a3b8;
    font-weight: 600;
  }

  .ui-cf-simple tbody tr {
    grid-template-columns: minmax(0, 1fr) auto auto;
    grid-template-areas: "label count amount";
    align-items: center;
  }

  .ui-cf-simple tr > *:nth-child(1) {
    grid-area: label;
    font-weight: 700;
  }

  .ui-cf-simple tr > *:nth-child(2) {
    grid-area: count;
    font-size: 0.8rem;
    color: #64748b;
  }

  .ui-cf-simple tr > *:nth-child(3) {
    grid-area: amount;
    font-weight: 800;
    text-align: right !important;
  }

  .ui-cf-expense tbody tr {
    grid-template-columns: minmax(0, 1fr) auto;
    grid-template-areas:
      "when amount"
      "cat cat"
      "desc desc"
      "paid by";
  }

  .ui-cf-expense tr > *:nth-child(1) {
    grid-area: when;
    font-size: 0.8rem;
    color: #64748b;
  }

  .ui-cf-expense tr > *:nth-child(2) {
    grid-area: cat;
    font-weight: 700;
  }

  .ui-cf-expense tr > *:nth-child(3) {
    grid-area: desc;
    font-size: 0.84rem;
    color: #475569;
  }

  .ui-cf-expense tr > *:nth-child(4) {
    grid-area: paid;
    font-size: 0.8rem;
    color: #64748b;
  }

  .ui-cf-expense tr > *:nth-child(4)::before {
    content: "จาก ";
    font-weight: 600;
    color: #94a3b8;
  }

  .ui-cf-expense tr > *:nth-child(5) {
    grid-area: by;
    text-align: right !important;
    font-size: 0.8rem;
    color: #64748b;
  }

  .ui-cf-expense tr > *:nth-child(5)::before {
    content: "โดย ";
    font-weight: 600;
    color: #94a3b8;
  }

  .ui-cf-expense tr > *:nth-child(6) {
    grid-area: amount;
    font-weight: 800;
    text-align: right !important;
  }
}
</style>
