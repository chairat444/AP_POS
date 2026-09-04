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

/** ป้ายช่องทางอย่างเดียว — ไม่ซ้ำกับยอดด้านขวา */
function payMethodsShort(row: Sale) {
  const pays = moneyPays(row);
  if (!pays.length) return "ไม่ระบุ";
  return pays.map((p) => payLabel(p.method)).join(" · ");
}

const showMobileDetail = computed(
  () => Boolean(selectedId.value && detail.value),
);

function onDateMode(mode: "day" | "range") {
  setDateMode(mode);
  void load();
}

const route = useRoute();

function saleDayIso(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  // ใช้วันตามเวลาท้องถิ่น (เดียวกับตัวกรองรายงาน)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function load(opts: { keepSelection?: boolean } = {}) {
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
    if (
      !opts.keepSelection &&
      selectedId.value &&
      !rows.value.some((r) => r.id === selectedId.value)
    ) {
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

/** เปิดบิลจาก query ?id=... (เช่นจากประวัติแต้ม) */
async function openSaleFromQuery() {
  const id =
    typeof route.query.id === "string" ? route.query.id.trim() : "";
  if (!id) return false;

  detailPending.value = true;
  error.value = "";
  try {
    const sale = await get<SaleDetail>(`/sales/${encodeURIComponent(id)}`);
    selectedId.value = sale.id;
    detail.value = sale;
    if (sale.billNo && !filters.q.trim()) {
      filters.q = sale.billNo;
    }
    const dayIso = saleDayIso(sale.createdAt);
    if (dayIso) {
      dateMode.value = "day";
      day.value = dayIso;
    }
    await load({ keepSelection: true });
    return true;
  } catch (e) {
    error.value =
      e instanceof Error ? e.message : "โหลดรายละเอียดบิลไม่สำเร็จ";
    selectedId.value = null;
    detail.value = null;
    return false;
  } finally {
    detailPending.value = false;
  }
}

/** ถ้าค้นหาแล้วเหลือบิลเดียว ให้เปิดรายละเอียดเลย */
async function autoOpenFilteredBill() {
  if (selectedId.value && detail.value) return;
  const q = filters.q.trim().toLowerCase();
  if (!q) return;
  const hits = filteredRows.value.filter(
    (r) =>
      r.billNo.toLowerCase() === q ||
      r.billNo.toLowerCase().includes(q) ||
      r.id.toLowerCase() === q,
  );
  const exact = hits.filter((r) => r.billNo.toLowerCase() === q);
  const pick = exact.length === 1 ? exact[0] : hits.length === 1 ? hits[0] : null;
  if (pick) await selectBill(pick);
}

watch(
  () => filters.q,
  () => {
    page.value = 1;
  },
);

onMounted(async () => {
  if (typeof route.query.q === "string" && route.query.q.trim()) {
    filters.q = route.query.q.trim();
  }
  try {
    const data = await get<{ branches: Branch[] }>("/sales/branches");
    branches.value = data.branches ?? [];
  } catch {
    branches.value = [];
  }
  const opened = await openSaleFromQuery();
  if (!opened) {
    await load();
    await autoOpenFilteredBill();
  }
});
</script>

<template>
  <div
    class="ui-sales"
    :class="{ 'ui-sales--detail-open': showMobileDetail }"
  >
    <div class="ui-page-head">
      <div>
        <h1 class="ui-page-title">บิลขาย</h1>
        <p class="ui-page-sub">
          เลือกรายการเพื่อดูรายละเอียด · สรุปยอดรวมดูที่
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

    <UiSalesTabs />

    <div class="ui-card ui-sales__toolbar">
      <div class="ui-sales__toolbar-row">
        <div class="ui-date-mode" role="group" aria-label="ดูแบบ">
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

        <div v-if="dateMode === 'day'" class="ui-sales__daybar">
          <button
            type="button"
            class="ui-btn ui-btn--ghost ui-sales__day-nav"
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
            class="ui-btn ui-btn--ghost ui-sales__day-nav"
            title="วันถัดไป"
            @click="
              shiftDay(1);
              load();
            "
          >
            ›
          </button>
        </div>
        <template v-else>
          <UiDateInput
            :model-value="from"
            aria-label="ตั้งแต่"
            @update:model-value="
              from = $event;
              load();
            "
          />
          <span class="ui-sales__range-sep">ถึง</span>
          <UiDateInput
            :model-value="to"
            aria-label="ถึง"
            @update:model-value="
              to = $event;
              load();
            "
          />
        </template>

        <select
          v-model="filters.branchId"
          class="ui-input ui-sales__select"
          aria-label="สาขา"
          @change="load"
        >
          <option value="">ทุกสาขา</option>
          <option v-for="b in branches" :key="b.id" :value="b.id">
            {{ b.name }}
          </option>
        </select>

        <select
          v-model="filters.paymentMethod"
          class="ui-input ui-sales__select"
          aria-label="การชำระ"
          @change="load"
        >
          <option value="">ทุกประเภท</option>
          <option value="cash">เงินสด</option>
          <option value="transfer">เงินโอน</option>
          <option value="government">เงินสวัสดิการ</option>
        </select>

        <input
          v-model="filters.q"
          class="ui-input ui-sales__q"
          type="search"
          placeholder="ค้นหาเลขบิล / สมาชิก"
          aria-label="ค้นหา"
        />
      </div>

      <div class="ui-sales__stats">
        <div class="ui-sales__stat">
          <span>บิล</span>
          <strong>{{ periodBillCount }}</strong>
        </div>
        <div class="ui-sales__stat ui-sales__stat--main">
          <span>เงินเข้า</span>
          <strong>{{ baht(periodTotal) }}</strong>
        </div>
        <div
          v-for="p in periodByPay"
          :key="p.method"
          class="ui-sales__stat"
          :data-pay="p.method"
        >
          <span>{{ payLabel(p.method) }}</span>
          <strong>{{ baht(p.amount) }}</strong>
        </div>
        <div
          class="ui-sales__stat"
          :class="{ 'is-void': voidedBillCount > 0 }"
        >
          <span>ยกเลิก</span>
          <strong>{{ voidedBillCount }} · {{ baht(voidedTotal) }}</strong>
        </div>
      </div>
    </div>

    <div v-if="error" class="ui-empty">{{ error }}</div>

    <div class="ui-sales__split">
      <section class="ui-card ui-sales__list">
        <header class="ui-sales__panel-head">
          <strong>รายการบิล</strong>
          <span>{{ meta.total }} รายการ</span>
        </header>
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
            <div class="ui-sales__row-top">
              <span class="ui-sales__row-time">{{ fmtTime(row.createdAt) }}</span>
              <strong class="ui-sales__row-amt">{{ baht(saleMoney(row)) }}</strong>
            </div>
            <div class="ui-sales__row-bill">
              {{ row.billNo }}
              <em v-if="row.status === 'voided'">ยกเลิก</em>
            </div>
            <div class="ui-sales__row-meta">
              <span>{{ row.customerName || "ลูกค้าทั่วไป" }}</span>
              <span class="ui-sales__row-pay">{{ payMethodsShort(row) }}</span>
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
          <span>รายละเอียดจะแสดงที่นี่ทันที</span>
        </div>
        <template v-else>
          <header class="ui-sales__detail-head">
            <button
              type="button"
              class="ui-btn ui-btn--ghost ui-sales__back"
              @click="clearDetail"
            >
              ← รายการ
            </button>
            <div class="ui-sales__detail-title">
              <p class="ui-sales__detail-kicker">{{ fmtAt(detail.createdAt) }}</p>
              <h2>
                {{ detail.billNo }}
                <em
                  v-if="detail.status === 'voided'"
                  class="ui-sales__void-tag"
                >ยกเลิก</em>
              </h2>
            </div>
            <button
              type="button"
              class="ui-btn ui-btn--ghost ui-sales__close-desk"
              @click="clearDetail"
            >
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
                {{ payLabel(p.method) }}
                <b>{{ baht(p.amount) }}</b>
              </span>
              <span
                v-if="pointsDiscountBaht(detail) > 0"
                class="ui-sales__pay ui-sales__pay--points"
              >
                ส่วนลดแต้ม
                <b>{{ baht(pointsDiscountBaht(detail)) }}</b>
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
              <div
                v-if="(detail.discount || 0) - pointsDiscountBaht(detail) > 0"
              >
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
  gap: 0.65rem;
  min-height: calc(100vh - var(--ui-shell-header-height, 3.75rem) - 2rem);
}

.ui-sales :deep(.ui-page-head) {
  flex: 0 0 auto;
  margin-bottom: 0;
}

.ui-sales__toolbar {
  flex: 0 0 auto;
  padding: 0.65rem 0.85rem;
  margin: 0;
  display: grid;
  gap: 0.55rem;
}

.ui-sales__toolbar-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.45rem 0.55rem;
}

