<script setup lang="ts">
type Branch = { id: string; code: string; name: string };
type Staff = { id: string; code: string; name: string };

type DayRow = {
  date: string;
  daySales: number;
  shiftCount: number;
  wage: number;
  wageDefault: number;
  wageAdjusted: boolean;
  wageNote: string | null;
  commission: number;
  dayIncome: number;
  steps: number;
  shifts: Array<{
    id: string;
    openedAt: string;
    closedAt: string | null;
    grossTotal: number;
    billCount: number;
  }>;
};

type PersonRow = {
  staffId: string;
  staffCode: string;
  staffName: string;
  commissionEnabled: boolean;
  rule: string;
  dailyWage: number;
  dayCount: number;
  daysWithPay: number;
  shiftCount: number;
  salesTotal: number;
  wageTotal: number;
  commissionTotal: number;
  incomeTotal: number;
  days: DayRow[];
};

type Report = {
  summary: {
    year: number;
    month: number;
    staffCount: number;
    staffWithPay: number;
    salesTotal: number;
    wageTotal: number;
    commissionTotal: number;
    incomeTotal: number;
    shiftCount: number;
  };
  people: PersonRow[];
};

const { get, put } = useAdminApi();
const pending = ref(false);
const error = ref("");
const branches = ref<Branch[]>([]);
const staffList = ref<Staff[]>([]);
const report = ref<Report | null>(null);
const selectedId = ref<string | null>(null);
const openDays = ref<Record<string, boolean>>({});
const wageEditDate = ref<string | null>(null);
const wageEditValue = ref("");
const wageEditNote = ref("");
const wageSaving = ref(false);
const wageError = ref("");

const now = new Date();
const filters = reactive({
  year: now.getFullYear(),
  month: now.getMonth() + 1,
  branchId: "",
  staffId: "",
  q: "",
});

const yearOptions = computed(() => {
  const y = now.getFullYear();
  return [y, y - 1, y - 2, y - 3];
});

const monthOptions = [
  { v: 1, l: "มกราคม" },
  { v: 2, l: "กุมภาพันธ์" },
  { v: 3, l: "มีนาคม" },
  { v: 4, l: "เมษายน" },
  { v: 5, l: "พฤษภาคม" },
  { v: 6, l: "มิถุนายน" },
  { v: 7, l: "กรกฎาคม" },
  { v: 8, l: "สิงหาคม" },
  { v: 9, l: "กันยายน" },
  { v: 10, l: "ตุลาคม" },
  { v: 11, l: "พฤศจิกายน" },
  { v: 12, l: "ธันวาคม" },
];

const monthLabel = computed(() => {
  const m = monthOptions.find((x) => x.v === filters.month)?.l ?? "";
  return `${m} ${filters.year}`;
});

const people = computed(() => {
  const list = report.value?.people ?? [];
  const q = filters.q.trim().toLowerCase();
  if (!q) return list;
  return list.filter((p) =>
    [p.staffName, p.staffCode, p.rule].join(" ").toLowerCase().includes(q),
  );
});

const selected = computed(
  () =>
    (report.value?.people ?? []).find((p) => p.staffId === selectedId.value) ??
    null,
);

