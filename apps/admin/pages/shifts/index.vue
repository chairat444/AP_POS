<script setup lang="ts">
import { paginateItems } from "~/utils/pagination";

type Branch = { id: string; code: string; name: string };

type ShiftAudit = {
  id: string;
  type: string;
  staffName: string;
  barcode?: string | null;
  productName?: string | null;
  qty?: number | null;
  amount: number;
  createdAt: string;
};

type ShiftRow = {
  id: string;
  branchId: string;
  branchName?: string | null;
  terminalId: string;
  terminalCode?: string | null;
  terminalName?: string | null;
  staffName: string;
  staffCode?: string | null;
  openedAt: string;
  closedAt: string | null;
  openCash: number;
  closeCash: number | null;
  expectedCash: number | null;
  variance: number | null;
  status: string;
  billCount: number;
  grossTotal: number;
  closeNote: string | null;
  summary: Record<string, unknown> | null;
  cashMoves: unknown[];
  cashCounts: unknown[];
  audits?: ShiftAudit[];
  voidStats?: {
    lineCount: number;
    lineAmount: number;
    billCount: number;
    billAmount: number;
  };
};

type ReportSummary = {
  shiftCount: number;
  billCount: number;
  grossTotal: number;
  openCashTotal: number;
  closeCashTotal: number;
  expectedCashTotal: number;
  varianceTotal: number;
  shortCount: number;
  overCount: number;
};

type BranchSummary = ReportSummary & {
  branchId: string;
  branchName: string | null;
};

type CashMove = {
  type?: string;
  amount?: number;
  note?: string | null;
  at?: string;
  staffName?: string | null;
};

const { get } = useAdminApi();
const pending = ref(false);
const detailPending = ref(false);
const error = ref("");
const branches = ref<Branch[]>([]);
const shifts = ref<ShiftRow[]>([]);
const summary = ref<ReportSummary | null>(null);
const byBranch = ref<BranchSummary[]>([]);
const selectedId = ref<string | null>(null);
const detail = ref<ShiftRow | null>(null);
const q = ref("");

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
  status: "" as "" | "open" | "closed",
});

const page = ref(1);
const perPage = ref(30);

const filteredShifts = computed(() => {
  const needle = q.value.trim().toLowerCase();
  if (!needle) return shifts.value;
  return shifts.value.filter((r) =>
    [
      r.staffName,
      r.staffCode ?? "",
      r.branchName ?? "",
      r.terminalName ?? "",
      r.terminalCode ?? "",
      shiftCode(r.id),
      r.status === "closed" ? "ปิดแล้ว" : "เปิดอยู่",
    ]
      .join(" ")
      .toLowerCase()
      .includes(needle),
  );
});

const paged = computed(() =>
  paginateItems(filteredShifts.value, page.value, perPage.value),
);
const pageRows = computed(() => paged.value.rows);
const meta = computed(() => paged.value.meta);

watch(
  () => [rangeFrom.value, rangeTo.value, filters.branchId, filters.status, q.value],
  () => {
    page.value = 1;
  },
);

function onPageChange(payload: { page: number; per_page: number }) {
  page.value = payload.page;
  perPage.value = payload.per_page;
}

