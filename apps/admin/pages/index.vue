<script setup lang="ts">
type BranchPoint = {
  branchId: string;
  branchName: string;
  billCount: number;
  grossTotal: number;
  avgGross?: number;
  dayCount?: number;
};

type DayPoint = {
  date: string;
  label: string;
  billCount: number;
  grossTotal: number;
  byBranch: BranchPoint[];
};

type PayPoint = {
  method: string;
  amount: number;
  count: number;
};

type WeekdayPoint = {
  weekday: number;
  label: string;
  name: string;
  dayCount: number;
  billCount: number;
  grossTotal: number;
  avgGross: number;
  byBranch?: BranchPoint[];
};

type Summary = {
  today: { billCount: number; grossTotal: number };
  yesterday?: { billCount: number; grossTotal: number };
  week?: { billCount: number; grossTotal: number };
  all: { billCount: number; grossTotal: number };
  productCount: number;
  memberCount: number;
  branches?: Array<{ id: string; name: string }>;
  last7Days?: DayPoint[];
  todayByBranch?: BranchPoint[];
  todayByPayment?: PayPoint[];
  byWeekday?: WeekdayPoint[];
  bestWeekday?: {
    label: string;
    name: string;
    avgGross: number;
    dayCount: number;
    byBranch?: BranchPoint[];
  } | null;
  weekdayRangeDays?: number;
  yearCompare?: {
    thisYear: number;
    prevYear: number;
    byMonth: Array<{
      month: number;
      label: string;
      thisYear: {
        year: number;
        billCount: number;
        grossTotal: number;
        byBranch?: BranchPoint[];
      };
      prevYear: {
        year: number;
        billCount: number;
        grossTotal: number;
        byBranch?: BranchPoint[];
      };
      deltaPct: number | null;
    }>;
    bestMonthThisYear: {
      month: number;
      label: string;
      grossTotal: number;
    } | null;
    ytd: {
      thisYear: number;
      prevYear: number;
      deltaPct: number | null;
    };
  };
  byYear?: Array<{
    year: number;
    billCount: number;
    grossTotal: number;
    byBranch?: BranchPoint[];
  }>;
  bestYear?: {
    year: number;
    grossTotal: number;
    billCount: number;
  } | null;
  freshTop?: {
    today: FreshPack;
    week: FreshPack;
  };
};

type FreshRow = {
  code: string;
  name: string;
  unit: "กก." | "ชิ้น";
  qty: number;
  amount: number;
};

type FreshPack = {
  kg: FreshRow[];
  piece: FreshRow[];
  missingPriceCount: number;
  missingPriceAmount: number;
};

const PAY_LABELS: Record<string, string> = {
  cash: "เงินสด",
  transfer: "เงินโอน",
  government: "สวัสดิการ",
};

const BRANCH_COLORS = ["#0f766e", "#c2410c", "#0369a1", "#7c3aed", "#a16207"];
const PAY_COLORS: Record<string, string> = {
  cash: "#0f766e",
  transfer: "#0369a1",
  government: "#a16207",
};

const { get } = useAdminApi();
const pending = ref(false);
const error = ref("");
const summary = ref<Summary | null>(null);
const freshRange = ref<"today" | "week">("today");

const freshPack = computed(() => {
  const top = summary.value?.freshTop;
  if (!top) return null;
  return freshRange.value === "week" ? top.week : top.today;
});

const freshKgMax = computed(() =>
  Math.max(1, ...(freshPack.value?.kg ?? []).map((r) => r.qty)),
);

function freshQty(row: FreshRow) {
  if (row.unit === "ชิ้น") {
    return `${row.qty.toLocaleString("th-TH", { maximumFractionDigits: 0 })} ชิ้น`;
  }
  return `${row.qty.toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} กก.`;
}

function baht(n: number) {
  return n.toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** หน่วยเดียวกันทั้งชุด — ไม่ผสม พัน/ล้าน จนอ่านงง */
function bahtChart(n: number, seriesMax = 0) {
  const scale = Math.max(Math.abs(n), Math.abs(seriesMax), 1);
  if (scale >= 100_000) {
    return `${(n / 1_000_000).toLocaleString("th-TH", {
      maximumFractionDigits: 1,
      minimumFractionDigits: 1,
    })} ล้าน`;
  }
  if (scale >= 1_000) {
    return `${(n / 1_000).toLocaleString("th-TH", {
      maximumFractionDigits: 0,
    })} พัน`;
  }
  return n.toLocaleString("th-TH", { maximumFractionDigits: 0 });
}

function bahtShort(n: number) {
  return bahtChart(n, n);
}

function pctDelta(today: number, yesterday: number) {
  if (!yesterday) {
    return today > 0 ? 100 : 0;
  }
  return Math.round(((today - yesterday) / yesterday) * 1000) / 10;
}

function branchColor(index: number) {
  return BRANCH_COLORS[index % BRANCH_COLORS.length]!;
}

function branchColorById(branchId: string) {
  const i = branchLegend.value.findIndex((b) => b.id === branchId);
  return branchColor(Math.max(0, i));
}

function payLabel(method: string) {
  return PAY_LABELS[method] ?? method;
}

function payColor(method: string, index: number) {
  return PAY_COLORS[method] ?? BRANCH_COLORS[index % BRANCH_COLORS.length]!;
}

function rankBranchRows(
  rows: BranchPoint[] | undefined,
  key: "grossTotal" | "avgGross" = "grossTotal",
) {
  return [...(rows ?? [])]
    .filter((b) => (b[key] ?? 0) > 0 || b.billCount > 0)
    .sort((a, b) => (b[key] ?? 0) - (a[key] ?? 0));
}

const vsYesterday = computed(() => {
  const s = summary.value;
  if (!s?.yesterday) return null;
  const delta = pctDelta(s.today.grossTotal, s.yesterday.grossTotal);
  return {
    delta,
    tone: delta > 0 ? "up" : delta < 0 ? "down" : "flat",
    label:
      delta > 0
        ? `↑ ${delta}% จากเมื่อวาน`
        : delta < 0
          ? `↓ ${Math.abs(delta)}% จากเมื่อวาน`
          : "เท่าเมื่อวาน",
  };
});

const weekMax = computed(() => {
  const days = summary.value?.last7Days ?? [];
  return Math.max(1, ...days.map((d) => d.grossTotal));
});

const branchLegend = computed(() => summary.value?.branches ?? []);

const todayBranchMax = computed(() => {
  const rows = summary.value?.todayByBranch ?? [];
  return Math.max(1, ...rows.map((r) => r.grossTotal));
});

const payTotal = computed(() =>
  (summary.value?.todayByPayment ?? []).reduce((s, p) => s + p.amount, 0),
);

const weekdayMax = computed(() => {
  const rows = summary.value?.byWeekday ?? [];
  return Math.max(1, ...rows.map((r) => r.avgGross));
});

const selectedWeekday = ref<number | null>(null);
const selectedDayDate = ref<string | null>(null);
const selectedMonth = ref<number | null>(null);
const selectedYear = ref<number | null>(null);

const monthsCompareVisible = computed(() => {
  const yc = summary.value?.yearCompare;
  if (!yc?.byMonth?.length) return [];
  const currentMonth =
    new Date(
      new Date().toLocaleString("en-US", { timeZone: "Asia/Bangkok" }),
    ).getMonth() + 1;
  return yc.byMonth.filter((m) => m.month <= currentMonth);
});

const monthCompareMax = computed(() => {
  const rows = monthsCompareVisible.value;
  let max = 1;
  for (const m of rows) {
    max = Math.max(max, m.thisYear.grossTotal, m.prevYear.grossTotal);
  }
  return max;
});

const yearsDesc = computed(() =>
  [...(summary.value?.byYear ?? [])].sort((a, b) => b.year - a.year),
);

const yearsAsc = computed(() =>
  [...(summary.value?.byYear ?? [])].sort((a, b) => a.year - b.year),
);

/** กราฟเส้นรายปี (เรียงปีเก่า→ใหม่) */
const yearLine = computed(() => {
  const rows = yearsAsc.value;
  if (!rows.length) return null;
  const W = 680;
  const H = 240;
  const padL = 56;
  const padR = 28;
  const padT = 36;
  const padB = 40;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const max = Math.max(1, ...rows.map((r) => r.grossTotal));
  const n = rows.length;
  const points = rows.map((y, i) => {
    const x = padL + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);
    const cy = padT + plotH - (y.grossTotal / max) * plotH;
    return {
      year: y.year,
      grossTotal: y.grossTotal,
      billCount: y.billCount,
      x,
      y: cy,
    };
  });
  const linePath = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
    .join(" ");
  const areaPath =
    points.length > 0
      ? `${linePath} L${points[points.length - 1]!.x.toFixed(1)},${(padT + plotH).toFixed(1)} L${points[0]!.x.toFixed(1)},${(padT + plotH).toFixed(1)} Z`
      : "";
  const ticks = [0, 0.5, 1].map((t) => ({
    value: max * t,
    y: padT + plotH * (1 - t),
  }));
  return { W, H, padL, padT, plotH, max, points, linePath, areaPath, ticks };
});

