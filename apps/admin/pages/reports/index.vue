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
  /** เงินโอน แยกตาม PromptPay ที่ snapshot ตอน sync (ไม่รวมรัฐ) */
  byPromptPay?: Array<{
    promptPayId: string | null;
    promptPayName: string | null;
    branchIds: string[];
    branchNames: string[];
    amount: number;
    count: number;
  }>;
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
  series: Array<{
    period: string;
    billCount: number;
    grossTotal: number;
    byBranch?: Array<{
      branchId: string;
      branchName: string;
      billCount: number;
      grossTotal: number;
    }>;
  }>;
  sales: ReportSale[];
};

type ViewLevel = "year" | "month" | "day";

const PAY_LABELS: Record<string, string> = {
  cash: "เงินสด",
  transfer: "เงินโอน",
  government: "เงินสวัสดิการ",
  points: "ส่วนลดแต้ม",
};

const MONTH_TH = [
  "ม.ค.",
  "ก.พ.",
  "มี.ค.",
  "เม.ย.",
  "พ.ค.",
  "มิ.ย.",
  "ก.ค.",
  "ส.ค.",
  "ก.ย.",
  "ต.ค.",
  "พ.ย.",
  "ธ.ค.",
];

const { get } = useAdminApi();
const pending = ref(false);
const error = ref("");
const branches = ref<Branch[]>([]);
const report = ref<Report | null>(null);
const billQ = ref("");
const showBreakdown = ref(false);

const now = new Date();
const viewLevel = ref<ViewLevel>("day");
const year = ref(now.getFullYear());
const month = ref(now.getMonth() + 1); // 1-12
const day = ref(
  `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`,
);

const filters = reactive({
  branchId: "",
  paymentMethod: "",
});

const yearOptions = computed(() => {
  const y = now.getFullYear();
  const out: number[] = [];
  for (let i = y; i >= y - 6; i--) out.push(i);
  return out;
});

function daysInMonth(y: number, m: number) {
  return new Date(y, m, 0).getDate();
}

function monthKey(y: number, m: number) {
  return `${y}-${String(m).padStart(2, "0")}`;
}

function rangeForView() {
  if (viewLevel.value === "year") {
    return {
      from: `${year.value}-01-01`,
      to: `${year.value}-12-31`,
      groupBy: "month" as const,
      includeSales: false,
    };
  }
  if (viewLevel.value === "month") {
    const last = daysInMonth(year.value, month.value);
    const mk = monthKey(year.value, month.value);
    return {
      from: `${mk}-01`,
      to: `${mk}-${String(last).padStart(2, "0")}`,
      groupBy: "day" as const,
      includeSales: false,
    };
  }
  return {
    from: day.value,
    to: day.value,
    groupBy: "day" as const,
    includeSales: true,
  };
}

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

/** "" = ทุกสาขา · ไม่เช่นนั้นเป็น branchId */
const billsBranchTab = ref("");

/** รายวัน: จัดกลุ่มบิลตามสาขา (สำหรับ tab + สรุป) */
const salesByBranchGroups = computed(() => {
  const cols =
    seriesBranchCols.value.length > 0
      ? seriesBranchCols.value
      : [...new Set(filteredSales.value.map((s) => s.branchId))].map((id) => ({
          id,
          name: branchName(id),
        }));
  return cols
    .map((col) => {
      const rows = filteredSales.value.filter((s) => s.branchId === col.id);
      const total = rows.reduce((s, r) => s + Number(r.total || 0), 0);
      return {
        branchId: col.id,
        branchName: col.name,
        rows,
        billCount: rows.length,
        grossTotal: Math.round(total * 100) / 100,
      };
    })
    .filter((g) => g.billCount > 0 || showAllBranches.value);
});

const showBillsBranchTabs = computed(
  () => !filters.branchId && salesByBranchGroups.value.length > 1,
);

const billsTabOptions = computed(() => {
  if (!showBillsBranchTabs.value) return [];
  const allTotal = filteredSales.value.reduce(
    (s, r) => s + Number(r.total || 0),
    0,
  );
  return [
    {
      id: "",
      name: "ทุกสาขา",
      billCount: filteredSales.value.length,
      grossTotal: Math.round(allTotal * 100) / 100,
    },
    ...salesByBranchGroups.value.map((g) => ({
      id: g.branchId,
      name: g.branchName,
      billCount: g.billCount,
      grossTotal: g.grossTotal,
    })),
  ];
});

const activeBillsRows = computed(() => {
  if (!billsBranchTab.value) return filteredSales.value;
  return filteredSales.value.filter((s) => s.branchId === billsBranchTab.value);
});

const activeBillsGross = computed(() => {
  const total = activeBillsRows.value.reduce(
    (s, r) => s + Number(r.total || 0),
    0,
  );
  return Math.round(total * 100) / 100;
});

const activeBillsTitle = computed(() => {
  if (!billsBranchTab.value) return "ทุกสาขา";
  return (
    salesByBranchGroups.value.find((g) => g.branchId === billsBranchTab.value)
      ?.branchName || branchName(billsBranchTab.value)
  );
});