.ui-sales__daybar {
  display: inline-flex;
  flex-wrap: nowrap;
  align-items: center;
  gap: 0.25rem;
  flex: 0 0 auto;
}

.ui-sales__daybar :deep(.ui-date) {
  width: 10.5rem;
  min-width: 10.5rem;
}

.ui-sales__day-nav {
  min-width: 2.1rem;
  padding-left: 0.45rem;
  padding-right: 0.45rem;
}

.ui-sales__range-sep {
  color: #94a3b8;
  font-size: 0.8rem;
}

.ui-sales__select {
  width: auto;
  min-width: 8.5rem;
  max-width: 12rem;
  flex: 0 1 auto;
}

.ui-sales__q {
  flex: 1 1 12rem;
  min-width: 10rem;
  max-width: 22rem;
}

.ui-sales__stats {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem 0.45rem;
  padding-top: 0.55rem;
  border-top: 1px solid #eef2f6;
}

.ui-sales__stat {
  display: inline-flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.65rem;
  min-width: 7.5rem;
  padding: 0.35rem 0.6rem;
  border-radius: 0.55rem;
  background: #f8fafc;
  border: 1px solid #eef2f6;
  font-size: 0.78rem;
  color: #64748b;
}

.ui-sales__stat strong {
  color: #0f172a;
  font-size: 0.92rem;
  font-weight: 750;
  font-variant-numeric: tabular-nums;
  text-align: right;
}

