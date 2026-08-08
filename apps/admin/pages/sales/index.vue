<script setup lang="ts">
import { paginateItems } from "~/utils/pagination";

type Sale = {
  id: string;
  billNo: string;
  branchId: string;
  terminalId: string;
  shiftId?: string | null;
  customerName?: string | null;
  subtotal?: number;
  discount?: number;
  total: number;
  paid?: number;
  change?: number;
  pointsRedeemed: number;
  pointsEarned: number;
  status?: string;
  createdAt: string;
  payments?: Array<{ method: string; amount: number }>;
};

type SaleLine = {
  id: string;
  barcode: string;
  productCode?: string | null;
  name: string;
  qty: number;
  unit: string;
  unitPrice: number;
  discount: number;
  lineTotal: number;
};

type SaleDetail = Sale & { lines: SaleLine[] };

type Branch = { id: string; code: string; name: string };

const PAY_LABELS: Record<string, string> = {
  cash: "เงินสด",
  transfer: "เงินโอน",
  government: "เงินสวัสดิการ",
  points: "ส่วนลดแต้ม",
};

/** ลำดับแสดงช่องทางชำระหลัก — ประเภทอื่นต่อท้าย */
const PAY_ORDER = ["cash", "transfer", "government"] as const;

const { get } = useAdminApi();
const pending = ref(false);
const detailPending = ref(false);
const error = ref("");
const rows = ref<Sale[]>([]);
const branches = ref<Branch[]>([]);
const detail = ref<SaleDetail | null>(null);
const selectedId = ref<string | null>(null);

const {
  dateMode,
  day,
  from,
  to,
  rangeFrom,
  rangeTo,
  setDateMode,
  shiftDay,
  setPreset,
} = useReportDateFilter();

const filters = reactive({
  branchId: "",
  paymentMethod: "",
  q: "",
});

const page = ref(1);
const perPage = ref(30);

const filteredRows = computed(() => {
  const q = filters.q.trim().toLowerCase();
  if (!q) return rows.value;
  return rows.value.filter((r) => {
    const hay = [
      r.billNo,
      r.customerName ?? "",
      shiftLabel(r.shiftId),
      branchName(r.branchId),
      r.status === "voided" ? "ยกเลิก" : "",
      ...(r.payments ?? []).map((p) => payLabel(p.method)),
    ]
      .join(" ")
      .toLowerCase();
    return hay.includes(q);
  });
});

/** บิลสำเร็จเท่านั้น — ใช้สรุปยอด */
const countedRows = computed(() =>
  filteredRows.value.filter((r) => r.status !== "voided"),
);

const paged = computed(() =>
  paginateItems(filteredRows.value, page.value, perPage.value),
);
const pageRows = computed(() => paged.value.rows);
const meta = computed(() => paged.value.meta);

/** เงินเข้า = ยอดสุทธิบิล (ส่วนลดแต้มหักใน discount แล้ว) */
function saleMoney(row: Sale) {
  return Math.max(0, Number(row.total || 0));
}

function pointsDiscountBaht(row: Sale) {
  // 1 แต้ม = 1 บาท ตามค่าเริ่มต้นระบบ (แสดงประมาณการจาก pointsRedeemed)
  return Math.max(0, Number(row.pointsRedeemed || 0));
}

const periodTotal = computed(() =>
  countedRows.value.reduce((s, r) => s + saleMoney(r), 0),
);
const periodBillCount = computed(() => countedRows.value.length);

const voidedRows = computed(() =>
  filteredRows.value.filter((r) => r.status === "voided"),
);
const voidedBillCount = computed(() => voidedRows.value.length);
const voidedTotal = computed(() =>
  voidedRows.value.reduce((s, r) => s + saleMoney(r), 0),
);

