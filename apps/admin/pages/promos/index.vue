<script setup lang="ts">
import { paginateItems } from "~/utils/pagination";

type Promo = {
  id: string;
  productCode: string;
  buyQty: number;
  payAmount: number;
  label: string;
  active: boolean;
};

type ProductOption = {
  id: string;
  productCode?: string | null;
  barcode: string;
  name: string;
  price?: number | null;
  unit?: string;
};

type PromoForm = {
  productCode: string;
  buyQty: string;
  payAmount: string;
  label: string;
  active: boolean;
};

const emptyForm = (): PromoForm => ({
  productCode: "",
  buyQty: "3",
  payAmount: "100",
  label: "",
  active: true,
});

const { get, post } = useAdminApi();
const { askConfirm } = useConfirmDialog();
const pending = ref(false);
const saving = ref(false);
const error = ref("");
const q = ref("");
const statusFilter = ref<"" | "active" | "inactive">("");
const rows = ref<Promo[]>([]);
const products = ref<ProductOption[]>([]);
const modalOpen = ref(false);
const editingId = ref<string | null>(null);
const form = ref<PromoForm>(emptyForm());
const labelTouched = ref(false);

const activeCount = computed(() => rows.value.filter((r) => r.active).length);

const filtered = computed(() => {
  const s = q.value.trim().toLowerCase();
  return rows.value.filter((r) => {
    if (statusFilter.value === "active" && !r.active) return false;
    if (statusFilter.value === "inactive" && r.active) return false;
    if (!s) return true;
    const name = productName(r.productCode).toLowerCase();
    return (
      r.label.toLowerCase().includes(s) ||
      r.productCode.toLowerCase().includes(s) ||
      name.includes(s)
    );
  });
});

const page = ref(1);
const perPage = ref(20);
const paged = computed(() =>
  paginateItems(filtered.value, page.value, perPage.value),
);
const pageRows = computed(() => paged.value.rows);
const meta = computed(() => paged.value.meta);

const selectedProduct = computed(() => {
  const code = form.value.productCode.trim();
  if (!code) return null;
  return products.value.find((p) => (p.productCode ?? "").trim() === code) ?? null;
});

const previewLabel = computed(() => {
  const p = selectedProduct.value;
  if (!p) return "";
  return `${p.name} ${form.value.buyQty || "?"} ${p.unit || "ชิ้น"} ${form.value.payAmount || "?"} บาท`;
});

watch([q, statusFilter], () => {
  page.value = 1;
});

watch(
  () => [form.value.productCode, form.value.buyQty, form.value.payAmount],
  () => {
    if (editingId.value || labelTouched.value) return;
    if (previewLabel.value) form.value.label = previewLabel.value;
  },
);

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

function productName(code: string) {
  return (
    products.value.find((p) => (p.productCode ?? "").trim() === code)?.name ??
    code
  );
}

function applyPreviewLabel() {
  if (previewLabel.value) {
    form.value.label = previewLabel.value;
    labelTouched.value = false;
  }
}

async function load() {
  pending.value = true;
  error.value = "";
  try {
    const [promoData, productData] = await Promise.all([
      get<{ promos: Promo[] }>("/promos"),
      get<{ products: ProductOption[] }>("/products"),
    ]);
    rows.value = promoData.promos ?? [];
    products.value = productData.products ?? [];
  } catch (e) {
    error.value = e instanceof Error ? e.message : "โหลดโปรโมชันไม่สำเร็จ";
  } finally {
    pending.value = false;
  }
}

function openCreate() {
  editingId.value = null;
  form.value = emptyForm();
  labelTouched.value = false;
  error.value = "";
  modalOpen.value = true;
}

function openEdit(row: Promo) {
  editingId.value = row.id;
  form.value = {
    productCode: row.productCode,
    buyQty: String(row.buyQty),
    payAmount: String(row.payAmount),
    label: row.label,
    active: row.active,
  };
  labelTouched.value = true;
  error.value = "";
  modalOpen.value = true;
}

function closeModal() {
  modalOpen.value = false;
}