function baht(n: number | null | undefined) {
  if (n == null) return "-";
  return n.toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function fmtDate(iso: string | null | undefined) {
  if (!iso) return "-";
  return new Date(iso).toLocaleDateString("th-TH", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function fmtTime(iso: string | null | undefined) {
  if (!iso) return "-";
  return new Date(iso).toLocaleTimeString("th-TH", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtAt(iso: string | null | undefined) {
  if (!iso) return "-";
  return `${fmtDate(iso)} ${fmtTime(iso)}`;
}

function shiftCode(id: string) {
  const m = id.match(/^shift-[^-]+-(.+)$/);
  return m?.[1] || id;
}

function varianceClass(v: number | null | undefined) {
  if (v == null) return "";
  if (v < -0.01) return "is-short";
  if (v > 0.01) return "is-over";
  return "is-ok";
}

function varianceLabel(v: number | null | undefined) {
  if (v == null) return "ยังไม่นับ";
  if (v < -0.01) return "ขาด";
  if (v > 0.01) return "เกิน";
  return "ตรง";
}

function auditLabel(type: string) {
  if (type === "line_void") return "ยกเลิกรายการ";
  if (type === "bill_cancel") return "ยกเลิกบิล";
  return type;
}

function moveLabel(type: string | undefined) {
  if (type === "in" || type === "float_in") return "ใส่เงิน";
  if (type === "out" || type === "pay_out" || type === "expense") return "เบิก/จ่าย";
  if (type === "office" || type === "transfer_out") return "ส่งสำนักงาน";
  return type || "เคลื่อนไหวเงิน";
}

function voidSummary(row: ShiftRow | null) {
  if (!row) return { lineCount: 0, lineAmount: 0, billCount: 0, billAmount: 0 };
  const audits = row.audits ?? [];
  if (audits.length) {
    let lineCount = 0;
    let lineAmount = 0;
    let billCount = 0;
    let billAmount = 0;
    for (const a of audits) {
      if (a.type === "bill_cancel") {
        billCount += 1;
        billAmount += Number(a.amount || 0);
      } else {
        lineCount += 1;
        lineAmount += Number(a.amount || 0);
      }
    }
    return { lineCount, lineAmount, billCount, billAmount };
  }
  if (row.voidStats) return row.voidStats;
  const s = row.summary ?? {};
  return {
    lineCount: Number(s.voidLineCount ?? 0),
    lineAmount: Number(s.voidLineAmount ?? 0),
    billCount: Number(s.voidBillCount ?? 0),
    billAmount: Number(s.voidBillAmount ?? 0),
  };
}

function voidTotal(row: ShiftRow) {
  const v = voidSummary(row);
  return v.lineCount + v.billCount;
}

function cashMovesOf(row: ShiftRow | null): CashMove[] {
  if (!row?.cashMoves?.length) return [];
  return row.cashMoves as CashMove[];
}

function setPreset(kind: "today" | "month") {
  setDatePreset(kind);
  void load();
}

const showAllBranches = computed(
  () => !filters.branchId && byBranch.value.length > 1,
);

async function selectShift(row: ShiftRow) {
  if (selectedId.value === row.id && detail.value?.id === row.id) return;
  selectedId.value = row.id;
  detailPending.value = true;
  try {
    detail.value = await get<ShiftRow>(`/shifts/${row.id}`);
  } catch {
    detail.value = row;
  } finally {
    detailPending.value = false;
  }
}

async function load() {
  pending.value = true;
  error.value = "";
  try {
    if (!branches.value.length) {
      const b = await get<{ branches: Branch[] }>("/branches");
      branches.value = b.branches ?? [];
    }
    const qs = new URLSearchParams();
    if (filters.branchId) qs.set("branchId", filters.branchId);
    if (filters.status) qs.set("status", filters.status);
    qs.set("from", `${rangeFrom.value}T00:00:00+07:00`);
    qs.set("to", `${rangeTo.value}T23:59:59.999+07:00`);

    const reportQs = new URLSearchParams(qs);
    reportQs.delete("status");

    const [listData, reportData] = await Promise.all([
      get<{ shifts: ShiftRow[] }>(`/shifts?${qs.toString()}`),
      get<{
        summary: ReportSummary;
        byBranch?: BranchSummary[];
        shifts: ShiftRow[];
      }>(`/shifts/report?${reportQs.toString()}`),
    ]);
    shifts.value = listData.shifts ?? [];
    summary.value = reportData.summary ?? null;
    byBranch.value = reportData.byBranch ?? [];

    const keep = shifts.value.find((s) => s.id === selectedId.value);
    if (keep) {
      if (!detail.value || detail.value.id !== keep.id) {
        void selectShift(keep);
      }
    } else if (shifts.value[0]) {
      void selectShift(shifts.value[0]);
    } else {
      selectedId.value = null;
      detail.value = null;
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : "โหลดรายงานรอบขายไม่สำเร็จ";
    shifts.value = [];
    summary.value = null;
    byBranch.value = [];
    selectedId.value = null;
    detail.value = null;
  } finally {
    pending.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div class="ui-shift">
    <div class="ui-page-head">
      <div>
        <h1 class="ui-page-title">รอบกะ / เงินสด</h1>
        <p class="ui-page-sub">
          เปิด–ปิดกะ · เงินทอนเริ่ม · นับเงินปิด · ส่วนต่างเงินสด
        </p>
      </div>
      <div class="ui-page-head__actions">
        <button
          type="button"
          class="ui-btn ui-btn--ghost"
          @click="setPreset('today')"
        >
          วันนี้
        </button>
        <button
          type="button"
          class="ui-btn ui-btn--ghost"
          @click="setPreset('month')"
        >
          เดือนนี้
        </button>
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

    <UiSalesTabs />

    <div class="ui-card ui-shift__filters">
      <UiReportDateFilters
        :date-mode="dateMode"
        :day="day"
        :from="from"
        :to="to"
        :show-presets="false"
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
          <span>สถานะกะ</span>
          <select v-model="filters.status" class="ui-input" @change="load">
            <option value="">ทั้งหมด</option>
            <option value="open">เปิดอยู่</option>
            <option value="closed">ปิดแล้ว</option>
          </select>
        </label>
        <label class="ui-field ui-shift__search">
          <span>ค้นหา</span>
          <input
            v-model="q"
            class="ui-input"
            type="search"
            placeholder="พนักงาน / สาขา / เครื่อง / รหัสรอบ"
          />
        </label>
      </UiReportDateFilters>
    </div>

    <div v-if="error" class="ui-empty">{{ error }}</div>
    <div v-else-if="pending && !summary" class="ui-empty">กำลังโหลด...</div>

    <template v-if="summary">
      <div
        v-if="showAllBranches"
        class="ui-card ui-shift__branches"
      >
        <div class="ui-card__toolbar">
          <span class="ui-toolbar-meta ui-toolbar-meta--alone">
            สรุปแยกตามสาขา (กะที่ปิดแล้ว)
          </span>
        </div>
        <div class="ui-table-wrap">
          <table class="ui-table ui-table--fit">
            <thead>
              <tr>
                <th>สาขา</th>
                <th>กะ</th>
                <th>บิล</th>
                <th>ยอดขาย</th>
                <th>ส่วนต่างเงินสด</th>
                <th>ขาด / เกิน</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in byBranch" :key="row.branchId">
                <td>{{ row.branchName || row.branchId }}</td>
                <td>{{ row.shiftCount }}</td>
                <td>{{ row.billCount }}</td>
                <td>{{ baht(row.grossTotal) }}</td>
                <td :class="varianceClass(row.varianceTotal)">
                  {{ baht(row.varianceTotal) }}
                </td>
                <td>{{ row.shortCount }} / {{ row.overCount }}</td>
              </tr>
            </tbody>
            <tfoot>
              <tr>
                <th>รวมทุกสาขา</th>
                <th>{{ summary.shiftCount }}</th>
                <th>{{ summary.billCount }}</th>
                <th>{{ baht(summary.grossTotal) }}</th>
                <th :class="varianceClass(summary.varianceTotal)">
                  {{ baht(summary.varianceTotal) }}
                </th>
                <th>{{ summary.shortCount }} / {{ summary.overCount }}</th>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      <div class="ui-dash__kpi-strip ui-shift__kpis">
        <div class="ui-dash__kpi">
          <p class="ui-dash__kpi-label">
            {{ showAllBranches ? "จำนวนกะรวม" : "จำนวนกะ" }}
          </p>
          <p class="ui-dash__kpi-value">{{ summary.shiftCount }}</p>
          <p class="ui-dash__kpi-hint">{{ summary.billCount }} บิลในกะ</p>
        </div>
        <div class="ui-dash__kpi">
          <p class="ui-dash__kpi-label">ยอดขายในกะ</p>
          <p class="ui-dash__kpi-value">{{ baht(summary.grossTotal) }}</p>
          <p class="ui-dash__kpi-hint">เฉพาะกะที่ปิดแล้วในสรุป</p>
        </div>
        <div class="ui-dash__kpi">
          <p class="ui-dash__kpi-label">ส่วนต่างเงินสด</p>
          <p
            class="ui-dash__kpi-value"
            :class="varianceClass(summary.varianceTotal)"
          >
            {{ baht(summary.varianceTotal) }}
          </p>
          <p class="ui-dash__kpi-hint">
            ขาด {{ summary.shortCount }} · เกิน {{ summary.overCount }}
          </p>
        </div>
        <div class="ui-dash__kpi">
          <p class="ui-dash__kpi-label">นับเงินปิดรวม</p>
          <p class="ui-dash__kpi-value">{{ baht(summary.closeCashTotal) }}</p>
          <p class="ui-dash__kpi-hint">
            ควรมี {{ baht(summary.expectedCashTotal) }}
          </p>
        </div>
      </div>

      <div class="ui-shift__split">
        <section class="ui-card ui-shift__list">
          <div class="ui-card__toolbar">
            <span class="ui-toolbar-meta ui-toolbar-meta--alone">
              รายการกะ · {{ meta.total }}
            </span>
          </div>

          <div v-if="pending && !pageRows.length" class="ui-empty">กำลังโหลด...</div>
          <div v-else-if="!pageRows.length" class="ui-empty">
            ยังไม่มีรอบเปิด–ปิดกะในช่วงนี้
            <span class="ui-empty__hint">
              หน้านี้ดูจากกะบน POS · ดูยอดขายรวมได้ที่เมนูสรุปยอดขาย
            </span>
          </div>
          <div v-else class="ui-shift__list-body">
            <button
              v-for="row in pageRows"
              :key="row.id"
              type="button"
              class="ui-shift__row"
              :class="{
                'is-active': selectedId === row.id,
                'is-open': row.status !== 'closed',
                'has-void': voidTotal(row) > 0,
              }"
              @click="selectShift(row)"
            >
              <div class="ui-shift__row-main">
                <strong>{{ fmtTime(row.openedAt) }}</strong>
                <span>{{ fmtDate(row.openedAt) }}</span>
                <em :class="row.status === 'closed' ? 'is-closed' : 'is-open'">
                  {{ row.status === "closed" ? "ปิดแล้ว" : "เปิดอยู่" }}
                </em>
              </div>
              <div class="ui-shift__row-meta">
                <span>{{ row.staffName }}</span>
                <span>·</span>
                <span>{{ row.branchName || row.branchId }}</span>
              </div>
              <div class="ui-shift__row-foot">
                <span>
                  {{ row.billCount }} บิล · {{ baht(row.grossTotal) }}
                  <template v-if="voidTotal(row)">
                    · ยกเลิก {{ voidTotal(row) }}
                  </template>
                </span>
                <strong :class="varianceClass(row.variance)">
                  {{ baht(row.variance) }}
                </strong>
              </div>
            </button>
          </div>
          <div class="ui-shift__pager">
            <UiPagination :meta="meta" @change="onPageChange" />
          </div>
        </section>

        <section class="ui-card ui-shift__detail">
          <div v-if="detailPending && !detail" class="ui-empty">กำลังเปิดกะ...</div>
          <div v-else-if="!detail" class="ui-shift__detail-empty">
            <p>เลือกกะจากรายการ</p>
            <span>ดูเงินสด · ส่วนต่าง · ประวัติยกเลิกแบบเต็มที่นี่</span>
          </div>

          <template v-else>
            <header class="ui-shift__detail-head">
              <div>
                <p class="ui-shift__detail-kicker">
                  {{ shiftCode(detail.id) }}
                  ·
                  {{ detail.status === "closed" ? "ปิดแล้ว" : "เปิดอยู่" }}
                </p>
                <h2>
                  {{ detail.staffName }}
                  <em v-if="detail.staffCode">{{ detail.staffCode }}</em>
                </h2>
                <p class="ui-shift__detail-sub">
                  {{ detail.branchName || detail.branchId }}
                  ·
                  {{ detail.terminalName || detail.terminalCode || detail.terminalId }}
                </p>
              </div>
              <div
                class="ui-shift__variance-pill"
                :class="varianceClass(detail.variance)"
              >
                <span>{{ varianceLabel(detail.variance) }}</span>
                <strong>{{ baht(detail.variance) }}</strong>
              </div>
            </header>

            <div class="ui-shift__detail-grid">
              <div>
                <span>เปิดรอบ</span>
                <strong>{{ fmtAt(detail.openedAt) }}</strong>
              </div>
              <div>
                <span>ปิดรอบ</span>
                <strong>{{ fmtAt(detail.closedAt) }}</strong>
              </div>
              <div>
                <span>บิล / ยอดขาย</span>
                <strong>{{ detail.billCount }} · {{ baht(detail.grossTotal) }}</strong>
              </div>
              <div>
                <span>เงินทอนเริ่ม</span>
                <strong>{{ baht(detail.openCash) }}</strong>
              </div>
              <div>
                <span>ควรมีในลิ้นชัก</span>
                <strong>{{ baht(detail.expectedCash) }}</strong>
              </div>
              <div>
                <span>นับเงินปิด</span>
                <strong>{{ baht(detail.closeCash) }}</strong>
              </div>
              <div>
                <span>ยกเลิกรายการ</span>
                <strong :class="{ 'is-short': voidSummary(detail).lineCount > 0 }">
                  {{ voidSummary(detail).lineCount }} ·
                  {{ baht(voidSummary(detail).lineAmount) }}
                </strong>
              </div>
              <div>
                <span>ยกเลิกบิล</span>
                <strong :class="{ 'is-short': voidSummary(detail).billCount > 0 }">
                  {{ voidSummary(detail).billCount }} ·
                  {{ baht(voidSummary(detail).billAmount) }}
                </strong>
              </div>
              <div class="ui-shift__note">
                <span>หมายเหตุปิดรอบ</span>
                <strong>{{ detail.closeNote || "-" }}</strong>
              </div>
            </div>

            <div
              v-if="cashMovesOf(detail).length"
              class="ui-shift__section"
            >
              <div class="ui-shift__section-head">เคลื่อนไหวเงินในกะ</div>
              <div
                v-for="(m, i) in cashMovesOf(detail)"
                :key="i"
                class="ui-shift__move"
              >
                <div>
                  <strong>{{ moveLabel(m.type) }}</strong>
                  <span>
                    <template v-if="m.at">{{ fmtAt(m.at) }}</template>
                    <template v-if="m.staffName"> · {{ m.staffName }}</template>
                    <template v-if="m.note"> · {{ m.note }}</template>
                  </span>
                </div>
                <em>{{ baht(m.amount) }}</em>
              </div>
            </div>

            <div class="ui-shift__section">
              <div class="ui-shift__section-head">ประวัติยกเลิก (กันโกง)</div>
              <div v-if="(detail.audits ?? []).length">
                <div
                  v-for="a in detail.audits"
                  :key="a.id"
                  class="ui-shift__audit"
                >
                  <div>
                    <strong>{{ auditLabel(a.type) }}</strong>
                    <span>
                      {{ fmtAt(a.createdAt) }} · {{ a.staffName }}
                      <template v-if="a.productName">
                        · {{ a.productName }}
                        <template v-if="a.qty"> ×{{ a.qty }}</template>
                      </template>
                    </span>
                  </div>
                  <em>-{{ baht(a.amount) }}</em>
                </div>
              </div>
              <div
                v-else-if="
                  voidSummary(detail).lineCount > 0 ||
                  voidSummary(detail).billCount > 0
                "
                class="ui-shift__section-empty"
              >
                มีสรุปยกเลิกจากรอบ แต่ยังไม่มีรายการละเอียด
                (รอบเก่าก่อนอัปเดต)
              </div>
              <div v-else class="ui-shift__section-empty">
                ไม่มีการยกเลิกในกะนี้
              </div>
            </div>
          </template>
        </section>
      </div>
    </template>
  </div>
</template>

<style scoped>
.ui-shift {
  display: flex;
  flex-direction: column;
  min-height: calc(100vh - 4.5rem);
}

.ui-shift :deep(.ui-page-head) {
  margin-bottom: 0.75rem;
}

.ui-shift__filters {
  margin-top: 0.75rem;
  padding: 0.85rem 1rem;
}

.ui-shift__search {
  flex: 1 1 14rem;
  min-width: 12rem;
}

.ui-shift__branches {
  margin-top: 1rem;
}

.ui-shift__kpis {
  margin-top: 1rem;
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.ui-shift__split {
  display: grid;
  grid-template-columns: minmax(280px, 380px) minmax(0, 1fr);
  gap: 1rem;
  margin-top: 1rem;
  align-items: stretch;
}

.ui-shift__list,
.ui-shift__detail {
  display: flex;
  flex-direction: column;
  min-height: 28rem;
  max-height: calc(100vh - 17rem);
  overflow: hidden;
}

.ui-shift__list-body {
  flex: 1;
  overflow: auto;
  padding: 0.35rem 0.55rem 0.5rem;
}

.ui-shift__pager {
  border-top: 1px solid #e2e8f0;
  padding: 0.35rem 0.55rem 0.55rem;
}

.ui-shift__row {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  width: 100%;
  text-align: left;
  border: 1px solid transparent;
  border-radius: 0.75rem;
  background: transparent;
  padding: 0.7rem 0.8rem;
  cursor: pointer;
  color: inherit;
  transition: background 0.12s ease, border-color 0.12s ease;
}

.ui-shift__row:hover {
  background: #f8fafc;
}

.ui-shift__row.is-active {
  background: #eff6ff;
  border-color: #bfdbfe;
}

.ui-shift__row.is-open:not(.is-active) {
  background: #fffbeb;
}

.ui-shift__row-main {
  display: flex;
  align-items: baseline;
  gap: 0.45rem;
}

.ui-shift__row-main strong {
  font-size: 0.95rem;
  color: #0f172a;
  font-variant-numeric: tabular-nums;
}

.ui-shift__row-main span {
  font-size: 0.78rem;
  color: #64748b;
}

.ui-shift__row-main em {
  margin-left: auto;
  font-style: normal;
  font-size: 0.72rem;
  font-weight: 700;
  padding: 0.12rem 0.45rem;
  border-radius: 999px;
}

.ui-shift__row-main em.is-closed {
  color: #475569;
  background: #f1f5f9;
}

.ui-shift__row-main em.is-open {
  color: #b45309;
  background: #fef3c7;
}

.ui-shift__row-meta,
.ui-shift__row-foot {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
  font-size: 0.78rem;
  color: #64748b;
}

.ui-shift__row-foot {
  justify-content: space-between;
  margin-top: 0.1rem;
}

.ui-shift__row-foot strong {
  font-size: 0.92rem;
  font-variant-numeric: tabular-nums;
  color: #0f172a;
}

.ui-shift__row.has-void .ui-shift__row-foot span {
  color: #b91c1c;
}

.ui-shift__detail {
  padding-bottom: 0.75rem;
  overflow: auto;
}

.ui-shift__detail-empty {
  flex: 1;
  display: grid;
  place-content: center;
  text-align: center;
  padding: 2rem;
  color: #64748b;
}

.ui-shift__detail-empty p {
  margin: 0 0 0.35rem;
  font-weight: 650;
  color: #334155;
}

.ui-shift__detail-empty span {
  font-size: 0.85rem;
  color: #94a3b8;
}

.ui-shift__detail-head {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  align-items: flex-start;
  padding: 1rem 1.15rem 0.35rem;
}

.ui-shift__detail-kicker {
  margin: 0 0 0.2rem;
  font-size: 0.78rem;
  color: #64748b;
  font-weight: 650;
}

.ui-shift__detail-head h2 {
  margin: 0;
  font-size: 1.35rem;
  font-weight: 750;
  color: #0f172a;
  letter-spacing: -0.02em;
}

.ui-shift__detail-head em {
  margin-left: 0.4rem;
  font-style: normal;
  font-size: 0.9rem;
  font-weight: 600;
  color: #64748b;
}

.ui-shift__detail-sub {
  margin: 0.35rem 0 0;
  font-size: 0.82rem;
  color: #64748b;
}

.ui-shift__variance-pill {
  display: grid;
  gap: 0.1rem;
  text-align: right;
  padding: 0.45rem 0.7rem;
  border-radius: 0.7rem;
  border: 1px solid #e2e8f0;
  background: #f8fafc;
  min-width: 6.5rem;
}

.ui-shift__variance-pill span {
  font-size: 0.72rem;
  font-weight: 650;
  color: #64748b;
}

.ui-shift__variance-pill strong {
  font-size: 1.05rem;
  font-variant-numeric: tabular-nums;
}

.ui-shift__variance-pill.is-short {
  background: #fef2f2;
  border-color: #fecaca;
}

.ui-shift__variance-pill.is-over {
  background: #f0fdf4;
  border-color: #bbf7d0;
}

.ui-shift__detail-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.55rem;
  padding: 0.75rem 1.15rem 0.85rem;
}

.ui-shift__detail-grid > div {
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 0.7rem;
  padding: 0.55rem 0.7rem;
  min-width: 0;
}

.ui-shift__detail-grid .ui-shift__note {
  grid-column: 1 / -1;
}

.ui-shift__detail-grid span {
  display: block;
  font-size: 0.72rem;
  color: #64748b;
  font-weight: 650;
}

.ui-shift__detail-grid strong {
  display: block;
  margin-top: 0.15rem;
  font-size: 0.95rem;
  color: #0f172a;
  font-variant-numeric: tabular-nums;
  word-break: break-word;
}

.ui-shift__section {
  margin: 0 1.15rem 0.85rem;
  border-top: 1px solid #e2e8f0;
  padding-top: 0.75rem;
}

.ui-shift__section-head {
  font-size: 0.82rem;
  font-weight: 700;
  color: #334155;
  margin-bottom: 0.45rem;
}

.ui-shift__section-empty {
  color: #94a3b8;
  font-size: 0.84rem;
}

.ui-shift__audit,
.ui-shift__move {
  display: flex;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.45rem 0;
  border-bottom: 1px solid #f1f5f9;
  font-size: 0.86rem;
}

.ui-shift__audit > div,
.ui-shift__move > div {
  display: grid;
  gap: 0.15rem;
  min-width: 0;
}

.ui-shift__audit span,
.ui-shift__move span {
  color: #64748b;
  font-size: 0.8rem;
}

.ui-shift__audit em {
  font-style: normal;
  font-weight: 700;
  color: #b91c1c;
  white-space: nowrap;
}

.ui-shift__move em {
  font-style: normal;
  font-weight: 700;
  color: #0f172a;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.is-short {
  color: #c0392b !important;
}
.is-over {
  color: #1e8449 !important;
}
.is-ok {
  color: #2c3e50 !important;
}

@media (max-width: 980px) {
  .ui-shift__split {
    grid-template-columns: 1fr;
  }

  .ui-shift__list,
  .ui-shift__detail {
    max-height: none;
    min-height: 0;
  }

  .ui-shift__list-body {
    max-height: 18rem;
  }

  .ui-shift__kpis {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .ui-shift__detail-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