.ui-sales__stat--main {
  background: color-mix(in srgb, var(--ui-primary) 8%, white);
  border-color: color-mix(in srgb, var(--ui-primary) 22%, #e2e8f0);
}

.ui-sales__stat--main strong {
  font-size: 1rem;
}

.ui-sales__stat[data-pay="cash"] strong {
  color: #047857;
}

.ui-sales__stat[data-pay="transfer"] strong {
  color: #1d4ed8;
}

.ui-sales__stat[data-pay="government"] strong {
  color: #c2410c;
}

.ui-sales__stat.is-void {
  background: #fef2f2;
  border-color: #fecaca;
  color: #b91c1c;
}

.ui-sales__stat.is-void strong {
  color: #991b1b;
}

.ui-sales__split {
  flex: 1 1 auto;
  min-height: 26rem;
  display: grid;
  grid-template-columns: minmax(22rem, 0.95fr) minmax(0, 1.35fr);
  gap: 0.75rem;
  align-items: stretch;
}

.ui-sales__list,
.ui-sales__detail {
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
  overflow: hidden;
  padding: 0;
}

.ui-sales__panel-head {
  flex: 0 0 auto;
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 0.75rem;
  padding: 0.55rem 0.8rem;
  border-bottom: 1px solid #eef2f6;
  background: #fafbfc;
}

.ui-sales__panel-head strong {
  font-size: 0.88rem;
  color: #0f172a;
}

.ui-sales__panel-head span {
  font-size: 0.75rem;
  color: #94a3b8;
  font-variant-numeric: tabular-nums;
}

.ui-sales__list-body {
  flex: 1 1 auto;
  min-height: 14rem;
  overflow-y: auto;
  overflow-x: hidden;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
  padding: 0.25rem;
}

.ui-sales__pager {
  flex: 0 0 auto;
  border-top: 1px solid #eef2f6;
  padding: 0.25rem 0.45rem;
}

.ui-sales__row {
  width: 100%;
  text-align: left;
  appearance: none;
  border: 1px solid transparent;
  border-bottom-color: #f1f5f9;
  background: #fff;
  border-radius: 0.55rem;
  padding: 0.55rem 0.65rem;
  cursor: pointer;
  display: grid;
  gap: 0.15rem;
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
  opacity: 0.55;
}

.ui-sales__row.is-void .ui-sales__row-amt {
  text-decoration: line-through;
}

.ui-sales__row-top {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 0.75rem;
}

.ui-sales__row-time {
  font-variant-numeric: tabular-nums;
  color: #64748b;
  font-size: 0.78rem;
}

.ui-sales__row-amt {
  color: #0f172a;
  font-variant-numeric: tabular-nums;
  font-size: 0.98rem;
  font-weight: 750;
  text-align: right;
}

.ui-sales__row-bill {
  font-weight: 650;
  font-size: 0.82rem;
  color: #0f172a;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-variant-numeric: tabular-nums;
  overflow: visible;
  text-overflow: clip;
  white-space: normal;
  word-break: break-all;
  line-height: 1.35;
}

.ui-sales__row-bill em,
.ui-sales__void-tag {
  margin-left: 0.3rem;
  font-style: normal;
  font-size: 0.7rem;
  font-weight: 700;
  color: #b91c1c;
  background: #fef2f2;
  border: 1px solid #fecaca;
  border-radius: 999px;
  padding: 0.05rem 0.35rem;
  vertical-align: middle;
}

.ui-sales__row-meta {
  display: flex;
  justify-content: space-between;
  gap: 0.75rem;
  font-size: 0.75rem;
  color: #64748b;
}

.ui-sales__row-pay {
  color: #475569;
  font-weight: 600;
  text-align: right;
  max-width: 55%;
}

.ui-sales__detail {
  padding: 0.75rem 0.9rem 0.9rem;
}

.ui-sales__detail-empty {
  flex: 1;
  display: grid;
  place-content: center;
  text-align: center;
  gap: 0.3rem;
  color: #94a3b8;
  padding: 1.5rem 1rem;
}

.ui-sales__detail-empty p {
  margin: 0;
  color: #64748b;
  font-weight: 650;
  font-size: 0.95rem;
}

.ui-sales__detail-empty span {
  font-size: 0.82rem;
}

.ui-sales__detail-head {
  display: flex;
  justify-content: space-between;
  gap: 0.65rem;
  align-items: start;
  margin-bottom: 0.65rem;
}

.ui-sales__detail-title {
  flex: 1 1 auto;
  min-width: 0;
}

.ui-sales__detail-kicker {
  margin: 0 0 0.15rem;
  color: #64748b;
  font-size: 0.78rem;
}

.ui-sales__detail-head h2 {
  margin: 0;
  font-size: 1.05rem;
  font-weight: 750;
  color: #0f172a;
  word-break: break-all;
}

.ui-sales__back {
  display: none;
  flex: 0 0 auto;
}

.ui-sales__close-desk {
  flex: 0 0 auto;
}

.ui-sales__detail-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0.4rem;
  margin-bottom: 0.65rem;
}