async function save() {
  const buyQty = Number(form.value.buyQty);
  const payAmount = Number(form.value.payAmount);
  if (!form.value.productCode.trim() || !form.value.label.trim()) {
    error.value = "กรุณาเลือกสินค้าและกรอกชื่อโปรโม";
    return;
  }
  if (!Number.isFinite(buyQty) || buyQty < 2) {
    error.value = "จำนวนที่ซื้อต้องอย่างน้อย 2";
    return;
  }
  if (!Number.isFinite(payAmount) || payAmount < 0) {
    error.value = "ยอดที่จ่ายไม่ถูกต้อง";
    return;
  }
  saving.value = true;
  error.value = "";
  try {
    const body = {
      productCode: form.value.productCode.trim(),
      buyQty,
      payAmount,
      label: form.value.label.trim(),
      active: form.value.active,
    };
    if (editingId.value) await post(`/promos/update`, { id: editingId.value, ...body });
    else await post("/promos", body);
    closeModal();
    await load();
  } catch (e: unknown) {
    const msg =
      (e as { data?: { message?: string | string[] } })?.data?.message ??
      (e as Error)?.message ??
      "บันทึกไม่สำเร็จ";
    error.value = Array.isArray(msg) ? msg.join(", ") : String(msg);
  } finally {
    saving.value = false;
  }
}

