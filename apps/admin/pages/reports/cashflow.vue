<script setup lang="ts">
type Branch = { id: string; code: string; name: string };

type Cashflow = {
  filters: { from: string; to: string; branchId: string | null };
  summary: {
    incomeTotal: number;
    cashIncome: number;
    transferIncome: number;
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
          จัดการค่าใช้จ่าย
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
          <table class="ui-table ui-table--fit">
            <thead>
              <tr>
                <th>สาขา</th>
                <th>รายรับ</th>
                <th>เงินสด / โอน</th>
                <th>ค่าใช้จ่าย</th>
                <th>สุทธิ</th>
                <th>ส่งสำนักงาน</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in report.byBranch" :key="row.branchId">
                <td>{{ row.branchName }}</td>
                <td>{{ baht(row.incomeTotal) }}</td>
                <td>
                  {{ baht(row.cashIncome) }} / {{ baht(row.transferIncome) }}
                </td>
                <td>{{ baht(row.expenseTotal) }}</td>
                <td>{{ baht(row.netIncomeExpense) }}</td>
                <td>{{ baht(row.officeTransferOut) }}</td>
              </tr>
            </tbody>
            <tfoot>
              <tr>
                <th>รวมทุกสาขา</th>
                <th>{{ baht(report.summary.incomeTotal) }}</th>
                <th>
                  {{ baht(report.summary.cashIncome) }} /
                  {{ baht(report.summary.transferIncome) }}
                </th>
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
            เงินสด {{ baht(report.summary.cashIncome) }} · โอน
            {{ baht(report.summary.transferIncome) }}
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
            <table class="ui-table ui-table--fit">
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
            <table class="ui-table ui-table--fit">
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
          <table class="ui-table ui-table--fit">
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