const weekdayDetail = computed(() => {
  const rows = summary.value?.byWeekday ?? [];
  if (!rows.length) return null;
  const picked =
    (selectedWeekday.value != null
      ? rows.find((d) => d.weekday === selectedWeekday.value)
      : null) ??
    rows.find((d) => d.name === summary.value?.bestWeekday?.name) ??
    rows.find((d) => d.dayCount > 0) ??
    rows[0];
  if (!picked) return null;
  const branches = rankBranchRows(picked.byBranch, "avgGross");
  const max = Math.max(1, ...branches.map((b) => b.avgGross ?? 0));
  return { day: picked, branches, max };
});

const weekDayDetail = computed(() => {
  const rows = summary.value?.last7Days ?? [];
  if (!rows.length) return null;
  const withSales = [...rows].filter((d) => d.grossTotal > 0);
  const picked =
    (selectedDayDate.value
      ? rows.find((d) => d.date === selectedDayDate.value)
      : null) ??
    withSales[withSales.length - 1] ??
    rows[rows.length - 1];
  if (!picked) return null;
  const branches = rankBranchRows(picked.byBranch, "grossTotal");
  const max = Math.max(1, ...branches.map((b) => b.grossTotal));
  return { day: picked, branches, max };
});

const monthDetail = computed(() => {
  const rows = monthsCompareVisible.value;
  if (!rows.length) return null;
  const best = summary.value?.yearCompare?.bestMonthThisYear?.month;
  const picked =
    (selectedMonth.value != null
      ? rows.find((m) => m.month === selectedMonth.value)
      : null) ??
    rows.find((m) => m.month === best) ??
    [...rows].reverse().find((m) => m.thisYear.grossTotal > 0) ??
    rows[rows.length - 1];
  if (!picked) return null;
  const thisMap = new Map(
    (picked.thisYear.byBranch ?? []).map((b) => [b.branchId, b]),
  );
  const prevMap = new Map(
    (picked.prevYear.byBranch ?? []).map((b) => [b.branchId, b]),
  );
  const ids = new Set([...thisMap.keys(), ...prevMap.keys()]);
  const branches = [...ids]
    .map((id) => {
      const cur = thisMap.get(id);
      const prev = prevMap.get(id);
      const name =
        cur?.branchName ??
        prev?.branchName ??
        branchLegend.value.find((b) => b.id === id)?.name ??
        id;
      const thisGross = cur?.grossTotal ?? 0;
      const prevGross = prev?.grossTotal ?? 0;
      let deltaPct: number | null = null;
      if (prevGross > 0) {
        deltaPct =
          Math.round(((thisGross - prevGross) / prevGross) * 1000) / 10;
      } else if (thisGross > 0) {
        deltaPct = 100;
      }
      return {
        branchId: id,
        branchName: name,
        thisGross,
        prevGross,
        thisBills: cur?.billCount ?? 0,
        prevBills: prev?.billCount ?? 0,
        deltaPct,
      };
    })
    .filter((b) => b.thisGross > 0 || b.prevGross > 0)
    .sort((a, b) => b.thisGross - a.thisGross || b.prevGross - a.prevGross);
  const max = Math.max(
    1,
    ...branches.flatMap((b) => [b.thisGross, b.prevGross]),
  );
  return { month: picked, branches, max };
});

const yearDetail = computed(() => {
  const rows = yearsDesc.value;
  if (!rows.length) return null;
  const picked =
    (selectedYear.value != null
      ? rows.find((y) => y.year === selectedYear.value)
      : null) ??
    rows.find((y) => y.year === summary.value?.bestYear?.year) ??
    rows[0];
  if (!picked) return null;
  const branches = rankBranchRows(picked.byBranch, "grossTotal");
  const max = Math.max(1, ...branches.map((b) => b.grossTotal));
  return { year: picked, branches, max };
});