/** สรุปเงินเข้าแยกช่องทางในช่วงที่กรอง */
const periodByPay = computed(() => {
  const map = new Map<string, number>();
  for (const row of countedRows.value) {
    for (const p of row.payments ?? []) {
      if (p.method === "points") continue;
      const amt = Number(p.amount || 0);
      if (!amt) continue;
      map.set(p.method, (map.get(p.method) ?? 0) + amt);
    }
  }
  const known = PAY_ORDER.filter((m) => (map.get(m) ?? 0) > 0).map((m) => ({
    method: m,
    amount: map.get(m)!,
  }));
  const others = [...map.entries()]
    .filter(([m]) => !(PAY_ORDER as readonly string[]).includes(m))
    .sort((a, b) => b[1] - a[1])
    .map(([method, amount]) => ({ method, amount }));
  return [...known, ...others];
});

function onPageChange(payload: { page: number; per_page: number }) {
  page.value = payload.page;
  perPage.value = payload.per_page;
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

/** รวมยอดชำระเงินต่อบิล (ไม่รวมแต้ม) เรียงตามช่องทางหลักแล้วประเภทอื่น */
function moneyPays(row: Sale) {
  const map = new Map<string, number>();
  for (const p of row.payments ?? []) {
    if (p.method === "points") continue;
    const amt = Number(p.amount || 0);
    if (!amt) continue;
    map.set(p.method, (map.get(p.method) ?? 0) + amt);
  }
  const known = PAY_ORDER.filter((m) => (map.get(m) ?? 0) > 0).map((m) => ({
    method: m,
    amount: map.get(m)!,
  }));
  const others = [...map.entries()]
    .filter(([m]) => !(PAY_ORDER as readonly string[]).includes(m))
    .sort((a, b) => b[1] - a[1])
    .map(([method, amount]) => ({ method, amount }));
  return [...known, ...others];
}

function branchName(id: string) {
  return branches.value.find((b) => b.id === id)?.name ?? id;
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString("th-TH", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("th-TH", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function fmtAt(iso: string) {
  return `${fmtDate(iso)} ${fmtTime(iso)}`;
}

function shiftLabel(shiftId?: string | null) {
  if (!shiftId) return "-";
  const m = shiftId.match(/^shift-[^-]+-(.+)$/);
  return m?.[1] || shiftId;
}

function payShort(row: Sale) {
  const pays = moneyPays(row);
  if (!pays.length) return "-";
  return pays.map((p) => `${payLabel(p.method)} ${baht(p.amount)}`).join(" · ");
}

function onDateMode(mode: "day" | "range") {
  setDateMode(mode);
  void load();
}

async function load() {
  pending.value = true;
  error.value = "";
  try {
    const qs = new URLSearchParams();
    qs.set("limit", "300");
    qs.set("from", rangeFrom.value);
    qs.set("to", rangeTo.value);
    if (filters.branchId) qs.set("branchId", filters.branchId);
    if (filters.paymentMethod) qs.set("paymentMethod", filters.paymentMethod);
    const data = await get<{ sales: Sale[] }>(`/sales?${qs.toString()}`);
    rows.value = data.sales ?? [];
    page.value = 1;
    if (selectedId.value && !rows.value.some((r) => r.id === selectedId.value)) {
      selectedId.value = null;
      detail.value = null;
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : "โหลดรายการขายไม่สำเร็จ";
  } finally {
    pending.value = false;
  }
}

async function selectBill(row: Sale) {
  if (selectedId.value === row.id && detail.value) return;
  selectedId.value = row.id;
  detailPending.value = true;
  error.value = "";
  try {
    detail.value = await get<SaleDetail>(`/sales/${row.id}`);
  } catch (e) {
    error.value =
      e instanceof Error ? e.message : "โหลดรายละเอียดบิลไม่สำเร็จ";
    detail.value = null;
  } finally {
    detailPending.value = false;
  }
}

function clearDetail() {
  selectedId.value = null;
  detail.value = null;
}

watch(
  () => filters.q,
  () => {
    page.value = 1;
  },
);

onMounted(async () => {
  const route = useRoute();
  if (typeof route.query.q === "string" && route.query.q.trim()) {
    filters.q = route.query.q.trim();
  }
  try {
    const data = await get<{ branches: Branch[] }>("/sales/branches");
    branches.value = data.branches ?? [];
  } catch {
    branches.value = [];
  }
  await load();
});
</script>

<template>
  <div class="ui-sales">
    <div class="ui-page-head">
      <div>
        <h1 class="ui-page-title">บิลขาย</h1>
        <p class="ui-page-sub">
          เลือกบิลจากรายการด้านซ้าย · สรุปยอดรวมดูที่
          <NuxtLink to="/reports">สรุปยอดขาย</NuxtLink>
        </p>
      </div>
      <div class="ui-page-head__actions">
        <button
          type="button"
          class="ui-btn ui-btn--ghost"
          @click="
            setPreset('today');
            load();
          "
        >
          วันนี้
        </button>
        <button
          type="button"
          class="ui-btn ui-btn--ghost"
          @click="
            setPreset('month');
            load();
          "
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

    <div class="ui-card ui-sales__filters">
      <div class="ui-sales__filter-row">
        <div class="ui-field">
          <span>ดูแบบ</span>
          <div class="ui-date-mode">
            <button
              type="button"
              class="ui-btn"
              :class="dateMode === 'day' ? 'ui-btn--primary' : 'ui-btn--ghost'"
              @click="onDateMode('day')"
            >
              รายวัน
            </button>
            <button
              type="button"
              class="ui-btn"
              :class="dateMode === 'range' ? 'ui-btn--primary' : 'ui-btn--ghost'"
              @click="onDateMode('range')"
            >
              ช่วงวันที่
            </button>
          </div>
        </div>

        <div v-if="dateMode === 'day'" class="ui-field">
          <span>วันที่</span>
          <div class="ui-date-daybar">
            <button
              type="button"
              class="ui-btn ui-btn--ghost"
              title="วันก่อน"
              @click="
                shiftDay(-1);
                load();
              "
            >
              ‹
            </button>
            <UiDateInput
              :model-value="day"
              aria-label="วันที่"
              @update:model-value="
                day = $event;
                load();
              "
            />
            <button
              type="button"
              class="ui-btn ui-btn--ghost"
              title="วันถัดไป"
              @click="
                shiftDay(1);
                load();
              "
            >
              ›
            </button>
          </div>
        </div>
        <template v-else>
          <label class="ui-field">
            <span>ตั้งแต่</span>
            <UiDateInput
              :model-value="from"
              aria-label="ตั้งแต่"
              @update:model-value="
                from = $event;
                load();
              "
            />
          </label>
          <label class="ui-field">
            <span>ถึง</span>
            <UiDateInput
              :model-value="to"
              aria-label="ถึง"
              @update:model-value="
                to = $event;
                load();
              "
            />
          </label>
        </template>

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
          <span>การชำระ</span>
          <select
            v-model="filters.paymentMethod"
            class="ui-input"
            @change="load"
          >
            <option value="">ทุกประเภท</option>
            <option value="cash">เงินสด</option>
            <option value="transfer">เงินโอน</option>
            <option value="government">เงินสวัสดิการ</option>
          </select>
        </label>

        <label class="ui-field ui-sales__search">
          <span>ค้นหา</span>
          <input
            v-model="filters.q"
            class="ui-input"
            type="search"
            placeholder="เลขบิล / สมาชิก / รอบขาย"
          />
        </label>
      </div>

      <div class="ui-sales__stats">
        <span>{{ periodBillCount }} บิล</span>
        <span class="ui-sales__stats-dot">·</span>
        <strong>{{ baht(periodTotal) }}</strong>
        <span class="ui-sales__stats-hint">เงินเข้า · ไม่รวมบิลยกเลิก</span>
        <template v-if="periodByPay.length">
          <span class="ui-sales__stats-dot">·</span>
          <span
            v-for="(p, i) in periodByPay"
            :key="p.method"
            class="ui-sales__stats-pay"
          >
            <template v-if="i"> · </template>
            {{ payLabel(p.method) }} {{ baht(p.amount) }}
          </span>
        </template>
        <span class="ui-sales__stats-dot">·</span>
        <span
          class="ui-sales__stats-void"
          :class="{ 'is-alert': voidedBillCount > 0 }"
          :title="voidedBillCount ? 'ตรวจบิลยกเลิก — อาจเป็นจุดเสี่ยง' : ''"
        >
          ยกเลิก {{ voidedBillCount }} บิล
          <strong>{{ baht(voidedTotal) }}</strong>
        </span>
      </div>
    </div>

    <div v-if="error" class="ui-empty">{{ error }}</div>

    <div class="ui-sales__split">
      <section class="ui-card ui-sales__list">
        <div v-if="pending && !rows.length" class="ui-empty">กำลังโหลด...</div>
        <div v-else-if="!pageRows.length" class="ui-empty">ไม่มีบิลในช่วงนี้</div>
        <div v-else class="ui-sales__list-body">
          <button
            v-for="row in pageRows"
            :key="row.id"
            type="button"
            class="ui-sales__row"
            :class="{
              'is-active': selectedId === row.id,
              'is-void': row.status === 'voided',
            }"
            @click="selectBill(row)"
          >
            <div class="ui-sales__row-main">
              <span class="ui-sales__row-time">{{ fmtTime(row.createdAt) }}</span>
              <span class="ui-sales__row-bill">
                {{ row.billNo }}
                <em v-if="row.status === 'voided'">ยกเลิก</em>
              </span>
            </div>
            <div class="ui-sales__row-meta">
              <span>{{ row.customerName || "ลูกค้าทั่วไป" }}</span>
              <span class="ui-sales__row-pay">{{ payShort(row) }}</span>
            </div>
            <div class="ui-sales__row-foot">
              <span class="ui-sales__row-shift">{{ shiftLabel(row.shiftId) }}</span>
              <strong class="ui-sales__row-amt">{{ baht(saleMoney(row)) }}</strong>
            </div>
          </button>
        </div>
        <div class="ui-sales__pager">
          <UiPagination :meta="meta" @change="onPageChange" />
        </div>
      </section>

      <section class="ui-card ui-sales__detail">
        <div v-if="detailPending && !detail" class="ui-empty">กำลังเปิดบิล...</div>
        <div v-else-if="!detail" class="ui-sales__detail-empty">
          <p>เลือกบิลจากรายการ</p>
          <span>รายละเอียดจะแสดงที่นี่ทันที ไม่ต้องเปิดหน้าต่างซ้อน</span>
        </div>
        <template v-else>
          <header class="ui-sales__detail-head">
            <div>
              <p class="ui-sales__detail-kicker">{{ fmtAt(detail.createdAt) }}</p>
              <h2>
                {{ detail.billNo }}
                <em v-if="detail.status === 'voided'" class="ui-sales__void-tag">ยกเลิก</em>
              </h2>
            </div>
            <button type="button" class="ui-btn ui-btn--ghost" @click="clearDetail">
              ปิด
            </button>
          </header>

          <div class="ui-sales__detail-grid">
            <div>
              <span>สาขา</span>
              <strong>{{ branchName(detail.branchId) }}</strong>
            </div>
            <div>
              <span>รอบขาย</span>
              <strong>{{ shiftLabel(detail.shiftId) }}</strong>
            </div>
            <div>
              <span>สมาชิก</span>
              <strong>{{ detail.customerName || "ลูกค้าทั่วไป" }}</strong>
            </div>
            <div>
              <span>แต้ม</span>
              <strong>
                +{{ detail.pointsEarned }} / −{{ detail.pointsRedeemed }}
              </strong>
            </div>
          </div>

          <div class="ui-sales__lines">
            <div class="ui-sales__lines-head">
              <span>สินค้า</span>
              <span>จำนวน</span>
              <span>รวม</span>
            </div>
            <div
              v-for="(line, idx) in detail.lines"
              :key="line.id"
              class="ui-sales__line"
            >
              <div class="ui-sales__line-name">
                <strong>{{ idx + 1 }}. {{ line.name }}</strong>
                <small>{{ line.productCode || line.barcode }}</small>
              </div>
              <div class="ui-sales__line-qty">
                {{ line.qty }} {{ line.unit }}
                <small>× {{ baht(line.unitPrice) }}</small>
              </div>
              <div class="ui-sales__line-total">{{ baht(line.lineTotal) }}</div>
            </div>
          </div>

          <footer class="ui-sales__detail-foot">
            <div class="ui-sales__pays">
              <span
                v-for="p in moneyPays(detail)"
                :key="p.method"
                class="ui-sales__pay"
                :data-method="p.method"
              >
                {{ payLabel(p.method) }} {{ baht(p.amount) }}
              </span>
              <span
                v-if="pointsDiscountBaht(detail) > 0"
                class="ui-sales__pay ui-sales__pay--points"
              >
                ส่วนลดแต้ม {{ baht(pointsDiscountBaht(detail)) }}
              </span>
              <span
                v-if="!moneyPays(detail).length && !pointsDiscountBaht(detail)"
                class="ui-sales__pay"
              >
                ไม่ระบุการชำระ
              </span>
            </div>
            <div class="ui-sales__totals">
              <div>
                <span>ก่อนลด</span>
                <span>{{ baht(detail.subtotal ?? detail.total) }}</span>
              </div>
              <div v-if="(detail.discount || 0) - pointsDiscountBaht(detail) > 0">
                <span>ส่วนลดอื่น</span>
                <span>
                  −{{ baht((detail.discount || 0) - pointsDiscountBaht(detail)) }}
                </span>
              </div>
              <div v-if="pointsDiscountBaht(detail) > 0">
                <span>ส่วนลดแต้ม ({{ detail.pointsRedeemed }} แต้ม)</span>
                <span>−{{ baht(pointsDiscountBaht(detail)) }}</span>
              </div>
              <div v-else-if="detail.discount">
                <span>ส่วนลด</span>
                <span>−{{ baht(detail.discount) }}</span>
              </div>
              <div v-if="detail.change">
                <span>เงินทอน</span>
                <span>{{ baht(detail.change) }}</span>
              </div>
              <div class="is-total">
                <span>เงินเข้า</span>
                <strong>{{ baht(saleMoney(detail)) }}</strong>
              </div>
            </div>
          </footer>
        </template>
      </section>
    </div>
  </div>
</template>

<style scoped>
.ui-sales {
  display: flex;
  flex-direction: column;
  gap: 0;
  min-height: 0;
  height: calc(100vh - var(--ui-shell-header-height, 3.75rem) - 2.5rem);
}

.ui-sales :deep(.ui-page-head) {
  flex: 0 0 auto;
}

.ui-sales__filters {
  flex: 0 0 auto;
  padding: 1rem 1.15rem 0.9rem;
  margin-bottom: 1rem;
}

.ui-sales__filter-row {
  display: grid;
  grid-template-columns: auto auto auto minmax(9rem, 1fr) minmax(8rem, 0.9fr) minmax(12rem, 1.4fr);
  gap: 0.75rem 0.85rem;
  align-items: end;
}

.ui-sales__filters .ui-field {
  margin-bottom: 0;
}

.ui-sales__filters :deep(.ui-date) {
  min-width: 11rem;
  width: 11rem;
}

.ui-sales__stats {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 0.4rem;
  margin-top: 0.85rem;
  padding-top: 0.75rem;
  border-top: 1px solid #eef2f6;
  color: #64748b;
  font-size: 0.9rem;
}

.ui-sales__stats strong {
  color: #0f172a;
  font-size: 1.05rem;
}

.ui-sales__stats-dot {
  opacity: 0.5;
}

.ui-sales__stats-hint {
  margin-left: 0.15rem;
  font-size: 0.78rem;
  color: #94a3b8;
}

.ui-sales__stats-pay {
  color: #334155;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.ui-sales__stats-void {
  display: inline-flex;
  align-items: baseline;
  gap: 0.35rem;
  font-variant-numeric: tabular-nums;
}

.ui-sales__stats-void strong {
  font-size: inherit;
  color: inherit;
}

.ui-sales__stats-void.is-alert {
  padding: 0.15rem 0.55rem;
  border-radius: 0.45rem;
  background: #fef2f2;
  color: #b91c1c;
  font-weight: 650;
}

.ui-sales__stats-void.is-alert strong {
  color: #991b1b;
  font-size: 1.05rem;
}

.ui-sales__split {
  flex: 1 1 auto;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(18rem, 22rem) minmax(0, 1fr);
  gap: 1rem;
  align-items: stretch;
}

.ui-sales__list,
.ui-sales__detail {
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
  max-height: 100%;
  overflow: hidden;
  padding: 0;
}

.ui-sales__list-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
  padding: 0.45rem;
}

.ui-sales__pager {
  flex: 0 0 auto;
  border-top: 1px solid #eef2f6;
  padding: 0.35rem 0.55rem;
}

.ui-sales__row {
  width: 100%;
  text-align: left;
  appearance: none;
  border: 1px solid transparent;
  background: transparent;
  border-radius: 0.75rem;
  padding: 0.7rem 0.75rem;
  cursor: pointer;
  display: grid;
  gap: 0.28rem;
  color: inherit;
  font: inherit;
}

.ui-sales__row:hover {
  background: #f8fafc;
}

.ui-sales__row.is-active {
  background: color-mix(in srgb, var(--ui-primary) 10%, white);
  border-color: color-mix(in srgb, var(--ui-primary) 28%, #e2e8f0);
}

.ui-sales__row.is-void {
  opacity: 0.62;
}

.ui-sales__row.is-void .ui-sales__row-amt {
  text-decoration: line-through;
}

.ui-sales__row-bill em,
.ui-sales__void-tag {
  margin-left: 0.35rem;
  font-style: normal;
  font-size: 0.72rem;
  font-weight: 700;
  color: #b91c1c;
  background: #fef2f2;
  border: 1px solid #fecaca;
  border-radius: 999px;
  padding: 0.05rem 0.4rem;
  vertical-align: middle;
}

.ui-sales__row-main {
  display: flex;
  justify-content: space-between;
  gap: 0.75rem;
  align-items: baseline;
}

.ui-sales__row-time {
  font-variant-numeric: tabular-nums;
  color: #64748b;
  font-size: 0.82rem;
  flex: 0 0 auto;
}

.ui-sales__row-bill {
  font-weight: 650;
  font-size: 0.86rem;
  color: #0f172a;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ui-sales__row-meta,
.ui-sales__row-foot {
  display: flex;
  justify-content: space-between;
  gap: 0.75rem;
  font-size: 0.8rem;
  color: #64748b;
}

.ui-sales__row-pay {
  color: #475569;
  font-weight: 600;
  text-align: right;
  max-width: 60%;
  line-height: 1.35;
}

.ui-sales__row-shift {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ui-sales__row-amt {
  color: #0f172a;
  font-variant-numeric: tabular-nums;
  font-size: 0.92rem;
}

.ui-sales__detail {
  padding: 1rem 1.15rem 1.1rem;
}

.ui-sales__detail-empty {
  flex: 1;
  display: grid;
  place-content: center;
  text-align: center;
  gap: 0.35rem;
  color: #94a3b8;
  padding: 2rem 1rem;
}

.ui-sales__detail-empty p {
  margin: 0;
  color: #64748b;
  font-weight: 650;
  font-size: 1rem;
}

.ui-sales__detail-empty span {
  font-size: 0.88rem;
}

.ui-sales__detail-head {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  align-items: start;
  margin-bottom: 0.85rem;
}

.ui-sales__detail-kicker {
  margin: 0 0 0.2rem;
  color: #64748b;
  font-size: 0.82rem;
}

.ui-sales__detail-head h2 {
  margin: 0;
  font-size: 1.15rem;
  font-weight: 750;
  color: #0f172a;
  word-break: break-all;
}

.ui-sales__detail-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0.55rem;
  margin-bottom: 0.85rem;
}

.ui-sales__detail-grid > div {
  background: #f8fafc;
  border: 1px solid #eef2f6;
  border-radius: 0.7rem;
  padding: 0.55rem 0.7rem;
  min-width: 0;
}

.ui-sales__detail-grid span {
  display: block;
  font-size: 0.72rem;
  color: #64748b;
  margin-bottom: 0.15rem;
}

.ui-sales__detail-grid strong {
  display: block;
  font-size: 0.88rem;
  font-weight: 650;
  color: #0f172a;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ui-sales__lines {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  border: 1px solid #eef2f6;
  border-radius: 0.8rem;
  background: #fff;
}

.ui-sales__lines-head,
.ui-sales__line {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 7.5rem 6.5rem;
  gap: 0.6rem;
  align-items: start;
  padding: 0.55rem 0.75rem;
}

.ui-sales__lines-head {
  position: sticky;
  top: 0;
  background: #f8fafc;
  border-bottom: 1px solid #eef2f6;
  color: #64748b;
  font-size: 0.75rem;
  font-weight: 650;
  z-index: 1;
}

.ui-sales__line + .ui-sales__line {
  border-top: 1px solid #f1f5f9;
}

.ui-sales__line-name {
  min-width: 0;
  display: grid;
  gap: 0.1rem;
}

.ui-sales__line-name strong {
  font-size: 0.9rem;
  font-weight: 650;
  color: #0f172a;
}

.ui-sales__line-name small,
.ui-sales__line-qty small {
  color: #94a3b8;
  font-size: 0.75rem;
}

.ui-sales__line-qty {
  text-align: right;
  font-size: 0.86rem;
  color: #334155;
  display: grid;
  gap: 0.1rem;
}

.ui-sales__line-total {
  text-align: right;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: #0f172a;
}

.ui-sales__detail-foot {
  flex: 0 0 auto;
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(12rem, 15rem);
  gap: 0.85rem;
  margin-top: 0.85rem;
  align-items: end;
}

.ui-sales__pays {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
}

.ui-sales__pay {
  display: inline-flex;
  padding: 0.35rem 0.65rem;
  border-radius: 999px;
  background: color-mix(in srgb, var(--ui-primary) 12%, white);
  color: var(--ui-primary-dark);
  font-size: 0.8rem;
  font-weight: 650;
}

.ui-sales__pay[data-method="cash"] {
  background: #ecfdf5;
  color: #047857;
}

.ui-sales__pay[data-method="transfer"] {
  background: #eff6ff;
  color: #1d4ed8;
}

.ui-sales__pay[data-method="government"] {
  background: #fff7ed;
  color: #c2410c;
}

.ui-sales__pay--points {
  background: #f8fafc;
  color: #64748b;
}

.ui-sales__totals {
  display: grid;
  gap: 0.28rem;
  padding: 0.7rem 0.85rem;
  background: #0f172a;
  color: #e2e8f0;
  border-radius: 0.8rem;
}

.ui-sales__totals > div {
  display: flex;
  justify-content: space-between;
  gap: 0.75rem;
  font-size: 0.86rem;
}

.ui-sales__totals .is-total {
  margin-top: 0.15rem;
  padding-top: 0.4rem;
  border-top: 1px solid rgba(148, 163, 184, 0.35);
  font-size: 1.02rem;
  color: #fff;
}

@media (max-width: 1100px) {
  .ui-sales {
    height: auto;
    min-height: 0;
  }

  .ui-sales__filter-row {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .ui-sales__search {
    grid-column: 1 / -1;
  }

  .ui-sales__split {
    grid-template-columns: 1fr;
    flex: none;
  }

  .ui-sales__list {
    height: min(28rem, 55vh);
    max-height: min(28rem, 55vh);
  }

  .ui-sales__detail {
    height: auto;
    max-height: none;
    min-height: 24rem;
  }

  .ui-sales__detail-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .ui-sales__detail-foot {
    grid-template-columns: 1fr;
  }
}
</style>