.ui-sales__detail-grid > div {
  background: #f8fafc;
  border: 1px solid #eef2f6;
  border-radius: 0.55rem;
  padding: 0.4rem 0.55rem;
  min-width: 0;
}

.ui-sales__detail-grid span {
  display: block;
  font-size: 0.7rem;
  color: #64748b;
  margin-bottom: 0.1rem;
}

.ui-sales__detail-grid strong {
  display: block;
  font-size: 0.82rem;
  font-weight: 650;
  color: #0f172a;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ui-sales__lines {
  flex: 1 1 auto;
  min-height: 10rem;
  overflow: auto;
  border: 1px solid #eef2f6;
  border-radius: 0.65rem;
  background: #fff;
}

.ui-sales__lines-head,
.ui-sales__line {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 6.5rem 5.75rem;
  gap: 0.45rem;
  align-items: start;
  padding: 0.45rem 0.6rem;
}

.ui-sales__lines-head {
  position: sticky;
  top: 0;
  background: #f8fafc;
  border-bottom: 1px solid #eef2f6;
  color: #64748b;
  font-size: 0.72rem;
  font-weight: 650;
  z-index: 1;
}

.ui-sales__lines-head span:nth-child(2),
.ui-sales__lines-head span:nth-child(3) {
  text-align: right;
}