const ytdDelta = computed(() => {
  const d = summary.value?.yearCompare?.ytd?.deltaPct;
  if (d == null) return null;
  return {
    delta: d,
    tone: d > 0 ? "up" : d < 0 ? "down" : "flat",
    label:
      d > 0
        ? `↑ ${d}% YoY`
        : d < 0
          ? `↓ ${Math.abs(d)}% YoY`
          : "เท่าปีก่อน (YTD)",
  };
});

const todayWeekdayIndex = computed(() => {
  const iso = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const sun0 = new Date(`${iso}T12:00:00.000+07:00`).getUTCDay();
  return sun0 === 0 ? 6 : sun0 - 1;
});

const donutSlices = computed(() => {
  const rows = summary.value?.todayByPayment ?? [];
  const total = payTotal.value || 1;
  const r = 42;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return rows.map((row, i) => {
    const pct = row.amount / total;
    const len = pct * c;
    const slice = {
      method: row.method,
      amount: row.amount,
      count: row.count,
      pct: Math.round(pct * 1000) / 10,
      color: payColor(row.method, i),
      dash: `${len} ${c - len}`,
      offset: -offset,
    };
    offset += len;
    return slice;
  });
});

async function load() {
  pending.value = true;
  error.value = "";
  try {
    summary.value = await get<Summary>("/sales/summary");
  } catch (e) {
    error.value =
      e instanceof Error
        ? e.message
        : "โหลดแดชบอร์ดไม่สำเร็จ — ตรวจว่า API รันอยู่";
  } finally {
    pending.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div class="ui-dash ui-dash--charts">
    <div class="ui-page-head">
      <div>
        <h1 class="ui-page-title">แดชบอร์ด</h1>
        <p class="ui-page-sub">
          วันนี้ → 7 วัน → เดือน → ปี
        </p>
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
        <NuxtLink to="/reports" class="ui-btn ui-btn--ghost"
          >สรุปยอดขาย</NuxtLink
        >
      </div>
    </div>

    <div v-if="error" class="ui-empty">{{ error }}</div>
    <template v-else-if="summary">
      <div class="ui-dash__kpi-strip">
        <div class="ui-dash__kpi">
          <p class="ui-dash__kpi-label">ยอดขายวันนี้</p>
          <p class="ui-dash__kpi-value">{{ baht(summary.today.grossTotal) }}</p>
          <p class="ui-dash__kpi-hint">
            {{ summary.today.billCount.toLocaleString("th-TH") }} บิล
          </p>
          <p
            v-if="vsYesterday"
            class="ui-dash__kpi-delta"
            :class="`is-${vsYesterday.tone}`"
          >
            {{ vsYesterday.label }}
          </p>
        </div>
        <div class="ui-dash__kpi">
          <p class="ui-dash__kpi-label">เมื่อวาน</p>
          <p class="ui-dash__kpi-value">
            {{ baht(summary.yesterday?.grossTotal ?? 0) }}
          </p>
          <p class="ui-dash__kpi-hint">
            {{ (summary.yesterday?.billCount ?? 0).toLocaleString("th-TH") }}
            บิล
          </p>
        </div>
        <div class="ui-dash__kpi">
          <p class="ui-dash__kpi-label">7 วันล่าสุด</p>
          <p class="ui-dash__kpi-value">
            {{ baht(summary.week?.grossTotal ?? 0) }}
          </p>
          <p class="ui-dash__kpi-hint">
            {{ (summary.week?.billCount ?? 0).toLocaleString("th-TH") }} บิล
          </p>
        </div>
        <div class="ui-dash__kpi">
          <p class="ui-dash__kpi-label">YTD ปีนี้</p>
          <p class="ui-dash__kpi-value">
            {{ baht(summary.yearCompare?.ytd.thisYear ?? 0) }}
          </p>
          <p class="ui-dash__kpi-hint">
            <template v-if="ytdDelta">{{ ytdDelta.label }}</template>
            <template v-else>เทียบปีก่อนถึงเดือนนี้</template>
          </p>
        </div>
        <div class="ui-dash__kpi">
          <p class="ui-dash__kpi-label">ยอดรวมทั้งหมด</p>
          <p class="ui-dash__kpi-value">
            {{ baht(summary.all.grossTotal) }}
          </p>
          <p class="ui-dash__kpi-hint">
            {{ summary.all.billCount.toLocaleString("th-TH") }} บิล
          </p>
        </div>
      </div>

      <div class="ui-dash__grid" style="margin-top: 1.15rem">
        <!-- 1) วันนี้ -->
        <div class="ui-dash__panel ui-card">
          <div class="ui-card__toolbar">
            <span class="ui-toolbar-meta ui-toolbar-meta--alone"
              >วันนี้ · แยกสาขา</span
            >
          </div>
          <div
            v-if="!(summary.todayByBranch?.length)"
            class="ui-empty"
            style="margin: 1rem"
          >
            ยังไม่มีบิลวันนี้
          </div>
          <div v-else class="ui-dash-hbar ui-dash-hbar--ranked">
            <div
              v-for="(row, i) in summary.todayByBranch"
              :key="row.branchId"
              class="ui-dash-hbar__row"
            >
              <span class="ui-dash-hbar__rank">{{ i + 1 }}</span>
              <div class="ui-dash-hbar__body">
                <div class="ui-dash-hbar__head">
                  <span class="ui-dash-hbar__label">{{
                    row.branchName
                  }}</span>
                  <strong>{{ baht(row.grossTotal) }}</strong>
                </div>
                <div class="ui-dash-hbar__track">
                  <div
                    class="ui-dash-hbar__fill"
                    :style="{
                      width: `${(row.grossTotal / todayBranchMax) * 100}%`,
                      background: branchColor(i),
                    }"
                  />
                </div>
                <p class="ui-dash-hbar__meta">
                  {{ row.billCount.toLocaleString("th-TH") }} บิล
                </p>
              </div>
            </div>
          </div>
        </div>

        <div class="ui-dash__panel ui-card">
          <div class="ui-card__toolbar">
            <span class="ui-toolbar-meta ui-toolbar-meta--alone"
              >วันนี้ · ช่องทางชำระ</span
            >
          </div>
          <div
            v-if="!(summary.todayByPayment?.length)"
            class="ui-empty"
            style="margin: 1rem"
          >
            ยังไม่มียอดชำระวันนี้
          </div>
          <div v-else class="ui-dash-split">
            <div class="ui-dash-donut">
              <svg
                class="ui-dash-donut__svg"
                viewBox="0 0 100 100"
                aria-hidden="true"
              >
                <circle
                  class="ui-dash-donut__track"
                  cx="50"
                  cy="50"
                  r="42"
                  fill="none"
                  stroke-width="12"
                />
                <circle
                  v-for="slice in donutSlices"
                  :key="slice.method"
                  cx="50"
                  cy="50"
                  r="42"
                  fill="none"
                  stroke-width="12"
                  :stroke="slice.color"
                  :stroke-dasharray="slice.dash"
                  :stroke-dashoffset="slice.offset"
                  stroke-linecap="butt"
                  transform="rotate(-90 50 50)"
                />
              </svg>
              <div class="ui-dash-donut__center">
                <strong>{{ bahtShort(payTotal) }}</strong>
                <span>บาท</span>
              </div>
            </div>
            <ul class="ui-dash-legend">
              <li v-for="slice in donutSlices" :key="slice.method">
                <span
                  class="ui-dash-legend__dot"
                  :style="{ background: slice.color }"
                />
                <span class="ui-dash-legend__label">{{
                  payLabel(slice.method)
                }}</span>
                <strong>{{ baht(slice.amount) }}</strong>
                <span class="ui-dash-legend__pct">{{ slice.pct }}%</span>
              </li>
            </ul>
          </div>
        </div>

        <div class="ui-dash__panel ui-card ui-dash__panel--wide">
          <div class="ui-card__toolbar">
            <span class="ui-toolbar-meta ui-toolbar-meta--alone">
              ของสดขายดี · ไม่รวม 900011 / 900017
            </span>
            <div class="ui-dash__seg">
              <button
                type="button"
                class="ui-dash__seg-btn"
                :class="{ 'is-on': freshRange === 'today' }"
                @click="freshRange = 'today'"
              >
                วันนี้
              </button>
              <button
                type="button"
                class="ui-dash__seg-btn"
                :class="{ 'is-on': freshRange === 'week' }"
                @click="freshRange = 'week'"
              >
                7 วัน
              </button>
            </div>
          </div>
          <p class="ui-dash__panel-sub">
            กิโลคำนวณจากยอดในบิล ÷ ราคาขายต่อกิโลตอนนั้น · 900059 นับเป็นชิ้น
          </p>
          <div
            v-if="!freshPack || (!freshPack.kg.length && !freshPack.piece.length)"
            class="ui-empty"
            style="margin: 1rem"
          >
            ยังไม่มีของสดในช่วงนี้
          </div>
          <div v-else class="ui-dash-fresh">
            <div v-if="freshPack.kg.length" class="ui-dash-hbar ui-dash-hbar--ranked">
              <div
                v-for="(row, i) in freshPack.kg"
                :key="row.code"
                class="ui-dash-hbar__row"
              >
                <span class="ui-dash-hbar__rank">{{ i + 1 }}</span>
                <div class="ui-dash-hbar__body">
                  <div class="ui-dash-hbar__head">
                    <span class="ui-dash-hbar__label">{{ row.name }}</span>
                    <strong>{{ freshQty(row) }}</strong>
                  </div>
                  <div class="ui-dash-hbar__track">
                    <div
                      class="ui-dash-hbar__fill"
                      :style="{
                        width: `${(row.qty / freshKgMax) * 100}%`,
                        background: '#0f766e',
                      }"
                    />
                  </div>
                  <p class="ui-dash-hbar__meta">
                    {{ row.code }} · {{ baht(row.amount) }} บาท
                  </p>
                </div>
              </div>
            </div>
            <div v-if="freshPack.piece.length" class="ui-dash-fresh__piece">
              <p class="ui-dash-hbar__meta">ขายเป็นชิ้น</p>
              <div
                v-for="row in freshPack.piece"
                :key="row.code"
                class="ui-dash-hbar__head"
              >
                <span>{{ row.name }}</span>
                <strong>{{ freshQty(row) }} · {{ baht(row.amount) }}</strong>
              </div>
            </div>
            <p
              v-if="freshPack.missingPriceCount > 0"
              class="ui-dash-fresh__missing"
            >
              {{ freshPack.missingPriceCount }} รายการยังไม่มีราคาต่อกิโลในบิล
              ({{ baht(freshPack.missingPriceAmount) }} บาท) — คิดกิโลไม่ได้
            </p>
          </div>
        </div>

        <!-- 2) 7 วัน -->
        <div class="ui-dash__panel ui-card">
          <div class="ui-card__toolbar">
            <span class="ui-toolbar-meta ui-toolbar-meta--alone"
              >7 วันล่าสุด · แยกสาขา</span
            >
          </div>
          <p class="ui-dash__panel-sub">
            แต่ละแท่ง = รวมวันนั้น · สี = สาขา · กดแท่งเพื่อดูรายละเอียด
          </p>
          <div
            v-if="!(summary.last7Days?.length)"
            class="ui-empty"
            style="margin: 1rem"
          >
            ยังไม่มีข้อมูล 7 วัน
          </div>
          <template v-else>
            <div class="ui-dash-bars ui-dash-bars--hero">
              <button
                v-for="day in summary.last7Days"
                :key="day.date"
                type="button"
                class="ui-dash-bars__col ui-dash-bars__col--btn"
                :class="{
                  'is-empty': day.grossTotal <= 0,
                  'is-selected':
                    weekDayDetail && day.date === weekDayDetail.day.date,
                }"
                @click="selectedDayDate = day.date"
              >
                <span class="ui-dash-bars__value">{{
                  day.grossTotal > 0
                    ? bahtChart(day.grossTotal, weekMax)
                    : "—"
                }}</span>
                <div class="ui-dash-bars__track ui-dash-bars__track--stack">
                  <div
                    v-for="(br, bi) in day.byBranch"
                    :key="br.branchId"
                    class="ui-dash-bars__fill"
                    :style="{
                      height: `${Math.max(
                        0,
                        (br.grossTotal / weekMax) * 100,
                      )}%`,
                      background: branchColor(bi),
                      borderRadius: 0,
                    }"
                    :title="`${br.branchName}: ${baht(br.grossTotal)}`"
                  />
                </div>
                <span class="ui-dash-bars__label">{{ day.label }}</span>
              </button>
            </div>
            <ul class="ui-dash-legend">
              <li v-for="(b, i) in branchLegend" :key="b.id">
                <span
                  class="ui-dash-legend__dot"
                  :style="{ background: branchColor(i) }"
                />
                <span class="ui-dash-legend__label">{{ b.name }}</span>
              </li>
            </ul>
            <div v-if="weekDayDetail" class="ui-dash-chart-detail">
              <p class="ui-dash-chart-detail__title">
                วันที่ {{ weekDayDetail.day.label }} · รวม
                {{ baht(weekDayDetail.day.grossTotal) }}
                <span
                  >·
                  {{
                    weekDayDetail.day.billCount.toLocaleString("th-TH")
                  }}
                  บิล</span
                >
              </p>
              <div
                v-if="!weekDayDetail.branches.length"
                class="ui-dash-chart-detail__empty"
              >
                ไม่มียอดแยกสาขา
              </div>
              <div v-else class="ui-dash-hbar ui-dash-hbar--ranked">
                <div
                  v-for="(row, i) in weekDayDetail.branches"
                  :key="row.branchId"
                  class="ui-dash-hbar__row"
                >
                  <span class="ui-dash-hbar__rank">{{ i + 1 }}</span>
                  <div class="ui-dash-hbar__body">
                    <div class="ui-dash-hbar__head">
                      <span class="ui-dash-hbar__label">{{
                        row.branchName
                      }}</span>
                      <strong>{{ baht(row.grossTotal) }}</strong>
                    </div>
                    <div class="ui-dash-hbar__track">
                      <div
                        class="ui-dash-hbar__fill"
                        :style="{
                          width: `${(row.grossTotal / weekDayDetail.max) * 100}%`,
                          background: branchColorById(row.branchId),
                        }"
                      />
                    </div>
                    <p class="ui-dash-hbar__meta">
                      {{ row.billCount.toLocaleString("th-TH") }} บิล
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </template>
        </div>

        <!-- 3) วันในสัปดาห์ -->
        <div class="ui-dash__panel ui-card">
          <div class="ui-card__toolbar">
            <span class="ui-toolbar-meta ui-toolbar-meta--alone"
              >วันไหนขายดี · จ–อา</span
            >
          </div>
          <p class="ui-dash__panel-sub">
            ยอดเฉลี่ยต่อวัน จาก {{ summary.weekdayRangeDays ?? 56 }} วันล่าสุด ·
            สี = สาขา · กดแท่งเพื่อดูแยกสาขา
            <template v-if="summary.bestWeekday">
              · ดีสุดวัน{{ summary.bestWeekday.name }}
            </template>
          </p>
          <div
            v-if="!(summary.byWeekday?.some((d) => d.dayCount > 0))"
            class="ui-empty"
            style="margin: 1rem"
          >
            ยังไม่มีข้อมูลพอสำหรับสถิติวัน
          </div>
          <template v-else>
            <div
              class="ui-dash-bars ui-dash-bars--hero ui-dash-bars--weekday"
            >
              <button
                v-for="day in summary.byWeekday"
                :key="day.weekday"
                type="button"
                class="ui-dash-bars__col ui-dash-bars__col--btn"
                :class="{
                  'is-today': day.weekday === todayWeekdayIndex,
                  'is-selected':
                    weekdayDetail && day.weekday === weekdayDetail.day.weekday,
                }"
                @click="selectedWeekday = day.weekday"
              >
                <span class="ui-dash-bars__value">{{
                  bahtChart(day.avgGross, weekdayMax)
                }}</span>
                <div class="ui-dash-bars__track ui-dash-bars__track--stack">
                  <div
                    v-for="(br, bi) in day.byBranch ?? []"
                    :key="br.branchId"
                    class="ui-dash-bars__fill"
                    :style="{
                      height: `${Math.max(
                        0,
                        ((br.avgGross ?? 0) / weekdayMax) * 100,
                      )}%`,
                      background: branchColor(bi),
                      borderRadius: 0,
                    }"
                    :title="`${day.name} · ${br.branchName}: เฉลี่ย ${baht(br.avgGross ?? 0)}`"
                  />
                </div>
                <span class="ui-dash-bars__label">{{ day.label }}</span>
              </button>
            </div>
            <ul class="ui-dash-legend">
              <li v-for="(b, i) in branchLegend" :key="b.id">
                <span
                  class="ui-dash-legend__dot"
                  :style="{ background: branchColor(i) }"
                />
                <span class="ui-dash-legend__label">{{ b.name }}</span>
              </li>
            </ul>
            <div v-if="weekdayDetail" class="ui-dash-chart-detail">
              <p class="ui-dash-chart-detail__title">
                วัน{{ weekdayDetail.day.name }} · เฉลี่ยรวม
                {{ baht(weekdayDetail.day.avgGross) }}
                <span
                  >· จาก {{ weekdayDetail.day.dayCount }} วัน ·
                  {{ weekdayDetail.day.billCount.toLocaleString("th-TH") }}
                  บิล</span
                >
              </p>
              <div
                v-if="!weekdayDetail.branches.length"
                class="ui-dash-chart-detail__empty"
              >
                ไม่มียอดแยกสาขา
              </div>
              <div v-else class="ui-dash-hbar ui-dash-hbar--ranked">
                <div
                  v-for="(row, i) in weekdayDetail.branches"
                  :key="row.branchId"
                  class="ui-dash-hbar__row"
                >
                  <span class="ui-dash-hbar__rank">{{ i + 1 }}</span>
                  <div class="ui-dash-hbar__body">
                    <div class="ui-dash-hbar__head">
                      <span class="ui-dash-hbar__label">{{
                        row.branchName
                      }}</span>
                      <strong>{{ baht(row.avgGross ?? 0) }}</strong>
                    </div>
                    <div class="ui-dash-hbar__track">
                      <div
                        class="ui-dash-hbar__fill"
                        :style="{
                          width: `${((row.avgGross ?? 0) / weekdayDetail.max) * 100}%`,
                          background: branchColorById(row.branchId),
                        }"
                      />
                    </div>
                    <p class="ui-dash-hbar__meta">
                      รวม {{ baht(row.grossTotal) }} ·
                      {{ row.billCount.toLocaleString("th-TH") }} บิล
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </template>
        </div>

        <!-- 4) รายเดือน -->
        <div
          v-if="summary.yearCompare"
          class="ui-dash__panel ui-card ui-dash__panel--months"
        >
          <div class="ui-card__toolbar">
            <span class="ui-toolbar-meta ui-toolbar-meta--alone"
              >รายเดือน · ปี {{ summary.yearCompare.thisYear }} เทียบ
              {{ summary.yearCompare.prevYear }}</span
            >
          </div>
          <p class="ui-dash__panel-sub">
            YTD ปีนี้ {{ baht(summary.yearCompare.ytd.thisYear) }} · ปีก่อน
            {{ baht(summary.yearCompare.ytd.prevYear) }}
            <template v-if="ytdDelta"> · {{ ytdDelta.label }}</template>
            · กดเดือนเพื่อดูแยกสาขา
          </p>
          <div class="ui-dash-bars ui-dash-bars--hero ui-dash-bars--months">
            <button
              v-for="m in monthsCompareVisible"
              :key="m.month"
              type="button"
              class="ui-dash-bars__col ui-dash-bars__col--btn"
              :class="{
                'is-selected':
                  monthDetail && m.month === monthDetail.month.month,
              }"
              @click="selectedMonth = m.month"
            >
              <span class="ui-dash-bars__value">{{
                m.thisYear.grossTotal > 0
                  ? bahtChart(m.thisYear.grossTotal, monthCompareMax)
                  : "—"
              }}</span>
              <div class="ui-dash-bars__track ui-dash-bars__track--pair">
                <div
                  class="ui-dash-bars__fill ui-dash-bars__fill--prev"
                  :style="{
                    height: `${Math.max(
                      0,
                      (m.prevYear.grossTotal / monthCompareMax) * 100,
                    )}%`,
                  }"
                  :title="`${m.label} ${summary.yearCompare.prevYear}: ${baht(m.prevYear.grossTotal)}`"
                />
                <div
                  class="ui-dash-bars__fill ui-dash-bars__fill--this"
                  :style="{
                    height: `${Math.max(
                      0,
                      (m.thisYear.grossTotal / monthCompareMax) * 100,
                    )}%`,
                  }"
                  :title="`${m.label} ${summary.yearCompare.thisYear}: ${baht(m.thisYear.grossTotal)}`"
                />
              </div>
              <span class="ui-dash-bars__label">{{ m.label }}</span>
              <span
                v-if="m.deltaPct != null && m.thisYear.grossTotal > 0"
                class="ui-dash-bars__delta"
                :class="{
                  'is-up': m.deltaPct > 0,
                  'is-down': m.deltaPct < 0,
                }"
                >{{ m.deltaPct > 0 ? "+" : "" }}{{ m.deltaPct }}%</span
              >
            </button>
          </div>
          <ul class="ui-dash-legend">
            <li>
              <span
                class="ui-dash-legend__dot"
                style="background: #94a3b8"
              />
              <span class="ui-dash-legend__label"
                >ปี {{ summary.yearCompare.prevYear }} (เทา)</span
              >
            </li>
            <li>
              <span
                class="ui-dash-legend__dot"
                style="background: #0f766e"
              />
              <span class="ui-dash-legend__label"
                >ปี {{ summary.yearCompare.thisYear }} (เขียว) · ตัวเลขบนแท่ง =
                ปีนี้</span
              >
            </li>
          </ul>
          <div v-if="monthDetail" class="ui-dash-chart-detail">
            <p class="ui-dash-chart-detail__title">
              {{ monthDetail.month.label }} · ปีนี้
              {{ baht(monthDetail.month.thisYear.grossTotal) }} · ปีก่อน
              {{ baht(monthDetail.month.prevYear.grossTotal) }}
              <span v-if="monthDetail.month.deltaPct != null">
                ·
                {{ monthDetail.month.deltaPct > 0 ? "+" : ""
                }}{{ monthDetail.month.deltaPct }}%</span
              >
            </p>
            <div
              v-if="!monthDetail.branches.length"
              class="ui-dash-chart-detail__empty"
            >
              ไม่มียอดแยกสาขา
            </div>
            <div v-else class="ui-dash-month-branches">
              <div
                v-for="(row, i) in monthDetail.branches"
                :key="row.branchId"
                class="ui-dash-month-branches__row"
              >
                <div class="ui-dash-month-branches__head">
                  <span class="ui-dash-hbar__rank">{{ i + 1 }}</span>
                  <strong>{{ row.branchName }}</strong>
                  <span
                    v-if="row.deltaPct != null && row.thisGross > 0"
                    class="ui-dash-bars__delta"
                    :class="{
                      'is-up': row.deltaPct > 0,
                      'is-down': row.deltaPct < 0,
                    }"
                    >{{ row.deltaPct > 0 ? "+" : "" }}{{ row.deltaPct }}%</span
                  >
                </div>
                <div class="ui-dash-month-branches__bars">
                  <div class="ui-dash-month-branches__line">
                    <span class="ui-dash-month-branches__yr"
                      >{{ summary.yearCompare.prevYear }}</span
                    >
                    <div class="ui-dash-hbar__track">
                      <div
                        class="ui-dash-hbar__fill"
                        :style="{
                          width: `${(row.prevGross / monthDetail.max) * 100}%`,
                          background: '#94a3b8',
                        }"
                      />
                    </div>
                    <strong>{{ baht(row.prevGross) }}</strong>
                  </div>
                  <div class="ui-dash-month-branches__line">
                    <span class="ui-dash-month-branches__yr"
                      >{{ summary.yearCompare.thisYear }}</span
                    >
                    <div class="ui-dash-hbar__track">
                      <div
                        class="ui-dash-hbar__fill"
                        :style="{
                          width: `${(row.thisGross / monthDetail.max) * 100}%`,
                          background: branchColorById(row.branchId),
                        }"
                      />
                    </div>
                    <strong>{{ baht(row.thisGross) }}</strong>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- 5) รายปี -->
        <div
          v-if="yearLine"
          class="ui-dash__panel ui-card ui-dash__panel--years"
        >
          <div class="ui-card__toolbar">
            <span class="ui-toolbar-meta ui-toolbar-meta--alone"
              >ยอดขายรายปี</span
            >
          </div>
          <p class="ui-dash__panel-sub">
            กราฟเส้นตามปี (โซนเวลาไทย) · กดจุดเพื่อดูแยกสาขา
            <template v-if="summary.bestYear">
              · ปีที่ดีสุด {{ summary.bestYear.year }}
            </template>
          </p>
          <div class="ui-dash-line">
            <svg
              class="ui-dash-line__svg"
              :viewBox="`0 0 ${yearLine.W} ${yearLine.H}`"
              role="img"
              aria-label="ยอดขายรายปี"
            >
              <defs>
                <linearGradient
                  id="yearLineFill"
                  x1="0"
                  y1="0"
                  x2="0"
                  y2="1"
                >
                  <stop offset="0%" stop-color="#0f766e" stop-opacity="0.22" />
                  <stop offset="100%" stop-color="#0f766e" stop-opacity="0" />
                </linearGradient>
              </defs>
              <line
                v-for="(tick, i) in yearLine.ticks"
                :key="`g-${i}`"
                class="ui-dash-line__grid"
                :x1="yearLine.padL"
                :x2="yearLine.W - 28"
                :y1="tick.y"
                :y2="tick.y"
              />
              <text
                v-for="(tick, i) in yearLine.ticks"
                :key="`t-${i}`"
                class="ui-dash-line__tick"
                :x="yearLine.padL - 8"
                :y="tick.y + 4"
                text-anchor="end"
              >
                {{ bahtChart(tick.value, yearLine.max) }}
              </text>
              <path
                class="ui-dash-line__area"
                :d="yearLine.areaPath"
                fill="url(#yearLineFill)"
              />
              <path
                class="ui-dash-line__path"
                :d="yearLine.linePath"
                fill="none"
              />
              <g
                v-for="p in yearLine.points"
                :key="p.year"
                class="ui-dash-line__point"
                :class="{
                  'is-best':
                    summary.bestYear && p.year === summary.bestYear.year,
                  'is-current':
                    summary.yearCompare &&
                    p.year === summary.yearCompare.thisYear,
                  'is-selected':
                    yearDetail && p.year === yearDetail.year.year,
                }"
                role="button"
                tabindex="0"
                :aria-label="`ปี ${p.year} ${baht(p.grossTotal)}`"
                @click="selectedYear = p.year"
                @keydown.enter.prevent="selectedYear = p.year"
                @keydown.space.prevent="selectedYear = p.year"
              >
                <title>
                  {{ p.year }} · {{ baht(p.grossTotal) }} ·
                  {{ p.billCount.toLocaleString("th-TH") }} บิล
                </title>
                <circle
                  class="ui-dash-line__hit"
                  :cx="p.x"
                  :cy="p.y"
                  r="16"
                />
                <circle
                  class="ui-dash-line__dot"
                  :cx="p.x"
                  :cy="p.y"
                  r="5.5"
                />
                <text
                  class="ui-dash-line__value"
                  :x="p.x"
                  :y="p.y - 12"
                  text-anchor="middle"
                >
                  {{ bahtChart(p.grossTotal, yearLine.max) }}
                </text>
                <text
                  class="ui-dash-line__label"
                  :x="p.x"
                  :y="yearLine.padT + yearLine.plotH + 22"
                  text-anchor="middle"
                >
                  {{ p.year }}
                </text>
              </g>
            </svg>
            <ul class="ui-dash-line__legend">
              <li>
                <span class="ui-dash-line__swatch ui-dash-line__swatch--best" />
                ปีที่ดีสุด
              </li>
              <li>
                <span
                  class="ui-dash-line__swatch ui-dash-line__swatch--current"
                />
                ปีนี้
              </li>
            </ul>
          </div>
          <div v-if="yearDetail" class="ui-dash-chart-detail">
            <p class="ui-dash-chart-detail__title">
              ปี {{ yearDetail.year.year }} · รวม
              {{ baht(yearDetail.year.grossTotal) }}
              <span
                >·
                {{ yearDetail.year.billCount.toLocaleString("th-TH") }}
                บิล</span
              >
            </p>
            <div
              v-if="!yearDetail.branches.length"
              class="ui-dash-chart-detail__empty"
            >
              ไม่มียอดแยกสาขา
            </div>
            <div v-else class="ui-dash-hbar ui-dash-hbar--ranked">
              <div
                v-for="(row, i) in yearDetail.branches"
                :key="row.branchId"
                class="ui-dash-hbar__row"
              >
                <span class="ui-dash-hbar__rank">{{ i + 1 }}</span>
                <div class="ui-dash-hbar__body">
                  <div class="ui-dash-hbar__head">
                    <span class="ui-dash-hbar__label">{{
                      row.branchName
                    }}</span>
                    <strong>{{ baht(row.grossTotal) }}</strong>
                  </div>
                  <div class="ui-dash-hbar__track">
                    <div
                      class="ui-dash-hbar__fill"
                      :style="{
                        width: `${(row.grossTotal / yearDetail.max) * 100}%`,
                        background: branchColorById(row.branchId),
                      }"
                    />
                  </div>
                  <p class="ui-dash-hbar__meta">
                    {{ row.billCount.toLocaleString("th-TH") }} บิล
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="ui-card" style="margin-top: 1.15rem">
        <div class="ui-card__toolbar">
          <span class="ui-toolbar-meta ui-toolbar-meta--alone">ทางลัด</span>
        </div>
        <div
          class="ui-page-head__actions"
          style="padding: 1.15rem 1.25rem 1.25rem"
        >
          <NuxtLink to="/reports" class="ui-btn ui-btn--primary"
            >สรุปยอดขาย</NuxtLink
          >
          <NuxtLink to="/sales" class="ui-btn ui-btn--ghost">บิลขาย</NuxtLink>
          <NuxtLink to="/cash-book" class="ui-btn ui-btn--ghost"
            >สมุดเงินสด</NuxtLink
          >
          <NuxtLink to="/shifts" class="ui-btn ui-btn--ghost">รอบกะ</NuxtLink>
          <NuxtLink to="/products" class="ui-btn ui-btn--ghost"
            >สินค้า</NuxtLink
          >
          <NuxtLink to="/members" class="ui-btn ui-btn--ghost">สมาชิก</NuxtLink>
        </div>
      </div>
    </template>
    <div v-else class="ui-empty">กำลังโหลด...</div>
  </div>