function baht(n: number) {
  return n.toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function fmtDay(isoDate: string) {
  const d = new Date(`${isoDate}T12:00:00+07:00`);
  return d.toLocaleDateString("th-TH", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

function fmtTime(iso: string | null) {
  if (!iso) return "-";
  return new Date(iso).toLocaleTimeString("th-TH", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function selectPerson(row: PersonRow) {
  selectedId.value = row.staffId;
  openDays.value = {};
  const firstPay = row.days.find((d) => d.commission > 0)?.date;
  if (firstPay) openDays.value[firstPay] = true;
  else if (row.days[0]) openDays.value[row.days[0].date] = true;
}

function toggleDay(date: string) {
  openDays.value[date] = !openDays.value[date];
}

function startWageEdit(d: DayRow) {
  wageEditDate.value = d.date;
  wageEditValue.value = String(d.wage);
  wageEditNote.value = d.wageNote || "";
  wageError.value = "";
  openDays.value[d.date] = true;
}

function cancelWageEdit() {
  wageEditDate.value = null;
  wageEditValue.value = "";
  wageEditNote.value = "";
  wageError.value = "";
}

async function saveWageEdit() {
  if (!selected.value || !wageEditDate.value) return;
  wageSaving.value = true;
  wageError.value = "";
  try {
    const raw = wageEditValue.value.trim();
    const wage = raw === "" ? null : Number(raw);
    if (wage != null && (!Number.isFinite(wage) || wage < 0)) {
      wageError.value = "จำนวนเงินไม่ถูกต้อง";
      return;
    }
    await put("/shifts/day-wage", {
      staffId: selected.value.staffId,
      date: wageEditDate.value,
      wage,
      note: wageEditNote.value.trim() || null,
    });
    cancelWageEdit();
    await load();
  } catch (e) {
    wageError.value =
      e instanceof Error ? e.message : "บันทึกค่าแรงไม่สำเร็จ";
  } finally {
    wageSaving.value = false;
  }
}

async function resetWageEdit(d: DayRow) {
  if (!selected.value) return;
  wageSaving.value = true;
  wageError.value = "";
  try {
    await put("/shifts/day-wage", {
      staffId: selected.value.staffId,
      date: d.date,
      wage: null,
      note: null,
    });
    cancelWageEdit();
    await load();
  } catch (e) {
    wageError.value =
      e instanceof Error ? e.message : "คืนค่าเริ่มต้นไม่สำเร็จ";
  } finally {
    wageSaving.value = false;
  }
}

function shiftMonth(delta: number) {
  let y = filters.year;
  let m = filters.month + delta;
  while (m < 1) {
    m += 12;
    y -= 1;
  }
  while (m > 12) {
    m -= 12;
    y += 1;
  }
  filters.year = y;
  filters.month = m;
  void load();
}

function setThisMonth() {
  filters.year = now.getFullYear();
  filters.month = now.getMonth() + 1;
  void load();
}

async function loadMeta() {
  try {
    const [b, s] = await Promise.all([
      get<{ branches: Branch[] }>("/branches"),
      get<{ staff: Staff[] }>("/staff"),
    ]);
    branches.value = b.branches ?? [];
    staffList.value = (s.staff ?? []).filter((x) => x.code !== "admin");
  } catch {
    branches.value = [];
    staffList.value = [];
  }
}

async function load() {
  pending.value = true;
  error.value = "";
  try {
    const qs = new URLSearchParams();
    qs.set("year", String(filters.year));
    qs.set("month", String(filters.month));
    if (filters.branchId) qs.set("branchId", filters.branchId);
    if (filters.staffId) qs.set("staffId", filters.staffId);
    const data = await get<Report>(
      `/shifts/commission-report?${qs.toString()}`,
    );
    report.value = data;
    const keep = data.people.find((p) => p.staffId === selectedId.value);
    if (!keep) {
      if (data.people[0]) selectPerson(data.people[0]);
      else {
        selectedId.value = null;
        openDays.value = {};
      }
    }
  } catch (e) {
    error.value =
      e instanceof Error ? e.message : "โหลดรายงานค่าคอมไม่สำเร็จ";
    report.value = null;
    selectedId.value = null;
  } finally {
    pending.value = false;
  }
}

onMounted(async () => {
  await loadMeta();
  await load();
});
</script>

<template>
  <div class="ui-comm">
    <div class="ui-page-head">
      <div>
        <h1 class="ui-page-title">ค่าแรงและค่าคอม</h1>
        <p class="ui-page-sub">
          รายได้พนักงานรายเดือน = ค่าแรง + ค่าคอมจากยอดขายตอนปิดกะ
        </p>
      </div>
      <div class="ui-page-head__actions">
        <NuxtLink to="/staff" class="ui-btn ui-btn--ghost">ตั้งค่าพนักงาน</NuxtLink>
        <button type="button" class="ui-btn ui-btn--ghost" @click="setThisMonth">
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

    <UiReportTabs />

    <div class="ui-card ui-comm__filters">
      <div class="ui-comm__filter-row">
        <div class="ui-field">
          <span>เดือน</span>
          <div class="ui-comm__monthbar">
            <button
              type="button"
              class="ui-btn ui-btn--ghost"
              title="เดือนก่อน"
              @click="shiftMonth(-1)"
            >
              ‹
            </button>
            <select
              v-model.number="filters.month"
              class="ui-input"
              @change="load"
            >
              <option v-for="m in monthOptions" :key="m.v" :value="m.v">
                {{ m.l }}
              </option>
            </select>
            <select
              v-model.number="filters.year"
              class="ui-input ui-comm__year"
              @change="load"
            >
              <option v-for="y in yearOptions" :key="y" :value="y">{{ y }}</option>
            </select>
            <button
              type="button"
              class="ui-btn ui-btn--ghost"
              title="เดือนถัดไป"
              @click="shiftMonth(1)"
            >
              ›
            </button>
          </div>
        </div>

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
          <span>พนักงาน</span>
          <select v-model="filters.staffId" class="ui-input" @change="load">
            <option value="">ทุกคน</option>
            <option v-for="s in staffList" :key="s.id" :value="s.id">
              {{ s.code }} · {{ s.name }}
            </option>
          </select>
        </label>

        <label class="ui-field ui-comm__search">
          <span>ค้นหา</span>
          <input
            v-model="filters.q"
            class="ui-input"
            type="search"
            placeholder="ชื่อ / รหัส / สูตรคอม"
          />
        </label>
      </div>
    </div>

    <div v-if="error" class="ui-empty">{{ error }}</div>
    <div v-else-if="pending && !report" class="ui-empty">กำลังโหลด...</div>

    <template v-if="report">
      <div class="ui-dash__kpi-strip ui-comm__kpis">
        <div class="ui-dash__kpi">
          <p class="ui-dash__kpi-label">รายได้รวม</p>
          <p class="ui-dash__kpi-value">{{ baht(report.summary.incomeTotal) }}</p>
          <p class="ui-dash__kpi-hint">{{ monthLabel }} · ค่าแรง + ค่าคอม</p>
        </div>
        <div class="ui-dash__kpi">
          <p class="ui-dash__kpi-label">ค่าแรง</p>
          <p class="ui-dash__kpi-value">{{ baht(report.summary.wageTotal) }}</p>
          <p class="ui-dash__kpi-hint">วันทำงาน × อัตรารายวัน</p>
        </div>
        <div class="ui-dash__kpi">
          <p class="ui-dash__kpi-label">ค่าคอม</p>
          <p class="ui-dash__kpi-value">
            {{ baht(report.summary.commissionTotal) }}
          </p>
          <p class="ui-dash__kpi-hint">
            ได้คอม {{ report.summary.staffWithPay }} คน
          </p>
        </div>
        <div class="ui-dash__kpi">
          <p class="ui-dash__kpi-label">ยอดขายคิดคอม</p>
          <p class="ui-dash__kpi-value">{{ baht(report.summary.salesTotal) }}</p>
          <p class="ui-dash__kpi-hint">{{ report.summary.shiftCount }} รอบขาย</p>
        </div>
      </div>

      <div class="ui-comm__split">
        <section class="ui-card ui-comm__list">
          <div class="ui-card__toolbar">
            <span class="ui-toolbar-meta ui-toolbar-meta--alone">
              พนักงาน {{ people.length }} คน
            </span>
          </div>

          <div v-if="pending && !people.length" class="ui-empty">กำลังโหลด...</div>
          <div v-else-if="!people.length" class="ui-empty">
            ยังไม่มีข้อมูลค่าแรงหรือค่าคอมในเดือนนี้
            <span class="ui-empty__hint">
              ตั้งค่าแรง/สูตรคอมที่เมนูพนักงาน · ค่าคอมคิดตอนปิดกะบน POS
            </span>
          </div>
          <div v-else class="ui-comm__list-body">
            <button
              v-for="row in people"
              :key="row.staffId"
              type="button"
              class="ui-comm__row"
              :class="{ 'is-active': selectedId === row.staffId }"
              @click="selectPerson(row)"
            >
              <div class="ui-comm__row-main">
                <strong>{{ row.staffName }}</strong>
                <span>{{ row.staffCode }}</span>
              </div>
              <div class="ui-comm__row-meta">
                <span v-if="row.commissionEnabled">คอมเปิด</span>
                <span v-else class="is-off">ไม่คิดคอม</span>
                <span>·</span>
                <span>{{ row.dayCount }} วันทำงาน · ได้คอม {{ row.daysWithPay }}</span>
              </div>
              <div class="ui-comm__row-foot">
                <span>
                  แรง {{ baht(row.wageTotal) }}
                  <template v-if="row.dailyWage > 0">
                    ({{ baht(row.dailyWage) }}/วัน)
                  </template>
                  · คอม {{ baht(row.commissionTotal) }}
                </span>
                <strong>{{ baht(row.incomeTotal) }}</strong>
              </div>
            </button>
          </div>
        </section>

        <section class="ui-card ui-comm__detail">
          <div v-if="!selected" class="ui-comm__detail-empty">
            <p>เลือกพนักงานจากรายการ</p>
            <span>ดูรายวัน · รอบขาย · ค่าคอมแบบเต็มที่นี่</span>
          </div>

          <div v-else class="ui-comm__detail-scroll">
            <header class="ui-comm__detail-head">
              <div>
                <p class="ui-comm__detail-kicker">{{ monthLabel }}</p>
                <h2>
                  {{ selected.staffName }}
                  <em>{{ selected.staffCode }}</em>
                </h2>
                <p class="ui-comm__detail-rule">{{ selected.rule }}</p>
              </div>
            </header>

            <div class="ui-comm__detail-grid">
              <div>
                <span>ค่าแรง/วัน</span>
                <strong>{{ baht(selected.dailyWage) }}</strong>
              </div>
              <div>
                <span>ค่าแรงรวม</span>
                <strong>{{ baht(selected.wageTotal) }}</strong>
              </div>
              <div>
                <span>ค่าคอม</span>
                <strong>{{ baht(selected.commissionTotal) }}</strong>
              </div>
              <div>
                <span>รายได้รวม</span>
                <strong class="is-total">{{ baht(selected.incomeTotal) }}</strong>
              </div>
              <div>
                <span>ยอดขายเดือน</span>
                <strong>{{ baht(selected.salesTotal) }}</strong>
              </div>
              <div>
                <span>วันทำงาน</span>
                <strong>{{ selected.dayCount }}</strong>
              </div>
              <div>
                <span>รอบขาย</span>
                <strong>{{ selected.shiftCount }}</strong>
              </div>
            </div>

            <div class="ui-comm__days-head">
              <strong>รายวัน</strong>
              <span>{{ selected.dayCount }} วัน · ได้คอม {{ selected.daysWithPay }}</span>
            </div>
            <p class="ui-comm__days-hint">
              กด “แก้ค่าแรง” เพื่อปรับรายวัน (เช่น ครึ่งวัน) · ค่าเริ่มต้นตั้งที่เมนูพนักงาน
            </p>

            <div v-if="!selected.days.length" class="ui-empty">
              ไม่มีกะขายในเดือนนี้
            </div>
            <div v-else class="ui-comm__days">
              <div
                v-for="d in selected.days"
                :key="d.date"
                class="ui-comm__day"
                :class="{
                  'is-open': openDays[d.date],
                  'has-pay': d.commission > 0,
                }"
              >
                <button
                  type="button"
                  class="ui-comm__day-toggle"
                  @click="toggleDay(d.date)"
                >
                  <div class="ui-comm__day-left">
                    <strong>{{ fmtDay(d.date) }}</strong>
                    <span>
                      {{ d.shiftCount }} รอบ · ขาย {{ baht(d.daySales) }}
                      <template v-if="d.wage > 0 || d.wageAdjusted">
                        · แรง {{ baht(d.wage) }}
                        <em v-if="d.wageAdjusted" class="ui-comm__adj">ปรับแล้ว</em>
                      </template>
                    </span>
                  </div>
                  <div class="ui-comm__day-right">
                    <strong :class="{ 'is-muted': d.dayIncome <= 0 }">
                      {{ baht(d.dayIncome) }}
                    </strong>
                    <span v-if="d.commission > 0">คอม {{ baht(d.commission) }}</span>
                    <span v-else-if="d.steps">{{ d.steps }} ขั้น</span>
                    <span v-else class="is-muted">-</span>
                    <em>{{ openDays[d.date] ? "▾" : "▸" }}</em>
                  </div>
                </button>

                <div v-if="openDays[d.date]" class="ui-comm__shifts">
                  <div class="ui-comm__wage-edit">
                    <template v-if="wageEditDate === d.date">
                      <label>
                        <span>ค่าแรงวันนี้ (บาท)</span>
                        <input
                          v-model="wageEditValue"
                          type="number"
                          min="0"
                          step="50"
                          class="ui-input"
                          :placeholder="String(d.wageDefault)"
                        />
                      </label>
                      <label>
                        <span>หมายเหตุ</span>
                        <input
                          v-model="wageEditNote"
                          type="text"
                          class="ui-input"
                          placeholder="เช่น ครึ่งวัน"
                        />
                      </label>
                      <p v-if="wageError" class="ui-comm__wage-err">{{ wageError }}</p>
                      <div class="ui-comm__wage-actions">
                        <button
                          type="button"
                          class="ui-btn ui-btn--primary"
                          :disabled="wageSaving"
                          @click="saveWageEdit"
                        >
                          {{ wageSaving ? "กำลังบันทึก..." : "บันทึก" }}
                        </button>
                        <button
                          type="button"
                          class="ui-btn"
                          :disabled="wageSaving"
                          @click="cancelWageEdit"
                        >
                          ยกเลิก
                        </button>
                      </div>
                      <p class="ui-field-hint">
                        ค่าเริ่มต้น {{ baht(d.wageDefault) }}/วัน · ว่างแล้วบันทึก = คืนค่าเริ่มต้น
                      </p>
                    </template>
                    <template v-else>
                      <div class="ui-comm__wage-summary">
                        <span>
                          ค่าแรง {{ baht(d.wage) }}
                          <template v-if="d.wageAdjusted">
                            (ปรับจาก {{ baht(d.wageDefault) }})
                          </template>
                          <template v-else> (ตามอัตรา)</template>
                        </span>
                        <span v-if="d.wageNote">· {{ d.wageNote }}</span>
                      </div>
                      <div class="ui-comm__wage-actions">
                        <button
                          type="button"
                          class="ui-btn"
                          @click="startWageEdit(d)"
                        >
                          แก้ค่าแรง
                        </button>
                        <button
                          v-if="d.wageAdjusted"
                          type="button"
                          class="ui-btn"
                          :disabled="wageSaving"
                          @click="resetWageEdit(d)"
                        >
                          คืนค่าเริ่มต้น
                        </button>
                      </div>
                    </template>
                  </div>

                  <div
                    v-for="s in d.shifts"
                    :key="s.id"
                    class="ui-comm__shift"
                  >
                    <span>{{ fmtTime(s.openedAt) }} – {{ fmtTime(s.closedAt) }}</span>
                    <span>{{ s.billCount }} บิล</span>
                    <strong>{{ baht(s.grossTotal) }}</strong>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </template>
  </div>
</template>

<style scoped>
.ui-comm {
  display: flex;
  flex-direction: column;
  gap: 0;
}

.ui-comm :deep(.ui-page-head) {
  margin-bottom: 0.75rem;
}

.ui-comm__filters {
  margin-top: 0.75rem;
  padding: 0.85rem 1rem;
}

.ui-comm__filter-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem 1rem;
  align-items: end;
}

.ui-comm__filters .ui-field {
  min-width: 9rem;
}

.ui-comm__search {
  flex: 1 1 12rem;
  min-width: 12rem;
}

.ui-comm__monthbar {
  display: flex;
  align-items: center;
  gap: 0.35rem;
}

.ui-comm__monthbar .ui-input {
  min-width: 7.5rem;
}

.ui-comm__year {
  min-width: 5.5rem !important;
}

.ui-comm__kpis {
  margin-top: 1rem;
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.ui-comm__split {
  display: grid;
  grid-template-columns: minmax(260px, 340px) minmax(0, 1fr);
  gap: 1rem;
  margin-top: 1rem;
  align-items: stretch;
  /* ความสูงคงที่พอให้รายวันเลื่อนในแผงได้ แม้จอสั้น */
  height: min(70dvh, calc(100dvh - 15rem));
  min-height: 22rem;
}

.ui-comm__list,
.ui-comm__detail {
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
  overflow: hidden;
}

.ui-comm__list-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 0.35rem 0.55rem 0.75rem;
}

.ui-comm__detail-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding-bottom: 1.25rem;
}

.ui-comm__days {
  padding: 0.35rem 0.55rem 0.75rem;
}

.ui-comm__row {
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

.ui-comm__row:hover {
  background: #f8fafc;
}

.ui-comm__row.is-active {
  background: #eff6ff;
  border-color: #bfdbfe;
}

.ui-comm__row-main {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.5rem;
}

.ui-comm__row-main strong {
  font-size: 0.95rem;
  color: #0f172a;
}

.ui-comm__row-main span,
.ui-comm__row-meta {
  font-size: 0.78rem;
  color: #64748b;
}

.ui-comm__row-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
}

.ui-comm__row-meta .is-off {
  color: #94a3b8;
}

.ui-comm__row-foot {
  display: flex;
  justify-content: space-between;
  gap: 0.5rem;
  margin-top: 0.15rem;
  font-size: 0.78rem;
  color: #64748b;
}

.ui-comm__row-foot strong {
  color: #0f172a;
  font-size: 0.95rem;
  font-variant-numeric: tabular-nums;
}

.ui-comm__detail {
  padding-bottom: 0;
}

.ui-comm__detail-empty {
  flex: 1;
  display: grid;
  place-content: center;
  text-align: center;
  padding: 2rem;
  color: #64748b;
}

.ui-comm__detail-empty p {
  margin: 0 0 0.35rem;
  font-weight: 650;
  color: #334155;
}

.ui-comm__detail-empty span {
  font-size: 0.85rem;
  color: #94a3b8;
}

.ui-comm__detail-head {
  padding: 1rem 1.15rem 0.35rem;
}

.ui-comm__detail-kicker {
  margin: 0 0 0.2rem;
  font-size: 0.78rem;
  color: #64748b;
  font-weight: 650;
}

.ui-comm__detail-head h2 {
  margin: 0;
  font-size: 1.35rem;
  font-weight: 750;
  color: #0f172a;
  letter-spacing: -0.02em;
}

.ui-comm__detail-head em {
  margin-left: 0.4rem;
  font-style: normal;
  font-size: 0.9rem;
  font-weight: 600;
  color: #64748b;
}

.ui-comm__detail-rule {
  margin: 0.35rem 0 0;
  font-size: 0.82rem;
  color: #64748b;
}

.ui-comm__detail-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0.45rem;
  padding: 0.35rem 1rem 0.65rem;
}

.ui-comm__detail-grid > div {
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 0.7rem;
  padding: 0.55rem 0.7rem;
  min-width: 0;
}

.ui-comm__detail-grid span {
  display: block;
  font-size: 0.72rem;
  color: #64748b;
  font-weight: 650;
}

.ui-comm__detail-grid strong {
  display: block;
  margin-top: 0.15rem;
  font-size: 1.05rem;
  color: #0f172a;
  font-variant-numeric: tabular-nums;
}

.ui-comm__detail-grid strong.is-total {
  color: var(--ui-primary-dark, #1d4ed8);
}

.ui-comm__days-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  padding: 0.35rem 1.15rem 0.5rem;
  border-top: 1px solid #e2e8f0;
}

.ui-comm__days-head strong {
  font-size: 0.9rem;
  color: #0f172a;
}

.ui-comm__days-head span {
  font-size: 0.78rem;
  color: #64748b;
}

.ui-comm__day {
  border: 1px solid #e2e8f0;
  border-radius: 0.75rem;
  background: #fff;
  margin-bottom: 0.45rem;
  overflow: hidden;
}

.ui-comm__day.has-pay {
  border-color: #bfdbfe;
}

.ui-comm__day-toggle {
  display: flex;
  width: 100%;
  justify-content: space-between;
  gap: 0.75rem;
  align-items: center;
  text-align: left;
  border: 0;
  background: transparent;
  padding: 0.7rem 0.85rem;
  cursor: pointer;
  color: inherit;
}

.ui-comm__day.is-open .ui-comm__day-toggle {
  background: #f8fafc;
}

.ui-comm__day-left {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  min-width: 0;
}

.ui-comm__day-left strong {
  font-size: 0.9rem;
  color: #0f172a;
}

.ui-comm__day-left span,
.ui-comm__day-right span {
  font-size: 0.75rem;
  color: #64748b;
}

.ui-comm__day-right {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  flex-shrink: 0;
}

.ui-comm__day-right strong {
  font-variant-numeric: tabular-nums;
  color: #0f172a;
}

.ui-comm__day-right strong.is-muted,
.ui-comm__day-right span.is-muted {
  color: #94a3b8;
  font-weight: 500;
}

.ui-comm__day-right em {
  font-style: normal;
  color: #94a3b8;
  font-size: 0.75rem;
}

.ui-comm__days-hint {
  margin: 0 0 0.55rem;
  font-size: 0.78rem;
  color: #64748b;
}

.ui-comm__adj {
  font-style: normal;
  margin-left: 0.25rem;
  padding: 0.05rem 0.35rem;
  border-radius: 999px;
  background: #fef3c7;
  color: #92400e;
  font-size: 0.68rem;
  font-weight: 700;
}

.ui-comm__wage-edit {
  display: grid;
  gap: 0.45rem;
  padding: 0.55rem 0.4rem 0.65rem;
  margin-bottom: 0.25rem;
  border-bottom: 1px dashed #e2e8f0;
}

.ui-comm__wage-edit label {
  display: grid;
  gap: 0.2rem;
  font-size: 0.78rem;
  color: #475569;
}

.ui-comm__wage-summary {
  font-size: 0.82rem;
  color: #334155;
}

.ui-comm__wage-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}

