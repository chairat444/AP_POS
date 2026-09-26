<script setup lang="ts">
type Branch = { id: string; code: string; name: string };

type Summary = {
  billCount: number;
  salesTotal: number;
  profit: number;
  knownProfit: number;
  knownRevenue: number;
  knownCost: number;
  marginPct: number | null;
  knownMarginPct: number | null;
  estimatedProfit: number;
  estimatedRevenue: number;
  missingRevenue: number;
  missingLineCount: number;
  billsWithMissing: number;
};

type BillRow = {
  id: string;
  billNo: string;
  branchId: string;
  branchName: string;
  day: string;
  createdAt: string;
  total: number;
  profit: number;
  knownProfit: number;
  estimatedProfit: number;
  costAmount: number;
  knownRevenue: number;
  missingRevenue: number;
  missingLineCount: number;
};

type BillLine = {
  id: string;
  name: string;
  barcode: string;
  productCode?: string | null;
  qty: number;
  unit: string;
  unitPrice: number;
  lineTotal: number;
  netRevenue?: number | null;
  costStatus?: "known" | "missing" | "estimated" | null;
  unitCost?: number | null;
  lineCost?: number | null;
  lineProfit?: number | null;
  pricePerKg?: number | null;
};

type BillDetail = BillRow & {
  lines: BillLine[];
  profit?: number | null;
  missingRevenue?: number | null;
  missingLineCount?: number;
  estimatedProfit?: number | null;
  knownRevenue?: number | null;
  costAmount?: number | null;
};

type Report = {
  summary: Summary;
  byDay: Array<{
    day: string;
    billCount: number;
    salesTotal: number;
    profit: number;
    missingRevenue: number;
    estimatedProfit: number;
  }>;
  bills: BillRow[];
  missingProducts: Array<{
    productId?: string | null;
    name: string;
    barcode: string;
    productCode: string | null;
    qty: number;
    revenue: number;
    billCount: number;
  }>;
};

const { get } = useAdminApi();
const pending = ref(false);
const error = ref("");
const branches = ref<Branch[]>([]);
const report = ref<Report | null>(null);
const dayFilter = ref("");
const abnormalOnly = ref(false);
const selectedId = ref<string | null>(null);
const detail = ref<BillDetail | null>(null);
const detailPending = ref(false);
const detailError = ref("");