</template>

<style scoped>
.ui-dash__panel--wide {
  grid-column: 1 / -1;
}

.ui-dash__seg {
  display: flex;
  gap: 0.25rem;
  margin-left: auto;
}

.ui-dash__seg-btn {
  border: 1px solid #e2e8f0;
  background: #fff;
  border-radius: 999px;
  padding: 0.15rem 0.65rem;
  font-size: 0.75rem;
  cursor: pointer;
}

.ui-dash__seg-btn.is-on {
  background: #0f766e;
  border-color: #0f766e;
  color: #fff;
}

.ui-dash-fresh__piece {
  margin-top: 0.75rem;
  padding-top: 0.65rem;
  border-top: 1px solid #eef2f6;
}

.ui-dash-fresh__missing {
  margin: 0.75rem 0 0;
  color: #c2410c;
  font-size: 0.8rem;
}

.ui-dash__panel {
  overflow: visible;
}

.ui-dash-bars__track--stack {
  flex-direction: column-reverse;
  align-items: stretch;
}

.ui-dash-bars__track--stack .ui-dash-bars__fill {
  width: 100%;
  min-height: 0;
  flex: 0 0 auto;
}

.ui-dash-bars__col.is-empty .ui-dash-bars__value {
  color: #cbd5e1;
}