async function remove(row: Promo) {
  const ok = await askConfirm({
    title: "ลบโปรโมชัน",
    message: `ต้องการลบ 「${row.label}」 ใช่หรือไม่?`,
    detail: row.productCode ? `สินค้า ${row.productCode}` : undefined,
    confirmLabel: "ลบโปรโม",
  });
  if (!ok) return;
  saving.value = true;
  error.value = "";
  try {
    await post(`/promos/delete`, { id: row.id });
    await load();
  } catch (e: unknown) {
    const msg =
      (e as { data?: { message?: string | string[] } })?.data?.message ??
      (e as Error)?.message ??
      "ลบไม่สำเร็จ";
    error.value = Array.isArray(msg) ? msg.join(", ") : String(msg);
  } finally {
    saving.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div>
    <div class="ui-page-head">
      <div>
        <h1 class="ui-page-title">โปรโมชัน</h1>
        <p class="ui-page-sub">
          ซื้อ X จ่าย Y ตามรหัสสินค้า · sync ไป POS อัตโนมัติ
        </p>
      </div>
      <div class="ui-page-head__actions">
        <button type="button" class="ui-btn ui-btn--ghost" :disabled="pending" @click="load">
          {{ pending ? "กำลังโหลด..." : "รีเฟรช" }}
        </button>
        <button type="button" class="ui-btn ui-btn--primary" @click="openCreate">
          + เพิ่มโปรโม
        </button>
      </div>
    </div>

    <div class="ui-stat-grid" style="margin-bottom: 1rem; grid-template-columns: repeat(3, minmax(0, 1fr))">
      <div class="ui-card ui-stat">
        <div class="ui-stat__label">โปรโมทั้งหมด</div>
        <div class="ui-stat__value">{{ rows.length }}</div>
      </div>
      <div class="ui-card ui-stat">
        <div class="ui-stat__label">เปิดใช้งาน</div>
        <div class="ui-stat__value">{{ activeCount }}</div>
      </div>
      <div class="ui-card ui-stat">
        <div class="ui-stat__label">ปิดอยู่</div>
        <div class="ui-stat__value">{{ rows.length - activeCount }}</div>
      </div>
    </div>

    <div v-if="error && !modalOpen" class="ui-empty">{{ error }}</div>

    <div class="ui-card">
      <div class="ui-card__toolbar">
        <div class="ui-toolbar-search">
          <span class="ui-toolbar-search__meta">
            แสดง {{ meta.total }} จาก {{ rows.length }} รายการ
          </span>
          <div class="ui-toolbar-search__controls">
            <select v-model="statusFilter" class="ui-input" aria-label="สถานะ">
              <option value="">ทุกสถานะ</option>
              <option value="active">เปิดใช้งาน</option>
              <option value="inactive">ปิดอยู่</option>
            </select>
            <input
              v-model="q"
              class="ui-input"
              type="search"
              placeholder="ค้นหาชื่อ / รหัส / สินค้า..."
              aria-label="ค้นหาโปรโม"
            />
          </div>
        </div>
      </div>

      <div v-if="pending && !rows.length" class="ui-empty">กำลังโหลด...</div>
      <div v-else-if="!pageRows.length" class="ui-empty">
        {{ q.trim() || statusFilter ? "ไม่พบโปรโมที่ตรงเงื่อนไข" : "ยังไม่มีโปรโมชัน" }}
        <span v-if="!q.trim() && !statusFilter" class="ui-empty__hint">
          กด “เพิ่มโปรโม” เพื่อตั้ง เช่น ซื้อ 3 จ่าย 100 บาท
        </span>
      </div>
      <div v-else class="ui-table-wrap">
        <table class="ui-table ui-table--fit">
          <thead>
            <tr>
              <th>ชื่อโปรโม</th>
              <th>สินค้า</th>
              <th>ซื้อ</th>
              <th>จ่าย</th>
              <th>สถานะ</th>
              <th class="ui-table__actions">จัดการ</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in pageRows" :key="row.id">
              <td>
                <strong>{{ row.label }}</strong>
              </td>
              <td>
                <strong>{{ row.productCode }}</strong>
                <div class="ui-muted">{{ productName(row.productCode) }}</div>
              </td>
              <td>{{ row.buyQty }}</td>
              <td>{{ baht(row.payAmount) }}</td>
              <td>
                <span
                  class="ui-badge"
                  :class="row.active ? 'ui-badge--success' : 'ui-badge--muted'"
                >
                  {{ row.active ? "ใช้งาน" : "ปิด" }}
                </span>
              </td>
              <td class="ui-table__actions">
                <button type="button" class="ui-btn ui-btn--ghost" @click="openEdit(row)">
                  แก้ไข
                </button>
                <button
                  type="button"
                  class="ui-btn ui-btn--ghost-danger"
                  :disabled="saving"
                  @click="remove(row)"
                >
                  ลบ
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <UiPagination :meta="meta" @change="onPageChange" />
    </div>

    <div v-if="modalOpen" class="ui-modal">
      <div class="ui-modal__panel ui-modal__panel--xl" role="dialog" aria-modal="true">
        <div class="ui-modal__head">
          <h2>{{ editingId ? "แก้ไขโปรโม" : "เพิ่มโปรโม" }}</h2>
          <button class="ui-icon-btn" type="button" @click="closeModal">×</button>
        </div>
        <div class="ui-modal__body">
          <div class="ui-form-grid">
            <div class="ui-field" style="grid-column: 1 / -1">
              <span>สินค้า *</span>
              <UiProductPicker
                v-model="form.productCode"
                :products="products"
                placeholder="ค้นหาชื่อ / รหัสสินค้า..."
              />
              <p v-if="selectedProduct" class="ui-field-hint">
                ราคาปกติ
                {{
                  selectedProduct.price == null
                    ? "เปิดราคา"
                    : `${selectedProduct.price.toFixed(2)} บาท`
                }}
                / {{ selectedProduct.unit || "ชิ้น" }}
              </p>
            </div>
            <label class="ui-field">
              <span>ซื้อกี่ชิ้น *</span>
              <input v-model="form.buyQty" class="ui-input" type="number" min="2" step="1" />
            </label>
            <label class="ui-field">
              <span>จ่ายกี่บาท *</span>
              <input
                v-model="form.payAmount"
                class="ui-input"
                type="number"
                min="0"
                step="0.01"
              />
            </label>
            <div class="ui-field" style="grid-column: 1 / -1">
              <span>ชื่อโปรโม *</span>
              <div class="ui-field-with-action">
                <input
                  v-model="form.label"
                  class="ui-input"
                  type="text"
                  placeholder="เช่น ผักกาดขาว 3 ชิ้น 100 บาท"
                  @input="labelTouched = true"
                />
                <button
                  type="button"
                  class="ui-btn ui-btn--ghost"
                  title="สร้างชื่อจากสินค้าอัตโนมัติ"
                  :disabled="!previewLabel"
                  @click="applyPreviewLabel"
                >
                  สร้างชื่อ
                </button>
              </div>
              <p class="ui-field-hint">ชื่อนี้โชว์บนจอ POS ตอนคิดโปรโม</p>
            </div>
            <label class="ui-field ui-field--check">
              <input v-model="form.active" type="checkbox" />
              <span>เปิดใช้งานทันที</span>
            </label>
          </div>
          <p v-if="error" class="ui-field-hint" style="color: #b91c1c">{{ error }}</p>
        </div>
        <div class="ui-modal__foot">
          <button type="button" class="ui-btn ui-btn--ghost" @click="closeModal">ยกเลิก</button>
          <button
            type="button"
            class="ui-btn ui-btn--primary"
            :disabled="saving"
            @click="save"
          >
            {{ saving ? "กำลังบันทึก..." : "บันทึก" }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