.ui-comm__wage-err {
  margin: 0;
  color: #b91c1c;
  font-size: 0.78rem;
}

.ui-comm__shifts {
  border-top: 1px solid #e2e8f0;
  padding: 0.35rem 0.55rem 0.55rem;
  background: #fafbfc;
}

.ui-comm__shift {
  display: grid;
  grid-template-columns: 1fr auto auto;
  gap: 0.75rem;
  align-items: center;
  padding: 0.4rem 0.4rem;
  font-size: 0.82rem;
  color: #475569;
}

.ui-comm__shift + .ui-comm__shift {
  border-top: 1px dashed #e2e8f0;
}

.ui-comm__shift strong {
  font-variant-numeric: tabular-nums;
  color: #0f172a;
}

@media (max-width: 980px) {
  .ui-comm__split {
    grid-template-columns: 1fr;
    height: auto;
    min-height: 0;
  }

  .ui-comm__list {
    height: auto;
    max-height: 16rem;
  }

  .ui-comm__detail {
    height: auto;
    min-height: 24rem;
    max-height: min(65dvh, 36rem);
  }

  .ui-comm__kpis {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .ui-comm__detail-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-height: 820px) {
  .ui-comm__split {
    height: min(75dvh, calc(100dvh - 12rem));
    min-height: 18rem;
  }

  .ui-comm__detail-grid {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }

  .ui-comm__detail-grid > div {
    padding: 0.4rem 0.55rem;
  }

  .ui-comm__detail-grid strong {
    font-size: 0.95rem;
  }
}

</style>