const salesPage = ref(1);
const salesPerPage = ref(40);
const salesPaged = computed(() =>
  paginateItems(activeBillsRows.value, salesPage.value, salesPerPage.value),
);
const salesPageRows = computed(() => salesPaged.value.rows);
const salesMeta = computed(() => salesPaged.value.meta);

watch(billQ, () => {
  salesPage.value = 1;
});

watch(billsBranchTab, () => {
  salesPage.value = 1;
});

watch(
  () => filters.branchId,
  (id) => {
    billsBranchTab.value = id || "";
    salesPage.value = 1;
  },
);

function onSalesPageChange(payload: { page: number; per_page: number }) {
  salesPage.value = payload.page;
  salesPerPage.value = payload.per_page;
}

function setBillsBranchTab(id: string) {
  billsBranchTab.value = id;
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

/** ลำดับสาขา: หลุมดิน → เจ็ดเสมียน → อื่น (ตามรหัส) */
function branchRank(name: string) {
  if (/หลุมดิน/.test(name)) return 0;
  if (/เจ็ดเสมียน/.test(name)) return 1;
  return 2;
}

function sortBranchesByOrder<T extends { name?: string; code?: string; branchName?: string; branchId?: string; id?: string }>(
  list: T[],
): T[] {
  return [...list].sort((a, b) => {
    const nameA = a.name || a.branchName || "";
    const nameB = b.name || b.branchName || "";
    const d = branchRank(nameA) - branchRank(nameB);
    if (d !== 0) return d;
    const codeA =
      a.code ||
      branches.value.find((x) => x.id === (a.id || a.branchId))?.code ||
      "";
    const codeB =
      b.code ||
      branches.value.find((x) => x.id === (b.id || b.branchId))?.code ||
      "";
    if (codeA && codeB) return codeA.localeCompare(codeB, "th");
    return nameA.localeCompare(nameB, "th");
  });
}

function branchLabel(row: Report["byBranch"][number]) {
  return row.branchName || branchName(row.branchId);
}

const orderedByBranch = computed(() =>
  report.value ? sortBranchesByOrder(report.value.byBranch) : [],
);

/** สรุปช่องทาง: สด / โอน / รัฐ (เรียงคงที่) */
const PAY_SUMMARY_ORDER = ["cash", "transfer", "government"] as const;
const paymentSummary = computed(() => {
  if (!report.value)
    return [] as Array<{
      method: string;
      label: string;
      amount: number;
      count: number;
    }>;
  const map = new Map(report.value.byPayment.map((r) => [r.method, r]));
  return PAY_SUMMARY_ORDER.map((method) => {
    const hit = map.get(method);
    return {
      method,
      label: PAY_LABELS[method] ?? method,
      amount: hit?.amount ?? 0,
      count: hit?.count ?? 0,
    };
  }).filter((r) => r.amount > 0 || r.count > 0);
});

/**
 * เงินเข้า PromptPay จากยอดโอนอย่างเดียว (รัฐไม่เข้าเลขนี้)
 * เกณฑ์ธนาคารส่งสรรพากร: ≥3,000 ครั้ง/ปี หรือ ≥400 ครั้งและ ≥2 ล้าน
 */
const bankInSummary = computed(() => {
  let count = 0;
  let amount = 0;
  for (const p of paymentSummary.value) {
    if (p.method === "transfer") {
      count += p.count;
      amount += p.amount;
    }
  }
  return {
    count,
    amount: Math.round(amount * 100) / 100,
    hit3000: count >= 3000,
    hit400and2m: count >= 400 && amount >= 2_000_000,
  };
});

const bankInHint = computed(() => {
  const s = bankInSummary.value;
  if (s.count <= 0 && s.amount <= 0) return "";
  if (s.hit3000 || s.hit400and2m) {
    return "ช่วงนี้เข้าเกณฑ์ที่ธนาคารอาจต้องส่งข้อมูลให้สรรพากร (จากยอดในระบบ)";
  }
  if (viewLevel.value === "year") {
    const left400 = Math.max(0, 400 - s.count);
    const left2m = Math.max(0, 2_000_000 - s.amount);
    if (s.count >= 400) {
      return `ครบ 400 ครั้งแล้ว · ยังขาดอีก ${baht(left2m)} ถึง 2 ล้าน (เงื่อนไขคู่)`;
    }
    if (s.amount >= 2_000_000) {
      return `ยอดเกิน 2 ล้านแล้ว · ยังขาดอีก ${left400.toLocaleString("th-TH")} ครั้ง ถึงเงื่อนไขคู่`;
    }
    return `ยังไม่เข้าเกณฑ์ · อีก ${left400.toLocaleString("th-TH")} ครั้งถึง 400 หรือรวม 3,000 ครั้ง/ปี`;
  }
  return "เกณฑ์ธนาคารส่งสรรพากรนับทั้งปีปฏิทินต่อธนาคาร · เลือกมุมมองรายปีเพื่อเทียบคร่าวๆ";
});

function maskPromptPayId(id: string | null | undefined) {
  const d = String(id ?? "").replace(/\D/g, "");
  if (!d) return "ไม่ระบุ PromptPay";
  if (d.length <= 4) return d;
  return `${"•".repeat(Math.min(6, d.length - 4))}${d.slice(-4)}`;
}

function promptPayRowLabel(row: NonNullable<Report["byPromptPay"]>[number]) {
  const name = row.promptPayName?.trim();
  const id = maskPromptPayId(row.promptPayId);
  const branches =
    row.branchNames?.length > 0 ? row.branchNames.join(" · ") : "";
  if (name) return `${name} (${id})${branches ? ` · ${branches}` : ""}`;
  return `${id}${branches ? ` · ${branches}` : ""}`;
}

const promptPaySummary = computed(() => report.value?.byPromptPay ?? []);

const showAllBranches = computed(
  () =>
    !filters.branchId &&
    ((report.value?.byBranch.length ?? 0) > 1 || branches.value.length > 1),
);

/** คอลัมน์สาขาในตารางสรุป — หลุมดิน → เจ็ดเสมียน */
const seriesBranchCols = computed(() => {
  if (filters.branchId) {
    const b = branches.value.find((x) => x.id === filters.branchId);
    return b ? [{ id: b.id, name: b.name }] : [];
  }
  if (branches.value.length) {
    return sortBranchesByOrder(branches.value).map((b) => ({
      id: b.id,
      name: b.name,
    }));
  }
  const map = new Map<string, string>();
  if (report.value) {
    for (const row of report.value.series) {
      for (const b of row.byBranch ?? []) {
        map.set(b.branchId, b.branchName);
      }
    }
    for (const b of report.value.byBranch) {
      map.set(b.branchId, b.branchName || branchName(b.branchId));
    }
  }
  return sortBranchesByOrder(
    [...map.entries()].map(([id, name]) => ({ id, name })),
  );
});

const seriesColSpan = computed(() => 2 + seriesBranchCols.value.length * 2 + 2);

function seriesBranchCell(
  row: Report["series"][number],
  branchId: string,
): { billCount: number; grossTotal: number } {
  const hit = row.byBranch?.find((b) => b.branchId === branchId);
  return {
    billCount: hit?.billCount ?? 0,
    grossTotal: hit?.grossTotal ?? 0,
  };
}

const seriesRows = computed(() =>
  report.value ? [...report.value.series].reverse() : [],
);

function fmtTime(iso: string) {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function shiftLabel(shiftId?: string | null) {
  if (!shiftId) return "-";
  const m = shiftId.match(/^shift-[^-]+-(.+)$/);
  return m?.[1] || shiftId;
}

function payFull(row: ReportSale) {
  const pays = (row.payments ?? []).filter(
    (p) => p.method !== "points" && Number(p.amount),
  );
  if (!pays.length) return "—";
  return pays
    .map((p) => `${payLabel(p.method)} ${baht(Number(p.amount))}`)
    .join(" · ");
}

function saleLink(row: ReportSale) {
  return {
    path: "/sales",
    query: { id: row.id, q: row.billNo },
  };
}

function memberLink(row: ReportSale) {
  if (!row.customerId) return { path: "/members/points" };
  return {
    path: "/members/points",
    query: { id: row.customerId },
  };
}

function formatPeriodLabel(period: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(period)) {
    const [y, m, d] = period.split("-").map(Number);
    return `${d} ${MONTH_TH[(m ?? 1) - 1]} ${y}`;
  }
  if (/^\d{4}-\d{2}$/.test(period)) {
    const [y, m] = period.split("-").map(Number);
    return `${MONTH_TH[(m ?? 1) - 1]} ${y}`;
  }
  return period;
}

const crumbLabel = computed(() => {
  if (viewLevel.value === "year") return `ปี ${year.value}`;
  if (viewLevel.value === "month") {
    return `${MONTH_TH[month.value - 1]} ${year.value}`;
  }
  return formatPeriodLabel(day.value);
});

const seriesTitle = computed(() => {
  if (viewLevel.value === "year") return "สรุปยอดรายเดือน";
  if (viewLevel.value === "month") return "สรุปยอดรายวัน";
  return "รายการบิลวันนี้";
});

async function loadBranches() {
  try {
    const data = await get<{ branches: Branch[] }>("/sales/branches");
    branches.value = sortBranchesByOrder(data.branches ?? []);
  } catch {
    branches.value = [];
  }
}

async function load() {
  pending.value = true;
  error.value = "";
  try {
    const range = rangeForView();
    const qs = new URLSearchParams();
    qs.set("from", range.from);
    qs.set("to", range.to);
    qs.set("groupBy", range.groupBy);
    qs.set("includeSales", range.includeSales ? "1" : "0");
    if (filters.branchId) qs.set("branchId", filters.branchId);
    if (filters.paymentMethod) qs.set("paymentMethod", filters.paymentMethod);
    report.value = await get<Report>(`/sales/report?${qs.toString()}`);
    salesPage.value = 1;
  } catch (e) {
    error.value = e instanceof Error ? e.message : "โหลดรายงานไม่สำเร็จ";
    report.value = null;
  } finally {
    pending.value = false;
  }
}

function setLevel(level: ViewLevel) {
  if (level === "day") {
    const prefix = monthKey(year.value, month.value);
    if (!day.value.startsWith(prefix)) {
      const today = new Date();
      const isCurrentMonth =
        today.getFullYear() === year.value &&
        today.getMonth() + 1 === month.value;
      const dd = isCurrentMonth ? today.getDate() : 1;
      const last = daysInMonth(year.value, month.value);
      day.value = `${prefix}-${String(Math.min(dd, last)).padStart(2, "0")}`;
    } else {
      year.value = Number(day.value.slice(0, 4));
      month.value = Number(day.value.slice(5, 7));
    }
  }
  viewLevel.value = level;
}

function openMonth(period: string) {
  const [y, m] = period.split("-").map(Number);
  if (!y || !m) return;
  year.value = y;
  month.value = m;
  viewLevel.value = "month";
}

function openDay(period: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(period)) return;
  day.value = period;
  const [y, m] = period.split("-").map(Number);
  year.value = y!;
  month.value = m!;
  viewLevel.value = "day";
}