function isoDay(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const now = new Date();
const filters = reactive({
  from: isoDay(new Date(now.getFullYear(), now.getMonth(), 1)),
  to: isoDay(now),
  branchId: "",
});

function baht(n: number) {
  return n.toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function pct(n: number | null) {
  if (n == null) return "—";
  return `${n.toLocaleString("th-TH", { maximumFractionDigits: 2 })}%`;
}

function dayMargin(row: { profit: number; salesTotal: number; missingRevenue: number }) {
  const base = row.salesTotal - row.missingRevenue;
  if (base <= 0) return null;
  return Math.round((row.profit / base) * 10000) / 100;
}

function billMargin(row: { profit: number; total: number; missingRevenue: number }) {
  const base = row.total - row.missingRevenue;
  if (base <= 0) return null;
  return Math.round((row.profit / base) * 10000) / 100;
}

/** กำไรติดลบ / % สูงผิดปกติ / กำไรมากกว่ายอดขาย / มียอดไม่มีทุน */
function isAbnormalProfit(opts: {
  profit: number;
  sales: number;
  missingRevenue?: number;
  missingLineCount?: number;
}) {
  const sales = opts.sales;
  const missing = opts.missingRevenue ?? 0;
  const missingLines = opts.missingLineCount ?? 0;
  const profit = opts.profit;
  if (missing > 0.005 || missingLines > 0) return true;
  if (profit < -0.005) return true;
  if (sales > 0 && profit > sales + 0.005) return true;
  const base = sales - missing;
  if (base > 0) {
    const margin = (profit / base) * 100;
    // ของสด/แพ็คมักไม่เกิน ~45% · สูงกว่านี้มักใส่ทุนผิด
    if (margin > 55) return true;
  }
  return false;
}

function isAbnormalBill(row: {
  profit: number;
  total: number;
  missingRevenue: number;
  missingLineCount?: number;
}) {
  return isAbnormalProfit({
    profit: row.profit,
    sales: row.total,
    missingRevenue: row.missingRevenue,
    missingLineCount: row.missingLineCount,
  });
}

function isAbnormalDay(row: {
  profit: number;
  salesTotal: number;
  missingRevenue: number;
}) {
  return isAbnormalProfit({
    profit: row.profit,
    sales: row.salesTotal,
    missingRevenue: row.missingRevenue,
  });
}

function fmtAt(iso: string) {
  return new Date(iso).toLocaleString("th-TH", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function costLabel(status?: string | null) {
  if (status === "known") return "มีทุน";
  if (status === "estimated") return "ประมาณการ %";
  if (status === "missing") return "ไม่มีทุน";
  return "—";
}

/** แสดงบาร์โค้ดเป็นหลัก — ไม่เน้น SKU */
function barcodeLabel(opts: {
  barcode?: string | null;
  productCode?: string | null;
}) {
  const barcode = String(opts.barcode ?? "").trim();
  if (barcode) return barcode;
  const code = String(opts.productCode ?? "").trim();
  return code || "—";
}

const filteredBills = computed(() => {
  let list = report.value?.bills ?? [];
  if (dayFilter.value) list = list.filter((b) => b.day === dayFilter.value);
  if (abnormalOnly.value) list = list.filter((b) => isAbnormalBill(b));
  // บิลไม่มีทุน / ผิดปกติขึ้นก่อนในวันนั้น
  return [...list].sort((a, b) => {
    const am = a.missingLineCount > 0 || isAbnormalBill(a) ? 0 : 1;
    const bm = b.missingLineCount > 0 || isAbnormalBill(b) ? 0 : 1;
    if (am !== bm) return am - bm;
    return String(b.createdAt).localeCompare(String(a.createdAt));
  });
});

const selectedDayMeta = computed(() => {
  if (!dayFilter.value || !report.value) return null;
  return report.value.byDay.find((d) => d.day === dayFilter.value) ?? null;
});

const abnormalBillCount = computed(() => {
  const list = report.value?.bills ?? [];
  const scoped = dayFilter.value
    ? list.filter((b) => b.day === dayFilter.value)
    : list;
  return scoped.filter((b) => isAbnormalBill(b)).length;
});

function toggleAbnormalOnly() {
  abnormalOnly.value = !abnormalOnly.value;
}

function selectDay(day: string) {
  if (dayFilter.value === day) {
    dayFilter.value = "";
    return;
  }
  dayFilter.value = day;
  // ถ้าวันนั้นมียอดไม่มีทุน เปิดกรองผิดปกติให้อัตโนมัติ
  const meta = report.value?.byDay.find((d) => d.day === day);
  if (meta && meta.missingRevenue > 0) abnormalOnly.value = true;
}

async function openBill(row: BillRow) {
  selectedId.value = row.id;
  detailPending.value = true;
  detailError.value = "";
  try {
    const sale = await get<BillDetail>(`/sales/${encodeURIComponent(row.id)}`);
    detail.value = {
      ...row,
      ...sale,
      lines: sale.lines ?? [],
    };
  } catch (e) {
    detail.value = null;
    detailError.value =
      e instanceof Error ? e.message : "โหลดรายละเอียดบิลไม่สำเร็จ";
  } finally {
    detailPending.value = false;
  }
}

function productEditHref(row: {
  productId?: string | null;
  productCode: string | null;
  barcode: string;
}) {
  const q = new URLSearchParams();
  // ส่งครบทั้งสาม — หน้าสินค้าจะเลือกตัวที่ถูกเมื่อ SKU/บาร์โค้ดในบิลไม่ตรงกัน
  if (row.productId) q.set("edit", row.productId);
  const code = row.productCode?.trim();
  if (code) q.set("code", code);
  const barcode = row.barcode?.trim();
  if (barcode) q.set("barcode", barcode);
  const qs = q.toString();
  return qs ? `/products?${qs}` : "/products";
}

function clearDetail() {
  selectedId.value = null;
  detail.value = null;
  detailError.value = "";
}

function openMissingProduct(row: {
  productId?: string | null;
  productCode: string | null;
  barcode: string;
}) {
  window.open(productEditHref(row), "_blank", "noopener,noreferrer");
}

async function load() {
  pending.value = true;
  error.value = "";
  clearDetail();
  dayFilter.value = "";
  abnormalOnly.value = false;
  try {
    const qs = new URLSearchParams();
    qs.set("from", filters.from);
    qs.set("to", filters.to);
    if (filters.branchId) qs.set("branchId", filters.branchId);
    report.value = await get<Report>(`/sales/profit?${qs}`);
  } catch (e) {
    error.value = e instanceof Error ? e.message : "โหลดรายงานกำไรไม่สำเร็จ";
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
  <div class="ui-profit">
    <div class="ui-page-head">
      <div>
        <h1 class="ui-page-title">กำไร</h1>
        <p class="ui-page-sub">
          คิดตอนบิลเข้าระบบ จากราคาทุนในแอดมิน · เปิดราคา 15% · หมูสดอื่นๆ (900011) 20%
          ของยอดขายแล้วรวมในกำไร · สินค้าที่ไม่ได้ใส่ทุนไม่นับ · คลิกบิลเพื่อดูรายการและแก้ทุนในบิลได้
        </p>
      </div>
      <div class="ui-page-head__actions">
        <NuxtLink to="/products" class="ui-btn ui-btn--ghost">ใส่ทุนสินค้า</NuxtLink>
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

    <div class="ui-card ui-profit__filters">
      <label class="ui-field">
        <span>จากวันที่</span>
        <input v-model="filters.from" type="date" @change="load" />
      </label>
      <label class="ui-field">
        <span>ถึงวันที่</span>
        <input v-model="filters.to" type="date" @change="load" />
      </label>
      <label class="ui-field">
        <span>สาขา</span>
        <select v-model="filters.branchId" @change="load">
          <option value="">ทุกสาขา</option>
          <option v-for="b in branches" :key="b.id" :value="b.id">
            {{ b.name }}
          </option>
        </select>
      </label>
    </div>

    <p v-if="error" class="ui-profit__error">{{ error }}</p>

    <div v-if="report" class="ui-stat-grid">
      <article class="ui-stat">
        <span class="ui-stat__label">กำไร</span>
        <strong class="ui-stat__value">{{ baht(report.summary.profit) }}</strong>
        <span class="ui-stat__hint">
          ยอดขาย {{ baht(report.summary.salesTotal) }} ·
          {{ report.summary.billCount }} บิล
        </span>
      </article>
      <article class="ui-stat">
        <span class="ui-stat__label">กำไรเฉลี่ย</span>
        <strong class="ui-stat__value">{{ pct(report.summary.marginPct) }}</strong>
        <span class="ui-stat__hint">
          จากยอดที่คิดกำไรได้ (ไม่รวมรายการที่ยังไม่มีทุน)
        </span>
      </article>
      <article class="ui-stat ui-profit__missing">
        <span class="ui-stat__label">ยังไม่ได้ใส่ทุน</span>
        <strong class="ui-stat__value">{{ baht(report.summary.missingRevenue) }}</strong>
        <span class="ui-stat__hint">
          {{ report.summary.missingLineCount }} รายการ ·
          {{ report.summary.billsWithMissing }} บิล · ไม่นับในกำไร
        </span>
      </article>
    </div>

    <section v-if="report" class="ui-card">
      <h2 class="ui-profit__h">รายวัน</h2>
      <p class="ui-page-sub">
        คลิกแถวเพื่อกรองรายบิล · แถวแดง = ไม่มีทุน / กำไรติดลบ / % สูงผิดปกติ (&gt;55%)
      </p>
      <div class="ui-table-wrap">
        <table class="ui-table">
          <thead>
            <tr>
              <th>วันที่</th>
              <th class="num">บิล</th>
              <th class="num">ยอดขาย</th>
              <th class="num">กำไร</th>
              <th class="num">%</th>
              <th class="num">ยอดที่ไม่มีทุน</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="!report.byDay.length">
              <td colspan="6">ไม่มีบิลในช่วงนี้</td>
            </tr>
            <tr
              v-for="row in report.byDay"
              :key="row.day"
              class="is-click"
              :class="{
                'is-on': dayFilter === row.day,
                'is-abnormal': isAbnormalDay(row),
              }"
              @click="selectDay(row.day)"
            >
              <td>{{ row.day }}</td>
              <td class="num">{{ row.billCount }}</td>
              <td class="num">{{ baht(row.salesTotal) }}</td>
              <td class="num" :class="{ danger: isAbnormalDay(row) }">
                {{ baht(row.profit) }}
              </td>
              <td class="num" :class="{ danger: isAbnormalDay(row) }">
                {{ pct(dayMargin(row)) }}
              </td>
              <td class="num" :class="{ warn: row.missingRevenue > 0 }">
                {{ baht(row.missingRevenue) }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <div v-if="report" class="ui-profit__split">
      <section class="ui-card">
        <div class="ui-profit__bill-head">
          <h2 class="ui-profit__h">รายบิล</h2>
          <button
            type="button"
            class="ui-btn"
            :class="abnormalOnly ? 'ui-btn--primary' : 'ui-btn--ghost'"
            :disabled="abnormalBillCount === 0 && !abnormalOnly"
            @click="toggleAbnormalOnly"
          >
            {{ abnormalOnly ? "แสดงทุกบิล" : `บิลผิดปกติ (${abnormalBillCount})` }}
          </button>
          <button
            v-if="dayFilter"
            type="button"
            class="ui-btn ui-btn--ghost"
            @click="dayFilter = ''"
          >
            ล้างวัน {{ dayFilter }}
          </button>
        </div>
        <p class="ui-page-sub">
          {{ filteredBills.length }} บิล
          <template v-if="dayFilter && selectedDayMeta">
            · วัน {{ dayFilter }} (สรุป {{ selectedDayMeta.billCount }} บิล
            <template v-if="selectedDayMeta.missingRevenue > 0">
              · ไม่มีทุน {{ baht(selectedDayMeta.missingRevenue) }}
            </template>
            )
          </template>
          <template v-if="abnormalOnly"> · กรองเฉพาะผิดปกติ</template>
          · บิลไม่มีทุนขึ้นก่อน · แดง = ไม่มีทุน / กำไรติดลบ / % สูงผิดปกติ
        </p>
        <div class="ui-table-wrap ui-profit__bill-scroll">
          <table class="ui-table">
            <thead>
              <tr>
                <th>บิล</th>
                <th>สาขา</th>
                <th class="num">ยอดขาย</th>
                <th class="num">กำไร</th>
                <th class="num">%</th>
                <th class="num">ไม่มีทุน</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="!filteredBills.length">
                <td colspan="6">
                  <template v-if="dayFilter">
                    ไม่พบบิลในวันนี้
                    <template v-if="abnormalOnly"> (ลองกด «แสดงทุกบิล»)</template>
                  </template>
                  <template v-else>ไม่มีบิล</template>
                </td>
              </tr>
              <tr
                v-for="row in filteredBills"
                :key="row.id"
                class="is-click"
                :class="{
                  'is-on': selectedId === row.id,
                  'has-missing': row.missingLineCount > 0,
                  'is-abnormal': isAbnormalBill(row),
                }"
                @click="openBill(row)"
              >
                <td>
                  <strong>{{ row.billNo }}</strong>
                  <small class="ui-profit__muted">{{ fmtAt(row.createdAt) }}</small>
                </td>
                <td>{{ row.branchName }}</td>
                <td class="num">{{ baht(row.total) }}</td>
                <td class="num" :class="{ danger: isAbnormalBill(row) }">
                  {{ baht(row.profit) }}
                </td>
                <td class="num" :class="{ danger: isAbnormalBill(row) }">
                  {{ pct(billMargin(row)) }}
                </td>
                <td class="num" :class="{ warn: row.missingRevenue > 0 }">
                  {{ baht(row.missingRevenue) }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section class="ui-card ui-profit__detail">
        <div class="ui-profit__bill-head">
          <h2 class="ui-profit__h">สรุปบิล</h2>
          <template v-if="detail">
            <NuxtLink
              class="ui-btn ui-btn--ghost"
              :to="`/sales?id=${encodeURIComponent(detail.id)}`"
              target="_blank"
              rel="noopener noreferrer"
            >
              แก้ทุนในบิล
            </NuxtLink>
            <button type="button" class="ui-btn ui-btn--ghost" @click="clearDetail">
              ปิด
            </button>
          </template>
        </div>

        <p v-if="detailPending" class="ui-page-sub">กำลังโหลด…</p>
        <p v-else-if="detailError" class="ui-profit__error">{{ detailError }}</p>
        <p v-else-if="!detail" class="ui-page-sub">เลือกบิลจากรายการด้านซ้าย</p>

        <template v-else>
          <div class="ui-profit__detail-meta">
            <div>
              <span>เลขบิล</span>
              <strong>{{ detail.billNo }}</strong>
            </div>
            <div>
              <span>สาขา</span>
              <strong>{{ detail.branchName }}</strong>
            </div>
            <div>
              <span>เวลา</span>
              <strong>{{ fmtAt(detail.createdAt) }}</strong>
            </div>
          </div>

          <div class="ui-profit__detail-kpis">
            <div>
              <span>ยอดขาย</span>
              <strong>{{ baht(detail.total) }}</strong>
            </div>
            <div
              :class="{
                danger: isAbnormalProfit({
                  profit: detail.profit ?? 0,
                  sales: detail.total,
                  missingRevenue: detail.missingRevenue ?? 0,
                }),
              }"
            >
              <span>กำไร</span>
              <strong>{{ baht(detail.profit ?? 0) }}</strong>
            </div>
            <div
              :class="{
                danger: isAbnormalProfit({
                  profit: detail.profit ?? 0,
                  sales: detail.total,
                  missingRevenue: detail.missingRevenue ?? 0,
                }),
              }"
            >
              <span>กำไรเฉลี่ย</span>
              <strong>{{ pct(billMargin({
                profit: detail.profit ?? 0,
                total: detail.total,
                missingRevenue: detail.missingRevenue ?? 0,
              })) }}</strong>
            </div>
            <div>
              <span>ทุน</span>
              <strong>{{ baht(detail.costAmount ?? 0) }}</strong>
            </div>
            <div :class="{ warn: (detail.missingRevenue ?? 0) > 0 }">
              <span>ไม่มีทุน</span>
              <strong>{{ baht(detail.missingRevenue ?? 0) }}</strong>
            </div>
          </div>

          <div class="ui-table-wrap">
            <table class="ui-table">
              <thead>
                <tr>
                  <th>รายการ</th>
                  <th class="num">จำนวน</th>
                  <th class="num">ยอด</th>
                  <th class="num">ทุน/กก.</th>
                  <th class="num">กำไร</th>
                  <th>สถานะ</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="(line, idx) in detail.lines"
                  :key="line.id"
                  :class="{
                    'is-missing': line.costStatus === 'missing',
                    'is-abnormal':
                      line.lineProfit != null && line.lineProfit < -0.005,
                  }"
                >
                  <td>
                    <strong>{{ idx + 1 }}. {{ line.name }}</strong>
                    <small class="ui-profit__muted">
                      {{ barcodeLabel(line) }}
                      <template v-if="line.pricePerKg && line.pricePerKg > 0">
                        · {{ baht(line.pricePerKg) }}/กก. ·
                        {{
                          (line.lineTotal / line.pricePerKg).toLocaleString("th-TH", {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })
                        }}
                        กก.
                      </template>
                    </small>
                  </td>
                  <td class="num">{{ line.qty }} {{ line.unit }}</td>
                  <td class="num">{{ baht(line.lineTotal) }}</td>
                  <td class="num">
                    {{
                      line.unitCost != null ? baht(line.unitCost) : "—"
                    }}
                  </td>
                  <td
                    class="num"
                    :class="{
                      danger: line.lineProfit != null && line.lineProfit < -0.005,
                    }"
                  >
                    {{
                      line.lineProfit != null ? baht(line.lineProfit) : "—"
                    }}
                  </td>
                  <td>{{ costLabel(line.costStatus) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </template>
      </section>
    </div>

    <section v-if="report" class="ui-card">
      <h2 class="ui-profit__h">สินค้าที่ไม่ได้ใส่ทุน</h2>
      <p class="ui-page-sub">
        ยอดเหล่านี้ไม่ถูกนำไปคิดกำไร — คลิกชื่อสินค้าเพื่อเปิดหน้าแก้ทุน (แท็บใหม่) ·
        แก้ master มีผลบิลใหม่ · แก้ทุนในบิลเก่าได้จากรายบิล
      </p>
      <div class="ui-table-wrap">
        <table class="ui-table">
          <thead>
            <tr>
              <th>สินค้า</th>
              <th>บาร์โค้ด</th>
              <th class="num">จำนวน</th>
              <th class="num">ยอดขาย</th>
              <th class="num">บิล</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="!report.missingProducts.length">
              <td colspan="5">ไม่มี — ทุกรายการที่มีขายในช่วงนี้ใส่ทุนแล้ว หรือเป็นสินค้าเปิดราคา</td>
            </tr>
            <tr
              v-for="row in report.missingProducts"
              :key="`${row.barcode}-${row.name}`"
              class="is-missing is-click"
              @click="openMissingProduct(row)"
            >
              <td>
                <a
                  class="ui-profit__product-link"
                  :href="productEditHref(row)"
                  target="_blank"
                  rel="noopener noreferrer"
                  @click.stop
                >
                  {{ row.name }}
                </a>
              </td>
              <td>{{ barcodeLabel(row) }}</td>
              <td class="num">{{ row.qty }}</td>
              <td class="num">{{ baht(row.revenue) }}</td>
              <td class="num">{{ row.billCount }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </div>
</template>

<style scoped>
.ui-profit__filters {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  margin: 0.75rem 0;
  padding: 0.85rem 1rem;
}

.ui-profit__error {
  color: #b91c1c;
  margin: 0.5rem 0;
}

.ui-profit__missing {
  background: #fff7ed;
}

.ui-profit__h {
  margin: 0 0 0.35rem;
  font-size: 1rem;
}

.ui-card + .ui-card,
.ui-stat-grid + .ui-card,
.ui-profit__split + .ui-card {
  margin-top: 0.85rem;
}

.ui-card {
  padding: 0.9rem 1rem 1rem;
}

.num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.warn,
.is-missing td {
  color: #c2410c;
}

.danger {
  color: #b91c1c;
  font-weight: 700;
}

.is-missing {
  background: #fff7ed;
}

.is-abnormal {
  background: #fef2f2;
}

.is-abnormal.is-click:hover {
  background: #fee2e2;
}

.is-abnormal.is-on {
  background: #fecaca;
}

.is-abnormal td:first-child strong {
  color: #b91c1c;
}

.ui-profit__detail-kpis .danger strong {
  color: #b91c1c;
}

.ui-profit__product-link {
  color: inherit;
  font-weight: 650;
  text-decoration: underline;
  text-underline-offset: 2px;
}

.is-click {
  cursor: pointer;
}

.is-click:hover {
  background: #f8fafc;
}

.is-click.is-on {
  background: #ecfdf5;
}

.has-missing td:first-child strong {
  color: #c2410c;
}

.ui-profit__split {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.1fr);
  gap: 0.85rem;
  margin-top: 0.85rem;
}

@media (max-width: 960px) {
  .ui-profit__split {
    grid-template-columns: 1fr;
  }
}

.ui-profit__bill-head {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: center;
}

.ui-profit__bill-head .ui-profit__h {
  margin: 0;
  margin-right: auto;
}

.ui-profit__bill-scroll {
  max-height: 28rem;
  overflow: auto;
}

.ui-profit__muted {
  display: block;
  color: #64748b;
  font-size: 0.72rem;
  font-weight: 400;
}

.ui-profit__detail-meta,
.ui-profit__detail-kpis {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(7.5rem, 1fr));
  gap: 0.5rem;
  margin: 0.65rem 0 0.85rem;
}

.ui-profit__detail-meta div,
.ui-profit__detail-kpis div {
  border: 1px solid #eef2f6;
  border-radius: 0.5rem;
  padding: 0.4rem 0.55rem;
}

.ui-profit__detail-meta span,
.ui-profit__detail-kpis span {
  display: block;
  font-size: 0.7rem;
  color: #64748b;
}

.ui-profit__detail-meta strong,
.ui-profit__detail-kpis strong {
  display: block;
  font-size: 0.88rem;
}
</style>