.ui-dash-bars__col--btn {
  appearance: none;
  border: 0;
  background: transparent;
  padding: 0;
  margin: 0;
  cursor: pointer;
  font: inherit;
  color: inherit;
}

.ui-dash-bars__col--btn:focus-visible {
  outline: 2px solid #0f766e;
  outline-offset: 2px;
  border-radius: 0.5rem;
}

.ui-dash-bars__col--btn.is-selected .ui-dash-bars__label {
  color: #0f766e;
  font-weight: 800;
}

.ui-dash-bars__col--btn.is-selected .ui-dash-bars__track {
  box-shadow: 0 0 0 2px color-mix(in srgb, #0f766e 35%, transparent);
}

.ui-dash-bars--weekday .ui-dash-bars__col.is-today .ui-dash-bars__label {
  color: #0f766e;
  font-weight: 800;
}

.ui-dash-chart-detail {
  margin: 0 1.25rem 1.15rem;
  padding: 0.85rem 1rem;
  border-radius: 0.85rem;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
}

.ui-dash-chart-detail__title {
  margin: 0 0 0.75rem;
  font-size: 0.88rem;
  font-weight: 700;
  color: #0f172a;
}

.ui-dash-chart-detail__title span {
  font-weight: 500;
  color: #64748b;
}

.ui-dash-chart-detail__empty {
  color: #94a3b8;
  font-size: 0.85rem;
}

.ui-dash-chart-detail .ui-dash-hbar--ranked {
  padding: 0;
}

.ui-dash-month-branches {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}

.ui-dash-month-branches__row {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.ui-dash-month-branches__head {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.ui-dash-month-branches__head strong {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 0.88rem;
  color: #0f172a;
}

.ui-dash-month-branches__bars {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  padding-left: 1.85rem;
}

.ui-dash-month-branches__line {
  display: grid;
  grid-template-columns: 2.6rem minmax(0, 1fr) auto;
  gap: 0.45rem;
  align-items: center;
}

.ui-dash-month-branches__yr {
  font-size: 0.72rem;
  color: #64748b;
  font-variant-numeric: tabular-nums;
}

.ui-dash-month-branches__line strong {
  font-size: 0.78rem;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.ui-dash-bars__track--pair {
  display: flex;
  flex-direction: row;
  align-items: flex-end;
  gap: 2px;
  max-width: 2.9rem;
}

.ui-dash-bars__track--pair .ui-dash-bars__fill {
  flex: 1 1 0;
  min-width: 0;
  border-radius: 0.35rem 0.35rem 0.15rem 0.15rem;
}

.ui-dash-bars__fill--prev {
  background: #94a3b8 !important;
}

.ui-dash-bars__fill--this {
  background: linear-gradient(180deg, #14b8a6, #0f766e) !important;
}

.ui-dash-bars--months {
  padding-bottom: 0.85rem;
}

.ui-dash-bars--months .ui-dash-bars__delta {
  font-size: 0.68rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: #78716c;
  line-height: 1.2;
  padding-bottom: 0.15rem;
}

.ui-dash-bars--months .ui-dash-bars__delta.is-up {
  color: #047857;
}

.ui-dash-bars--months .ui-dash-bars__delta.is-down {
  color: #b91c1c;
}

.ui-dash__panel--months,
.ui-dash__panel--years {
  grid-column: 1 / -1;
}

.ui-dash-bars--months .ui-dash-bars__value,
.ui-dash-bars--hero .ui-dash-bars__value {
  font-size: 0.68rem;
  white-space: nowrap;
  letter-spacing: -0.01em;
}

.ui-dash__panel > .ui-dash-legend {
  padding: 0.15rem 1.25rem 1.15rem !important;
}

.ui-dash-line {
  padding: 0.25rem 0.85rem 0.65rem;
}

.ui-dash-line__svg {
  display: block;
  width: 100%;
  height: auto;
  max-height: 16rem;
  overflow: visible;
}

.ui-dash-line__grid {
  stroke: #e2e8f0;
  stroke-width: 1;
  stroke-dasharray: 4 4;
}

.ui-dash-line__tick {
  fill: #94a3b8;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

.ui-dash-line__path {
  stroke: #0f766e;
  stroke-width: 2.75;
  stroke-linejoin: round;
  stroke-linecap: round;
}

.ui-dash-line__hit {
  fill: transparent;
  cursor: pointer;
}

.ui-dash-line__dot {
  fill: #fff;
  stroke: #0f766e;
  stroke-width: 2.5;
  pointer-events: none;
}

.ui-dash-line__value {
  fill: #0f172a;
  font-size: 11px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  pointer-events: none;
}

.ui-dash-line__label {
  fill: #64748b;
  font-size: 12px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  pointer-events: none;
}

.ui-dash-line__point.is-current .ui-dash-line__dot {
  stroke: #0f766e;
  fill: #ccfbf1;
}

.ui-dash-line__point.is-current .ui-dash-line__label {
  fill: #0f766e;
}

.ui-dash-line__point.is-best .ui-dash-line__dot {
  stroke: #c2410c;
  fill: #ffedd5;
}

.ui-dash-line__point.is-best .ui-dash-line__label {
  fill: #c2410c;
}

.ui-dash-line__point.is-selected .ui-dash-line__dot {
  stroke-width: 3.5;
}

.ui-dash-line__point.is-selected .ui-dash-line__label {
  font-weight: 800;
}

.ui-dash-line__point:focus {
  outline: none;
}

.ui-dash-line__point:focus-visible .ui-dash-line__dot {
  stroke-width: 3.5;
}

.ui-dash-line__legend {
  display: flex;
  flex-wrap: wrap;
  gap: 0.85rem 1.25rem;
  list-style: none;
  margin: 0;
  padding: 0.15rem 0.5rem 0.85rem;
  color: #64748b;
  font-size: 0.8rem;
}

.ui-dash-line__legend li {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
}

.ui-dash-line__swatch {
  width: 0.65rem;
  height: 0.65rem;
  border-radius: 999px;
  border: 2px solid #0f766e;
  background: #ccfbf1;
  box-sizing: border-box;
}

.ui-dash-line__swatch--best {
  border-color: #c2410c;
  background: #ffedd5;
}

.ui-dash-line__swatch--current {
  border-color: #0f766e;
  background: #ccfbf1;
}

.ui-dash-hbar--ranked {
  padding: 0.85rem 1.25rem 1.15rem;
}
</style>