.ui-sales__line + .ui-sales__line {
  border-top: 1px solid #f1f5f9;
}

.ui-sales__line-name {
  min-width: 0;
  display: grid;
  gap: 0.05rem;
}

.ui-sales__line-name strong {
  font-size: 0.84rem;
  font-weight: 650;
  color: #0f172a;
}

.ui-sales__line-name small,
.ui-sales__line-qty small {
  color: #94a3b8;
  font-size: 0.72rem;
}

.ui-sales__line-qty {
  text-align: right;
  font-size: 0.8rem;
  color: #334155;
  display: grid;
  gap: 0.05rem;
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
  grid-template-columns: minmax(0, 1fr) minmax(10.5rem, 13rem);
  gap: 0.65rem;
  margin-top: 0.65rem;
  align-items: end;
}

.ui-sales__pays {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
}

.ui-sales__pay {
  display: inline-flex;
  align-items: baseline;
  gap: 0.35rem;
  padding: 0.3rem 0.55rem;
  border-radius: 999px;
  background: color-mix(in srgb, var(--ui-primary) 12%, white);
  color: var(--ui-primary-dark);
  font-size: 0.76rem;
  font-weight: 650;
}

.ui-sales__pay b {
  font-variant-numeric: tabular-nums;
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
  gap: 0.22rem;
  padding: 0.6rem 0.75rem;
  background: #0f172a;
  color: #e2e8f0;
  border-radius: 0.65rem;
}

.ui-sales__totals > div {
  display: flex;
  justify-content: space-between;
  gap: 0.75rem;
  font-size: 0.82rem;
  font-variant-numeric: tabular-nums;
}

.ui-sales__totals .is-total {
  margin-top: 0.1rem;
  padding-top: 0.35rem;
  border-top: 1px solid rgba(148, 163, 184, 0.35);
  font-size: 0.98rem;
  color: #fff;
}

@media (max-width: 1100px) {
  .ui-sales {
    min-height: 0;
    height: auto;
  }

  .ui-sales__split {
    grid-template-columns: 1fr;
    min-height: 0;
  }

  .ui-sales__list {
    height: min(26rem, 50vh);
    max-height: min(26rem, 50vh);
  }

  .ui-sales__detail {
    height: auto;
    min-height: 18rem;
  }

  .ui-sales__detail-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .ui-sales__detail-foot {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 720px) {
  .ui-page-head__actions {
    width: 100%;
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .ui-page-head__actions .ui-btn {
    width: 100%;
    justify-content: center;
  }

  .ui-sales__q,
  .ui-sales__select {
    flex: 1 1 100%;
    max-width: none;
  }

  .ui-sales__daybar {
    width: 100%;
  }

  .ui-sales__daybar :deep(.ui-date) {
    flex: 1 1 auto;
    width: auto;
    min-width: 0;
  }

  .ui-sales__stat {
    flex: 1 1 calc(50% - 0.45rem);
    min-width: 0;
  }

  .ui-sales--detail-open .ui-sales__list {
    display: none;
  }

  .ui-sales:not(.ui-sales--detail-open) .ui-sales__detail {
    display: none;
  }

  .ui-sales--detail-open .ui-sales__detail {
    min-height: min(70vh, 34rem);
  }

  .ui-sales__back {
    display: inline-flex;
  }

  .ui-sales__close-desk {
    display: none;
  }
}
</style>