async function onSeriesClick(period: string) {
  if (viewLevel.value === "year") openMonth(period);
  else if (viewLevel.value === "month") openDay(period);
  else return;
  await load();
}

function goYear() {
  viewLevel.value = "year";
}

function goMonth() {
  viewLevel.value = "month";
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
          เลือกปี → ดูรายเดือน · เลือกเดือน → ดูรายวัน · เลือกวัน → ดูรายการบิล
        </p>
      </div>
      <div class="ui-page-head__actions">
        <NuxtLink to="/sales" class="ui-btn ui-btn--ghost">ค้นหาบิล</NuxtLink>
      </div>
    </div>

    <UiReportTabs />

    <div class="ui-card ui-report-filters">
      <div class="ui-rpt__nav">
        <div class="ui-rpt__levels" role="tablist" aria-label="ระดับสรุป">
          <button
            type="button"
            class="ui-rpt__level"
            :class="{ 'is-active': viewLevel === 'year' }"
            @click="goYear"
          >
            รายปี
          </button>
          <button
            type="button"
            class="ui-rpt__level"
            :class="{ 'is-active': viewLevel === 'month' }"
            @click="goMonth"
          >
            รายเดือน
          </button>
          <button
            type="button"
            class="ui-rpt__level"
            :class="{ 'is-active': viewLevel === 'day' }"
            @click="setLevel('day')"
          >
            รายวัน
          </button>
        </div>

        <nav class="ui-rpt__crumb" aria-label="เส้นทาง">
          <button type="button" class="ui-rpt__crumb-link" @click="goYear">
            {{ year }}
          </button>
          <template v-if="viewLevel !== 'year'">
            <span class="ui-rpt__crumb-sep">/</span>
            <button type="button" class="ui-rpt__crumb-link" @click="goMonth">
              {{ MONTH_TH[month - 1] }}
            </button>
          </template>
          <template v-if="viewLevel === 'day'">
            <span class="ui-rpt__crumb-sep">/</span>
            <span class="ui-rpt__crumb-now">{{ day.slice(8) }}</span>
          </template>
        </nav>
      </div>

      <div class="ui-rpt__pickers">
        <label class="ui-field">
          <span>ปี</span>
          <select v-model.number="year" class="ui-input">
            <option v-for="y in yearOptions" :key="y" :value="y">
              {{ y }}
            </option>
          </select>
        </label>

        <label v-if="viewLevel !== 'year'" class="ui-field">
          <span>เดือน</span>
          <select v-model.number="month" class="ui-input">
            <option v-for="(name, i) in MONTH_TH" :key="name" :value="i + 1">
              {{ name }}
            </option>
          </select>
        </label>

        <label v-if="viewLevel === 'day'" class="ui-field">
          <span>วัน</span>
          <input v-model="day" class="ui-input" type="date" />
        </label>

        <label class="ui-field">
          <span>สาขา</span>
          <select v-model="filters.branchId" class="ui-input">
            <option value="">ทุกสาขา</option>
            <option v-for="b in branches" :key="b.id" :value="b.id">
              {{ b.name }}
            </option>
          </select>
        </label>

        <label class="ui-field">
          <span>ชำระด้วย</span>
          <select v-model="filters.paymentMethod" class="ui-input">
            <option value="">ทุกช่องทาง</option>
            <option value="cash">เงินสด</option>
            <option value="transfer">เงินโอน</option>
            <option value="government">เงินสวัสดิการ</option>
          </select>
        </label>

        <div class="ui-field ui-rpt__search-actions">
          <span>&nbsp;</span>
          <button
            type="button"
            class="ui-btn"
            :disabled="pending"
            @click="load"
          >
            {{ pending ? "กำลังโหลด…" : "ค้นหา" }}
          </button>
        </div>
      </div>
    </div>

    <div v-if="error" class="ui-empty">{{ error }}</div>

    <div class="ui-rpt__stats">
      <div class="ui-rpt__stat">
        <span class="ui-rpt__stat-label">ช่วง</span>
        <strong class="ui-rpt__stat-value">{{ crumbLabel }}</strong>
      </div>
      <template v-if="report && !pending">
        <div
          v-for="b in orderedByBranch"
          :key="b.branchId"
          class="ui-rpt__stat"
        >
          <span class="ui-rpt__stat-label">{{ branchLabel(b) }}</span>
          <strong class="ui-rpt__stat-value">{{ baht(b.grossTotal) }}</strong>
          <span class="ui-rpt__stat-sub"
            >{{ b.billCount.toLocaleString("th-TH") }} บิล</span
          >
        </div>
        <div class="ui-rpt__stat ui-rpt__stat--total">
          <span class="ui-rpt__stat-label">รวมทุกสาขา</span>
          <strong class="ui-rpt__stat-value">{{
            baht(report.summary.grossTotal)
          }}</strong>
          <span class="ui-rpt__stat-sub"
            >{{ report.summary.billCount.toLocaleString("th-TH") }} บิล</span
          >
        </div>
      </template>
      <div v-else-if="pending" class="ui-rpt__stat">
        <span class="ui-rpt__stat-label">สถานะ</span>
        <strong class="ui-rpt__stat-value">กำลังโหลด…</strong>
      </div>
    </div>

    <div
      v-if="report && !pending && paymentSummary.length"
      class="ui-rpt__pay-summary"
    >
      <div class="ui-rpt__pay-table-wrap">
        <table class="ui-rpt__pay-table">
          <thead>
            <tr>
              <th>ช่องทาง</th>
              <th class="ui-rpt__num">ครั้ง</th>
              <th class="ui-rpt__num">ยอด</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="p in paymentSummary" :key="p.method">
              <td>{{ p.label }}</td>
              <td class="ui-rpt__num ui-rpt__pay-count-em">
                {{ p.count.toLocaleString("th-TH") }}
              </td>
              <td class="ui-rpt__num">{{ baht(p.amount) }}</td>
            </tr>
            <tr
              v-if="bankInSummary.count > 0 || bankInSummary.amount > 0"
              class="ui-rpt__pay-bank"
            >
              <td>เงินโอน (เข้า PromptPay)</td>
              <td class="ui-rpt__num ui-rpt__pay-count-em">
                {{ bankInSummary.count.toLocaleString("th-TH") }}
              </td>
              <td class="ui-rpt__num">{{ baht(bankInSummary.amount) }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div
        v-if="promptPaySummary.length"
        class="ui-rpt__pay-table-wrap ui-rpt__pay-pp"
      >
        <p class="ui-rpt__pay-pp-title">
          แยกตาม PromptPay (เฉพาะเงินโอน)
          <span>（บันทึกตอน sync · รัฐไม่นับ · เปลี่ยนบัญชีทีหลังไม่ย้ายยอดเก่า）</span>
        </p>
        <table class="ui-rpt__pay-table">
          <thead>
            <tr>
              <th>บัญชีรับโอน</th>
              <th class="ui-rpt__num">ครั้ง</th>
              <th class="ui-rpt__num">ยอด</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(row, i) in promptPaySummary"
              :key="(row.promptPayId || 'x') + '-' + i"
            >
              <td>{{ promptPayRowLabel(row) }}</td>
              <td class="ui-rpt__num ui-rpt__pay-count-em">
                {{ row.count.toLocaleString("th-TH") }}
              </td>
              <td class="ui-rpt__num">{{ baht(row.amount) }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <p
        v-if="bankInHint"
        class="ui-rpt__pay-hint"
        :class="{
          'is-hit': bankInSummary.hit3000 || bankInSummary.hit400and2m,
        }"
      >
        {{ bankInHint }}
        <span class="ui-rpt__pay-hint-sub">
          · เกณฑ์: ≥3,000 ครั้ง/ปี หรือ ≥400 ครั้งและ ≥2 ล้าน (ต่อธนาคาร) ·
          นับเฉพาะยอดขายในระบบ ไม่รวมโอนส่วนตัว
        </span>
      </p>
    </div>

    <!-- ปี / เดือน: ตารางสรุป -->
    <div v-if="viewLevel !== 'day'" class="ui-card ui-rpt__series">
      <div class="ui-card__toolbar">
        <strong>{{ seriesTitle }}</strong>
        <span class="ui-toolbar-meta">คลิกแถวเพื่อเจาะลึกช่วงนั้น</span>
      </div>
      <div class="ui-table-wrap">
        <table class="ui-table ui-table--fit">
          <thead>
            <tr>
              <th rowspan="2">{{ viewLevel === "year" ? "เดือน" : "วัน" }}</th>
              <th
                v-for="b in seriesBranchCols"
                :key="b.id"
                class="ui-rpt__num"
                colspan="2"
              >
                {{ b.name }}
              </th>
              <th class="ui-rpt__num" colspan="2">รวม</th>
              <th rowspan="2"></th>
            </tr>
            <tr>
              <template v-for="b in seriesBranchCols" :key="b.id + '-sub'">
                <th class="ui-rpt__num ui-rpt__subh">บิล</th>
                <th class="ui-rpt__num ui-rpt__subh">ยอด</th>
              </template>
              <th class="ui-rpt__num ui-rpt__subh">บิล</th>
              <th class="ui-rpt__num ui-rpt__subh">ยอด</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="pending">
              <td :colspan="seriesColSpan" class="ui-rpt__loading">
                กำลังโหลดข้อมูล…
              </td>
            </tr>
            <tr v-else-if="!report">
              <td :colspan="seriesColSpan" class="ui-rpt__loading">
                กดค้นหาเพื่อโหลดข้อมูล
              </td>
            </tr>
            <tr v-else-if="!seriesRows.length">
              <td :colspan="seriesColSpan" class="ui-rpt__loading">
                ไม่มีข้อมูลในช่วงนี้
              </td>
            </tr>
            <template v-else>
              <tr
                v-for="row in seriesRows"
                :key="row.period"
                class="ui-rpt__row-click"
                @click="onSeriesClick(row.period)"
              >
                <td>{{ formatPeriodLabel(row.period) }}</td>
                <template v-for="b in seriesBranchCols" :key="row.period + b.id">
                  <td class="ui-rpt__num">
                    {{
                      seriesBranchCell(row, b.id).billCount.toLocaleString(
                        "th-TH",
                      )
                    }}
                  </td>
                  <td class="ui-rpt__num ui-rpt__amt">
                    {{ baht(seriesBranchCell(row, b.id).grossTotal) }}
                  </td>
                </template>
                <td class="ui-rpt__num">
                  {{ row.billCount.toLocaleString("th-TH") }}
                </td>
                <td class="ui-rpt__num ui-rpt__amt">
                  {{ baht(row.grossTotal) }}
                </td>
                <td class="ui-rpt__drill">เลือก ›</td>
              </tr>
            </template>
          </tbody>
          <tfoot v-if="report && !pending && seriesRows.length">
            <tr>
              <th>รวม</th>
              <template v-for="b in seriesBranchCols" :key="'t-' + b.id">
                <th class="ui-rpt__num">
                  {{
                    (
                      report.byBranch.find((x) => x.branchId === b.id)
                        ?.billCount ?? 0
                    ).toLocaleString("th-TH")
                  }}
                </th>
                <th class="ui-rpt__num">
                  {{
                    baht(
                      report.byBranch.find((x) => x.branchId === b.id)
                        ?.grossTotal ?? 0,
                    )
                  }}
                </th>
              </template>
              <th class="ui-rpt__num">
                {{ report.summary.billCount.toLocaleString("th-TH") }}
              </th>
              <th class="ui-rpt__num">
                {{ baht(report.summary.grossTotal) }}
              </th>
              <th></th>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>

    <!-- วัน: รายการบิลแยกสาขา (tab) -->
    <div v-else class="ui-card ui-rpt__bills">
      <div class="ui-card__toolbar ui-rpt__bills-bar">
        <div class="ui-rpt__bills-title">
          <strong>รายการบิล</strong>
          <span v-if="report && !pending">
            {{ salesMeta.total.toLocaleString("th-TH") }} บิล · รวม
            {{ baht(activeBillsGross) }}
            <template v-if="showBillsBranchTabs && billsBranchTab">
              · {{ activeBillsTitle }}
            </template>
          </span>
        </div>
        <label class="ui-rpt__search">
          <span class="ui-sr-only">กรองเลขบิล</span>
          <input
            v-model="billQ"
            class="ui-input"
            type="search"
            placeholder="กรองเลขบิล / สมาชิก / สาขา"
          />
        </label>
      </div>

      <div
        v-if="showBillsBranchTabs"
        class="ui-rpt__levels ui-rpt__bills-tabs"
        role="tablist"
        aria-label="สาขารายการบิล"
      >
        <button
          v-for="tab in billsTabOptions"
          :key="tab.id || 'all'"
          type="button"
          role="tab"
          class="ui-rpt__level"
          :class="{ 'is-active': billsBranchTab === tab.id }"
          :aria-selected="billsBranchTab === tab.id"
          @click="setBillsBranchTab(tab.id)"
        >
          {{ tab.name }}
          <span class="ui-rpt__tab-count">{{
            tab.billCount.toLocaleString("th-TH")
          }}</span>
        </button>
      </div>

      <div class="ui-table-wrap">
        <table class="ui-table ui-table--fit ui-rpt__table">
          <thead>
            <tr>
              <th class="ui-rpt__col-time">เวลา</th>
              <th class="ui-table__col-bill">เลขบิล</th>
              <th v-if="!billsBranchTab">สาขา</th>
              <th>สมาชิก</th>
              <th class="ui-rpt__col-pay">ชำระ</th>
              <th class="ui-rpt__num">ยอด</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="pending || !report || !salesMeta.total">
              <td
                :colspan="billsBranchTab ? 5 : 6"
                class="ui-rpt__loading"
              >
                <template v-if="pending">กำลังโหลดข้อมูล…</template>
                <template v-else-if="!report">กดค้นหาเพื่อโหลดข้อมูล</template>
                <template v-else>
                  {{
                    billQ.trim()
                      ? "ไม่พบบิลที่ตรงกับคำค้น"
                      : "ไม่มีบิลวันนี้"
                  }}
                </template>
              </td>
            </tr>
            <template v-else>
              <tr v-for="row in salesPageRows" :key="row.id">
                <td class="ui-rpt__time ui-rpt__col-time">
                  {{ fmtTime(row.createdAt) }}
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
                <td v-if="!billsBranchTab">{{ branchShort(row.branchId) }}</td>
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
                <td class="ui-rpt__num ui-rpt__amt">
                  {{ baht(row.total) }}
                </td>
              </tr>
            </template>
          </tbody>
          <tfoot v-if="report && !pending && salesMeta.total">
            <tr>
              <th :colspan="billsBranchTab ? 4 : 5">
                รวม {{ activeBillsTitle }}
              </th>
              <th class="ui-rpt__num">{{ baht(activeBillsGross) }}</th>
            </tr>
          </tfoot>
        </table>
      </div>
      <UiPagination
        v-if="report && !pending && salesMeta.total > 0"
        :meta="salesMeta"
        :page-size-options="[20, 40, 50, 100]"
        @change="onSalesPageChange"
      />
    </div>

      <div v-if="report && !pending" class="ui-rpt__more">
        <button
          type="button"
          class="ui-btn ui-btn--ghost"
          @click="showBreakdown = !showBreakdown"
        >
          {{ showBreakdown ? "ซ่อนสรุปย่อย" : "แสดงสรุปย่อย (ช่องทาง / สาขา)" }}
        </button>
      </div>

      <template v-if="report && !pending && showBreakdown">
        <div
          v-if="showAllBranches"
          class="ui-card"
          style="margin-top: 0.75rem"
        >
          <div class="ui-card__toolbar">
            <span class="ui-toolbar-meta ui-toolbar-meta--alone"
              >สรุปแยกตามสาขา</span
            >
          </div>
          <div class="ui-table-wrap">
            <table class="ui-table ui-table--fit">
              <thead>
                <tr>
                  <th>สาขา</th>
                  <th>บิล</th>
                  <th>ยอดขาย</th>
                  <th>เฉลี่ย/บิล</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in orderedByBranch" :key="row.branchId">
                  <td>{{ branchLabel(row) }}</td>
                  <td>{{ row.billCount }}</td>
                  <td>{{ baht(row.grossTotal) }}</td>
                  <td>
                    {{
                      baht(
                        row.avgBill ??
                          (row.billCount ? row.grossTotal / row.billCount : 0),
                      )
                    }}
                  </td>
                </tr>
              </tbody>
              <tfoot>
                <tr>
                  <th>รวม</th>
                  <th>{{ report.summary.billCount }}</th>
                  <th>{{ baht(report.summary.grossTotal) }}</th>
                  <th>{{ baht(report.summary.avgBill) }}</th>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        <div class="ui-card" style="margin-top: 0.75rem">
          <div class="ui-card__toolbar">
            <span class="ui-toolbar-meta ui-toolbar-meta--alone"
              >ยอดแยกตามช่องทางชำระ</span
            >
          </div>
          <div v-if="!report.byPayment.length" class="ui-empty">
            ไม่มีข้อมูลการชำระ
          </div>
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
      </template>
  </div>
</template>

<style scoped>
.ui-rpt__nav {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  margin-bottom: 0.85rem;
}

.ui-rpt__levels {
  display: inline-flex;
  gap: 0.25rem;
  padding: 0.2rem;
  border-radius: 0.65rem;
  background: #f5f5f4;
}

.ui-rpt__level {
  border: 0;
  background: transparent;
  padding: 0.4rem 0.85rem;
  border-radius: 0.5rem;
  font: inherit;
  font-weight: 600;
  color: #78716c;
  cursor: pointer;
}

.ui-rpt__level.is-active {
  background: #fff;
  color: #1c1917;
  box-shadow: 0 1px 2px rgb(0 0 0 / 8%);
}

.ui-rpt__crumb {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  font-variant-numeric: tabular-nums;
  color: #78716c;
}

.ui-rpt__crumb-link {
  border: 0;
  background: transparent;
  padding: 0;
  font: inherit;
  font-weight: 650;
  color: #1d4ed8;
  cursor: pointer;
}

.ui-rpt__crumb-sep {
  opacity: 0.5;
}

.ui-rpt__crumb-now {
  font-weight: 700;
  color: #1c1917;
}

.ui-rpt__pickers {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem 1rem;
}

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

.ui-rpt__stat-sub {
  font-size: 0.75rem;
  color: var(--ui-muted, #78716c);
}

.ui-rpt__stat--total {
  padding-left: 0.75rem;
  border-left: 1px solid #e7e5e4;
}

.ui-rpt__pay-summary {
  margin-top: 0.55rem;
  padding: 0.65rem 1rem 0.75rem;
  border: 1px solid #e7e5e4;
  border-radius: 0.65rem;
  background: #fafaf9;
}

.ui-rpt__pay-table-wrap {
  overflow-x: auto;
}

.ui-rpt__pay-table {
  width: auto;
  min-width: 16rem;
  border-collapse: collapse;
  font-size: 0.9rem;
  font-variant-numeric: tabular-nums;
}

.ui-rpt__pay-table th,
.ui-rpt__pay-table td {
  padding: 0.28rem 0.85rem 0.28rem 0;
  text-align: left;
  white-space: nowrap;
}

.ui-rpt__pay-table th {
  font-size: 0.72rem;
  font-weight: 600;
  color: #78716c;
}

.ui-rpt__pay-table .ui-rpt__num {
  text-align: right;
  padding-left: 1.25rem;
  padding-right: 0;
}

.ui-rpt__pay-count-em {
  font-weight: 700;
}

.ui-rpt__pay-bank td {
  padding-top: 0.45rem;
  border-top: 1px solid #e7e5e4;
  font-weight: 600;
}

.ui-rpt__pay-pp {
  margin-top: 0.75rem;
  padding-top: 0.65rem;
  border-top: 1px dashed #e7e5e4;
}

.ui-rpt__pay-pp-title {
  margin: 0 0 0.35rem;
  font-size: 0.8rem;
  font-weight: 600;
  color: #57534e;
}

.ui-rpt__pay-pp-title span {
  font-weight: 400;
  color: #a8a29e;
}

.ui-rpt__pay-hint {
  margin: 0.55rem 0 0;
  font-size: 0.8rem;
  color: #57534e;
  line-height: 1.45;
}

.ui-rpt__pay-hint.is-hit {
  color: #9a3412;
  font-weight: 600;
}

.ui-rpt__pay-hint-sub {
  display: inline;
  font-weight: 400;
  color: #a8a29e;
}

.ui-rpt__search-actions {
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
}

.ui-rpt__subh {
  font-size: 0.72rem;
  font-weight: 600;
  color: #78716c;
}

.ui-rpt__bills-tabs {
  margin: 0 0 0.75rem;
  flex-wrap: wrap;
}

.ui-rpt__tab-count {
  margin-left: 0.35rem;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
  color: #a8a29e;
  font-size: 0.85em;
}

.ui-rpt__level.is-active .ui-rpt__tab-count {
  color: #78716c;
}

.ui-rpt__branch-block {
  margin-top: 0.75rem;
}

.ui-rpt__branch-block:first-of-type {
  margin-top: 0.25rem;
}

.ui-rpt__branch-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.4rem 0.15rem;
}

.ui-rpt__branch-head span {
  font-size: 0.85rem;
  color: var(--ui-muted, #6b7280);
  font-variant-numeric: tabular-nums;
}

.ui-rpt__grand {
  margin-top: 0.85rem;
  padding: 0.65rem 0.75rem;
  border-radius: 0.55rem;
  background: #f5f5f4;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.ui-rpt__loading {
  text-align: center;
  color: var(--ui-muted, #78716c);
  padding: 1.25rem 0.75rem !important;
}

.ui-rpt__series,
.ui-rpt__bills {
  margin-top: 1rem;
}

.ui-rpt__row-click {
  cursor: pointer;
}

.ui-rpt__row-click:hover {
  background: #f8fafc;
}

.ui-rpt__drill {
  text-align: right;
  color: #2563eb;
  font-weight: 650;
  white-space: nowrap;
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
}

.ui-rpt__table :deep(.ui-table__col-bill) {
  width: auto;
  min-width: 12rem;
  white-space: nowrap !important;
}

.ui-rpt__table :deep(.ui-rpt__col-branch) {
  width: 3.25rem;
  max-width: 4rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--ui-muted, #6b7280);
}

.ui-rpt__table :deep(.ui-rpt__col-time) {
  width: 3.6rem;
  white-space: nowrap !important;
}

.ui-rpt__time {
  font-variant-numeric: tabular-nums;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  color: var(--ui-muted, #4b5563);
  font-size: 0.82rem;
}

.ui-rpt__table :deep(.ui-rpt__col-pay) {
  min-width: 9rem;
  white-space: normal !important;
  line-height: 1.35;
  color: var(--ui-muted, #4b5563);
  font-size: 0.86rem;
}

.ui-rpt__muted {
  color: var(--ui-muted, #94a3b8);
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
