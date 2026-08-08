<script setup lang="ts">
import { paginateItems } from "~/utils/pagination";
import {
  exportProductsExcel,
  parseProductsPriceExcel,
} from "~/utils/product-excel";
import { actualMarginPct, suggestedSellPrice } from "@ap-pos/shared";

type Product = {
  id: string;
  barcode: string;
  productCode?: string | null;
  name: string;
  unit: string;
  costPrice: number | null;
  price: number | null;
  isQuick: boolean;
  quickSort: number;
  isOpenPrice: boolean;
  openPriceMax: number;
  active: boolean;
  imageUrl?: string | null;
};

type ProductForm = {
  barcode: string;
  productCode: string;
  name: string;
  unit: string;
  costPrice: string | number;
  price: string | number;
  isQuick: boolean;
  quickSort: string | number;
  isOpenPrice: boolean;
  openPriceMax: string | number;
  active: boolean;
};

type ProductUnit = { id: string; name: string };

const emptyForm = (): ProductForm => ({
  barcode: "",
  productCode: "",
  name: "",
  unit: "ชิ้น",
  costPrice: "",
  price: "",
  isQuick: false,
  quickSort: "999",
  isOpenPrice: false,
  openPriceMax: "100",
  active: true,
});

const { get, post, patch, del, upload, assetUrl } = useAdminApi();
const { askConfirm } = useConfirmDialog();
const pending = ref(false);
const saving = ref(false);
const error = ref("");
const q = ref("");
/** all | fresh (บาร์โค้ดขึ้นต้น 9) | general | quick (สินค้าด่วน) */
const category = ref<"all" | "fresh" | "general" | "quick">("all");
/** "" | active | inactive */
const statusFilter = ref<"" | "active" | "inactive">("");
/** % กำไรขั้นต้นที่ใช้คำนวณราคาแนะนำ (บนราคาขาย) */
const marginPct = ref(40);
const savedMarginPct = ref(40);
const savingMargin = ref(false);
const marginMsg = ref("");

const marginDirty = computed(
  () => Number(marginPct.value) !== Number(savedMarginPct.value),
);
const rows = ref<Product[]>([]);
const units = ref<ProductUnit[]>([]);
const modalOpen = ref(false);
const editingId = ref<string | null>(null);
/** กลับไปหน้าเดิมหลังปิด/บันทึก เช่น /products/quick */
const returnTo = ref<string | null>(null);
const form = ref<ProductForm>(emptyForm());
const unitOpen = ref(false);
const imageUrl = ref<string | null>(null);
const imageFile = ref<File | null>(null);
const imagePreview = ref("");
const removeImage = ref(false);

const fileInput = ref<HTMLInputElement | null>(null);
const importInput = ref<HTMLInputElement | null>(null);
const importing = ref(false);
const exportBusy = ref(false);
const importMsg = ref("");

const unitSuggestions = computed(() => {
  const s = form.value.unit.trim().toLowerCase();
  const list = units.value.map((u) => u.name);
  if (!s) return list.slice(0, 12);
  return list.filter((name) => name.toLowerCase().includes(s)).slice(0, 12);
});

const unitIsNew = computed(() => {
  const s = form.value.unit.trim();
  if (!s) return false;
  return !units.value.some((u) => u.name.toLowerCase() === s.toLowerCase());
});

function isFreshProduct(barcode: string | null | undefined) {
  return String(barcode ?? "").trim().startsWith("9");
}

function numField(v: string | number | null | undefined): number | null {
  if (v == null) return null;
  const s = String(v).trim();
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

const formSuggested = computed(() => {
  if (!isFreshProduct(form.value.barcode)) return null;
  return suggestedSellPrice(numField(form.value.costPrice), marginPct.value);
});

const formActualMargin = computed(() => {
  if (form.value.isOpenPrice) return null;
  return actualMarginPct(
    numField(form.value.costPrice),
    numField(form.value.price),
  );
});

const formProfitBaht = computed(() => {
  if (form.value.isOpenPrice) return null;
  const cost = numField(form.value.costPrice);
  const sell = numField(form.value.price);
  if (cost == null || sell == null) return null;
  return Math.round((sell - cost) * 100) / 100;
});

const formIsFresh = computed(() => isFreshProduct(form.value.barcode));

const filtered = computed(() => {
  let list = [...rows.value];
  if (category.value === "fresh") {
    list = list.filter((p) => isFreshProduct(p.barcode));
  } else if (category.value === "general") {
    list = list.filter((p) => !isFreshProduct(p.barcode));
  } else if (category.value === "quick") {
    list = list.filter((p) => p.isQuick);
  }
  if (statusFilter.value === "active") {
    list = list.filter((p) => p.active !== false);
  } else if (statusFilter.value === "inactive") {
    list = list.filter((p) => p.active === false);
  }
  const s = q.value.trim().toLowerCase();
  if (s) {
    list = list.filter(
      (p) =>
        p.name.toLowerCase().includes(s) ||
        p.barcode.toLowerCase().includes(s) ||
        (p.productCode ?? "").toLowerCase().includes(s),
    );
  }
  // ของสด (บาร์โค้ดขึ้นต้น 9) ขึ้นก่อน แล้วเรียงชื่อ
  return list.sort((a, b) => {
    const af = isFreshProduct(a.barcode) ? 0 : 1;
    const bf = isFreshProduct(b.barcode) ? 0 : 1;
    if (af !== bf) return af - bf;
    return a.name.localeCompare(b.name, "th");
  });
});

const categoryLabel = computed(() => {
  if (category.value === "fresh") return "ของสด";
  if (category.value === "general") return "ทั่วไป";
  if (category.value === "quick") return "สินค้าด่วน";
  return "ทั้งหมด";
});

const statusLabel = computed(() => {
  if (statusFilter.value === "active") return "ใช้งาน";
  if (statusFilter.value === "inactive") return "ไม่ใช้งาน";
  return "ทุกสถานะ";
});

const page = ref(1);
const perPage = ref(20);
const paged = computed(() =>
  paginateItems(filtered.value, page.value, perPage.value),
);
const pageRows = computed(() => paged.value.rows);
const meta = computed(() => paged.value.meta);

watch([q, category, statusFilter], () => {
  page.value = 1;
});

function onPageChange(payload: { page: number; per_page: number }) {
  page.value = payload.page;
  perPage.value = payload.per_page;
}

function baht(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return "-";
  return n.toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function suggestOf(row: Product) {
  if (!isFreshProduct(row.barcode)) return null;
  return suggestedSellPrice(row.costPrice, marginPct.value);
}

function marginOf(row: Product) {
  if (row.isOpenPrice) return null;
  return actualMarginPct(row.costPrice, row.price);
}

/** กำไรเป็นบาท = ขาย − ทุน */
function profitBahtOf(row: Product) {
  if (row.isOpenPrice) return null;
  const cost = Number(row.costPrice);
  const sell = Number(row.price);
  if (!Number.isFinite(cost) || !Number.isFinite(sell)) return null;
  return Math.round((sell - cost) * 100) / 100;
}

function marginTone(row: Product) {
  const m = marginOf(row);
  if (m == null) return "";
  if (m + 0.05 < marginPct.value) return "is-short";
  if (m > marginPct.value + 0.05) return "is-over";
  return "is-ok";
}

function applySuggestedPrice() {
  if (formSuggested.value == null) return;
  form.value.price = String(formSuggested.value);
}

function exportExcel() {
  exportBusy.value = true;
  importMsg.value = "";
  try {
    const list = filtered.value.length ? filtered.value : rows.value;
    exportProductsExcel(
      list.map((p) => ({
        barcode: p.barcode,
        productCode: p.productCode,
        name: p.name,
        unit: p.unit,
        costPrice: p.costPrice,
        price: p.price,
      })),
    );
    importMsg.value = `Export แล้ว ${list.length} รายการ — แก้คอลัมน์ราคาทุน/ราคาขาย แล้ว Import กลับ`;
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Export ไม่สำเร็จ";
  } finally {
    exportBusy.value = false;
  }
}

function pickImportFile() {
  importInput.value?.click();
}

async function onImportExcel(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;

  importing.value = true;
  error.value = "";
  importMsg.value = "";
  try {
    const buf = await file.arrayBuffer();
    const parsed = parseProductsPriceExcel(buf);
    if (!parsed.length) {
      error.value =
        "ไม่พบแถวที่แก้ราคา — ใส่ตัวเลขในคอลัมน์ราคาทุนหรือราคาขาย (เซลล์ว่าง = ไม่แก้)";
      return;
    }
    const result = await post<{
      updated: number;
      skipped: number;
      notFound: string[];
    }>("/products/bulk-prices", { rows: parsed });

    const miss = result.notFound?.length
      ? ` · ไม่พบ ${result.notFound.length} รายการ${
          result.notFound.length <= 5
            ? ` (${result.notFound.join(", ")})`
            : ` (เช่น ${result.notFound.slice(0, 3).join(", ")}…)`
        }`
      : "";
    importMsg.value = `Import เสร็จ — อัปเดต ${result.updated} รายการ${miss}`;
    await load();
  } catch (err) {
    error.value =
      err instanceof Error ? err.message : "Import ไม่สำเร็จ";
  } finally {
    importing.value = false;
  }
}

async function load() {
  pending.value = true;
  error.value = "";
  try {
    const [prod, unitData, pricing] = await Promise.all([
      get<{ products: Product[] }>("/products"),
      get<{ units: ProductUnit[] }>("/units"),
      get<{ freshSuggestedMarginPct: number }>("/settings/pricing").catch(
        () => null,
      ),
    ]);
    rows.value = (prod.products ?? []).map((p) => ({
      ...p,
      active: p.active !== false,
    }));
    units.value = unitData.units ?? [];
    if (pricing?.freshSuggestedMarginPct) {
      marginPct.value = pricing.freshSuggestedMarginPct;
      savedMarginPct.value = pricing.freshSuggestedMarginPct;
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : "โหลดสินค้าไม่สำเร็จ";
  } finally {
    pending.value = false;
  }
}

async function saveMarginPct() {
  const m = Number(marginPct.value);
  if (!Number.isFinite(m) || m <= 0 || m >= 100) {
    error.value = "กำไรแนะนำต้องอยู่ระหว่าง 1–99%";
    return;
  }
  savingMargin.value = true;
  error.value = "";
  marginMsg.value = "";
  try {
    const data = await patch<{ freshSuggestedMarginPct: number }>(
      "/settings/pricing",
      { freshSuggestedMarginPct: m },
    );
    marginPct.value = data.freshSuggestedMarginPct;
    savedMarginPct.value = data.freshSuggestedMarginPct;
    marginMsg.value = `บันทึกกำไรแนะนำ ${data.freshSuggestedMarginPct}% แล้ว`;
  } catch (e) {
    error.value = e instanceof Error ? e.message : "บันทึกกำไรแนะนำไม่สำเร็จ";
  } finally {
    savingMargin.value = false;
  }
}

async function openCreate() {
  editingId.value = null;
  form.value = emptyForm();
  unitOpen.value = false;
  imageUrl.value = null;
  imageFile.value = null;
  imagePreview.value = "";
  removeImage.value = false;
  try {
    const next = await get<{ productCode: string }>("/products/next-code");
    form.value.productCode = next.productCode;
  } catch {
    // server จะออกเลขให้อีกทีตอนบันทึก
  }
  modalOpen.value = true;
}

function openEdit(row: Product) {
  editingId.value = row.id;
  form.value = {
    barcode: row.barcode,
    productCode: row.productCode ?? "",
    name: row.name,
    unit: row.unit,
    costPrice: row.costPrice == null ? "" : String(row.costPrice),
    price: row.price == null ? "" : String(row.price),
    isQuick: row.isQuick,
    quickSort: String(row.quickSort ?? 999),
    isOpenPrice: row.isOpenPrice,
    openPriceMax: String(row.openPriceMax ?? 100),
    active: row.active !== false,
  };
  unitOpen.value = false;
  imageUrl.value = row.imageUrl ?? null;
  imageFile.value = null;
  imagePreview.value = row.imageUrl ? assetUrl(row.imageUrl) : "";
  removeImage.value = false;
  modalOpen.value = true;
}

function closeModal() {
  modalOpen.value = false;
  unitOpen.value = false;
  imageFile.value = null;
  if (imagePreview.value.startsWith("blob:")) {
    URL.revokeObjectURL(imagePreview.value);
  }
  imagePreview.value = "";
  const back = returnTo.value;
  returnTo.value = null;
  if (back) {
    void navigateTo(back);
  }
}

function onPickImage(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0] ?? null;
  if (imagePreview.value.startsWith("blob:")) {
    URL.revokeObjectURL(imagePreview.value);
  }
  imageFile.value = file;
  removeImage.value = false;
  imagePreview.value = file
    ? URL.createObjectURL(file)
    : assetUrl(imageUrl.value);
}

function clearPickedImage() {
  if (imagePreview.value.startsWith("blob:")) {
    URL.revokeObjectURL(imagePreview.value);
  }
  imageFile.value = null;
  removeImage.value = true;
  imagePreview.value = "";
  if (fileInput.value) fileInput.value.value = "";
}

function pickUnit(name: string) {
  form.value.unit = name;
  unitOpen.value = false;
}

function toPayload() {
  const f = form.value;
  return {
    barcode: String(f.barcode ?? "").trim(),
    productCode: String(f.productCode ?? "").trim() || undefined,
    name: String(f.name ?? "").trim(),
    unit: String(f.unit ?? "").trim() || "ชิ้น",
    costPrice: numField(f.costPrice),
    price: numField(f.price),
    isQuick: f.isQuick && f.active,
    quickSort: Number(f.quickSort) || 999,
    isOpenPrice: f.isOpenPrice,
    openPriceMax: Number(f.openPriceMax) || 100,
    active: f.active,
  };
}

async function save() {
  if (!String(form.value.name ?? "").trim() || !String(form.value.barcode ?? "").trim()) {
    error.value = "กรุณากรอกชื่อและบาร์โค้ด";
    return;
  }
  saving.value = true;
  error.value = "";
  try {
    const body = toPayload();
    let id = editingId.value;
    if (id) {
      await patch(`/products/${id}`, body);
    } else {
      const created = await post<Product>("/products", body);
      id = created.id;
    }

    if (id && imageFile.value) {
      const fd = new FormData();
      fd.append("file", imageFile.value);
      await upload(`/products/${id}/image`, fd);
    } else if (id && removeImage.value && imageUrl.value) {
      await del(`/products/${id}/image`);
    }

    closeModal();
    await load();
  } catch (e) {
    error.value = e instanceof Error ? e.message : "บันทึกไม่สำเร็จ";
  } finally {
    saving.value = false;
  }
}

async function remove(row: Product) {
  const ok = await askConfirm({
    title: "ลบสินค้า",
    message: `ต้องการลบ 「${row.name}」 ใช่หรือไม่?`,
    detail: "หลังลบ สินค้าจะหายจาก POS เมื่อ sync รอบถัดไป",
    confirmLabel: "ลบสินค้า",
  });
  if (!ok) return;
  saving.value = true;
  error.value = "";
  try {
    await del(`/products/${row.id}`);
    await load();
  } catch (e) {
    error.value = e instanceof Error ? e.message : "ลบไม่สำเร็จ";
  } finally {
    saving.value = false;
  }
}

async function openEditById(id: string) {
  const row = rows.value.find((p) => p.id === id);
  if (row) {
    openEdit(row);
    return;
  }
  // ถ้าไม่อยู่ในลิสต์ที่โหลด (หรือยังไม่โหลด) ดึงทีละรายการ
  try {
    const p = await get<Product>(`/products/${id}`);
    openEdit(p);
  } catch {
    error.value = "ไม่พบสินค้าที่ต้องการแก้ไข";
  }
}

onMounted(async () => {
  await load();
  const route = useRoute();
  const editId = String(route.query.edit ?? "").trim();
  const from = String(route.query.from ?? "").trim();
  if (from === "quick") {
    returnTo.value = "/products/quick";
  }
  if (editId) {
    await openEditById(editId);
    await navigateTo({ path: "/products", query: {} }, { replace: true });
  }
});
</script>

<template>
  <div>
    <div class="ui-page-head">
      <div>
        <h1 class="ui-page-title">สินค้า</h1>
        <p class="ui-page-sub">
          ราคาทุน · ราคาขาย · กำไรจริงทุกรายการ · แนะนำกำไรเฉพาะของสด (บาร์โค้ดขึ้นต้น 9)
        </p>
      </div>
      <div class="ui-page-head__actions">
        <NuxtLink to="/products/quick" class="ui-btn ui-btn--ghost">จัดสินค้าด่วน</NuxtLink>
        <button
          type="button"
          class="ui-btn ui-btn--ghost"
          :disabled="exportBusy || !rows.length"
          @click="exportExcel"
        >
          {{ exportBusy ? "กำลัง Export..." : "Export Excel" }}
        </button>
        <button
          type="button"
          class="ui-btn ui-btn--ghost"
          :disabled="importing"
          @click="pickImportFile"
        >
          {{ importing ? "กำลัง Import..." : "Import Excel" }}
        </button>
        <input
          ref="importInput"
          type="file"
          accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
          hidden
          @change="onImportExcel"
        />
        <button type="button" class="ui-btn ui-btn--ghost" :disabled="pending" @click="load">
          {{ pending ? "กำลังโหลด..." : "รีเฟรช" }}
        </button>
        <button type="button" class="ui-btn ui-btn--primary" @click="openCreate">
          + เพิ่มสินค้า
        </button>
      </div>
    </div>

    <div class="ui-card ui-filter-bar">
      <label class="ui-list-filters__field">
        <span class="ui-list-filters__label">หมวด</span>
        <select v-model="category" class="ui-input ui-list-filters__input">
          <option value="all">ทั้งหมด</option>
          <option value="fresh">ของสด (ขึ้นต้น 9)</option>
          <option value="general">ทั่วไป</option>
          <option value="quick">สินค้าด่วน</option>
        </select>
      </label>
      <label class="ui-list-filters__field">
        <span class="ui-list-filters__label">สถานะ</span>
        <select v-model="statusFilter" class="ui-input ui-list-filters__input">
          <option value="">ทั้งหมด</option>
          <option value="active">ใช้งาน</option>
          <option value="inactive">ไม่ใช้งาน</option>
        </select>
      </label>
      <label class="ui-list-filters__field">
        <span class="ui-list-filters__label">คำค้น</span>
        <input
          v-model="q"
          class="ui-input ui-list-filters__input"
          type="search"
          placeholder="ชื่อ / บาร์โค้ด / รหัสสินค้า"
        />
      </label>
      <label class="ui-list-filters__field">
        <span class="ui-list-filters__label">กำไรแนะนำ % (ของสด)</span>
        <div style="display: flex; gap: 0.4rem; align-items: center">
          <input
            v-model.number="marginPct"
            class="ui-input ui-list-filters__input"
            type="number"
            min="1"
            max="99"
            step="1"
            style="width: 5.5rem"
          />
          <button
            type="button"
            class="ui-btn"
            :class="marginDirty ? 'ui-btn--primary' : 'ui-btn--ghost'"
            :disabled="savingMargin || !marginDirty"
            @click="saveMarginPct"
          >
            {{ savingMargin ? "กำลังบันทึก..." : "บันทึก" }}
          </button>
        </div>
      </label>
    </div>
    <p class="ui-field-hint" style="margin: 0.35rem 0 0.75rem">
      วิธีคิด: กำไรจริง % = (ขาย − ทุน) ÷ ขาย × 100 · เช่น ทุน 156 ขาย 195 → กำไร 20%
      · ราคาแนะนำ = ทุน ÷ (1 − {{ marginPct }}/100) · เช่น ทุน 156 เป้า {{ marginPct }}% → ขาย
      {{
        suggestedSellPrice(156, marginPct) == null
          ? "-"
          : baht(suggestedSellPrice(156, marginPct))
      }}
    </p>

    <div v-if="error && !modalOpen" class="ui-empty">{{ error }}</div>
    <div v-else-if="marginMsg && !modalOpen" class="ui-empty" style="color: #166534">
      {{ marginMsg }}
    </div>
    <div v-else-if="importMsg && !modalOpen" class="ui-empty" style="color: #166534">
      {{ importMsg }}
    </div>

    <div class="ui-card">
      <div class="ui-card__toolbar">
        <span class="ui-toolbar-meta ui-toolbar-meta--alone">
          สินค้า {{ meta.total }} รายการ ({{ categoryLabel }} · {{ statusLabel }})
          · แนะนำกำไร {{ marginPct }}% เฉพาะของสด
          · Export ตามรายการที่กรอง → Import กลับ (จับคู่บาร์โค้ด)
        </span>
      </div>
      <div v-if="pending && !rows.length" class="ui-empty">กำลังโหลด...</div>
      <div v-else-if="!pageRows.length" class="ui-empty">ไม่พบข้อมูล</div>
      <div v-else class="ui-table-wrap">
        <table class="ui-table ui-table--fit">
          <thead>
            <tr>
              <th class="ui-table__col-barcode">บาร์โค้ด</th>
              <th>รหัส</th>
              <th class="ui-table__col-name">ชื่อ</th>
              <th>หน่วย</th>
              <th>ทุน</th>
              <th>ขาย / กำไร</th>
              <th>แนะนำ {{ marginPct }}%</th>
              <th>กำไรจริง</th>
              <th class="ui-table__col-flag">ด่วน</th>
              <th class="ui-table__col-status" title="สถานะ">●</th>
              <th class="ui-table__actions">จัดการ</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in pageRows" :key="row.id">
              <td class="ui-table__col-barcode" :title="row.barcode">
                {{ row.barcode }}
              </td>
              <td>{{ row.productCode || "-" }}</td>
              <td class="ui-table__col-name" :title="row.name">{{ row.name }}</td>
              <td>{{ row.unit }}</td>
              <td>{{ baht(row.costPrice) }}</td>
              <td>
                <template v-if="row.isOpenPrice">
                  เปิด ≤{{ row.openPriceMax }}
                </template>
                <template v-else>
                  <div>{{ baht(row.price) }}</div>
                  <div
                    v-if="profitBahtOf(row) != null"
                    class="ui-field-hint"
                    style="margin: 0.15rem 0 0"
                    :class="marginTone(row)"
                  >
                    กำไร {{ baht(profitBahtOf(row)) }}
                  </div>
                </template>
              </td>
              <td>{{ baht(suggestOf(row)) }}</td>
              <td :class="marginTone(row)">
                {{
                  marginOf(row) == null ? "-" : `${marginOf(row)?.toFixed(1)}%`
                }}
              </td>
              <td class="ui-table__col-flag">{{ row.isQuick ? "ใช่" : "-" }}</td>
              <td class="ui-table__col-status">
                <span
                  class="ui-status-dot"
                  :class="row.active !== false ? 'is-on' : 'is-off'"
                  :title="row.active !== false ? 'ใช้งาน' : 'ไม่ใช้งาน'"
                />
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
      <div
        class="ui-modal__panel ui-modal__panel--wide ui-product-modal"
        role="dialog"
        aria-modal="true"
      >
        <div class="ui-modal__head">
          <h2>{{ editingId ? "แก้ไขสินค้า" : "เพิ่มสินค้า" }}</h2>
          <button class="ui-icon-btn" type="button" title="ปิด" @click="closeModal">×</button>
        </div>
        <div class="ui-modal__body ui-product-modal__body">
          <div class="ui-product-modal__layout">
            <div class="ui-product-modal__media">
              <div class="ui-product-modal__preview">
                <img v-if="imagePreview" :src="imagePreview" alt="" />
                <span v-else>ไม่มีรูป</span>
              </div>
              <div class="ui-product-modal__media-actions">
                <label class="ui-btn ui-btn--ghost ui-product-image__pick">
                  เลือกรูป
                  <input
                    ref="fileInput"
                    type="file"
                    accept="image/*"
                    hidden
                    @change="onPickImage"
                  />
                </label>
                <button
                  v-if="imagePreview"
                  type="button"
                  class="ui-btn ui-btn--ghost"
                  @click="clearPickedImage"
                >
                  ลบรูป
                </button>
              </div>
              <p class="ui-field-hint" style="margin-top: 0.5rem">
                แนะนำรูป <strong>สี่เหลี่ยมจัตุรัส 1:1</strong>
                (เช่น 400×400 หรือ 512×512) · วางสินค้าตรงกลาง ·
                POS สินค้าด่วนจะครอปเต็มช่อง
              </p>
            </div>

            <div class="ui-product-modal__fields">
              <div class="ui-product-modal__grid">
                <label class="ui-field ui-product-modal__span2">
                  <span>ชื่อ *</span>
                  <input v-model="form.name" class="ui-input" type="text" />
                </label>
                <label class="ui-field">
                  <span>บาร์โค้ด *</span>
                  <input v-model="form.barcode" class="ui-input" type="text" />
                </label>
                <label class="ui-field">
                  <span>รหัส</span>
                  <input
                    v-model="form.productCode"
                    class="ui-input"
                    type="text"
                    readonly
                    title="ออกเลขอัตโนมัติ"
                  />
                </label>
                <div class="ui-field ui-unit-field">
                  <span>หน่วย</span>
                  <div class="ui-unit-combo">
                    <input
                      v-model="form.unit"
                      class="ui-input"
                      type="text"
                      placeholder="เลือกหรือพิมพ์หน่วยใหม่"
                      autocomplete="off"
                      @focus="unitOpen = true"
                      @input="unitOpen = true"
                      @blur="unitOpen = false"
                    />
                    <ul
                      v-if="unitOpen && unitSuggestions.length"
                      class="ui-unit-suggest"
                      @mousedown.prevent
                    >
                      <li
                        v-for="name in unitSuggestions"
                        :key="name"
                        @mousedown="pickUnit(name)"
                      >
                        {{ name }}
                      </li>
                    </ul>
                  </div>
                </div>
                <label class="ui-field">
                  <span>ลำดับด่วน</span>
                  <input v-model="form.quickSort" class="ui-input" type="number" min="0" />
                </label>
              </div>

              <div class="ui-product-modal__price">
                <label class="ui-field">
                  <span>ทุน</span>
                  <input
                    v-model="form.costPrice"
                    class="ui-input"
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="156"
                  />
                </label>
                <label class="ui-field">
                  <span>ขาย</span>
                  <input
                    v-model="form.price"
                    class="ui-input"
                    type="number"
                    step="0.01"
                    min="0"
                    :disabled="form.isOpenPrice"
                  />
                </label>
                <div v-if="formIsFresh" class="ui-field ui-product-modal__suggest">
                  <span>แนะนำ {{ marginPct }}%</span>
                  <div class="ui-field-with-action">
                    <input
                      class="ui-input"
                      type="text"
                      readonly
                      :value="
                        formSuggested == null ? 'ใส่ทุนก่อน' : baht(formSuggested)
                      "
                    />
                    <button
                      type="button"
                      class="ui-btn ui-btn--ghost"
                      :disabled="formSuggested == null || form.isOpenPrice"
                      @click="applySuggestedPrice"
                    >
                      ใช้
                    </button>
                  </div>
                </div>
                <p v-else class="ui-field-hint ui-product-modal__margin-note">
                  ของทั่วไปไม่มีราคาแนะนำ
                </p>
              </div>

              <p v-if="formActualMargin != null || formProfitBaht != null" class="ui-field-hint" style="margin: 0">
                <template v-if="formProfitBaht != null">
                  กำไร {{ baht(formProfitBaht) }} บาท
                </template>
                <template v-if="formActualMargin != null">
                  · {{ formActualMargin.toFixed(1) }}%
                  (= (ขาย−ทุน)÷ขาย)
                </template>
                <template v-if="formIsFresh">
                  · แนะนำ = ทุน÷(1−{{ marginPct }}/100)
                </template>
              </p>

              <div class="ui-product-modal__flags">
                <label class="ui-field ui-field--check">
                  <input v-model="form.active" type="checkbox" />
                  <span>ใช้งาน</span>
                </label>
                <label class="ui-field ui-field--check">
                  <input v-model="form.isQuick" type="checkbox" :disabled="!form.active" />
                  <span>สินค้าด่วน</span>
                </label>
                <label class="ui-field ui-field--check">
                  <input v-model="form.isOpenPrice" type="checkbox" />
                  <span>เปิดราคา</span>
                </label>
                <label v-if="form.isOpenPrice" class="ui-field" style="min-width: 8rem">
                  <span>เพดานเปิดราคา</span>
                  <input
                    v-model="form.openPriceMax"
                    class="ui-input"
                    type="number"
                    min="1"
                    step="1"
                  />
                </label>
              </div>
              <p v-if="!form.active" class="ui-field-hint" style="margin: 0">
                สินค้าไม่ใช้งานจะไม่แสดงบน POS หลัง sync
              </p>
            </div>
          </div>
          <p v-if="error" class="ui-field-hint" style="color: #b91c1c; margin-top: 0.5rem">
            {{ error }}
          </p>
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

<style scoped>
.is-short {
  color: #c0392b;
  font-variant-numeric: tabular-nums;
}
.is-over {
  color: #1e8449;
  font-variant-numeric: tabular-nums;
}
.is-ok {
  color: #2c3e50;
  font-variant-numeric: tabular-nums;
}

.ui-table__col-status {
  width: 2rem;
  text-align: center;
  vertical-align: middle;
}
.ui-status-dot {
  display: inline-block;
  width: 0.55rem;
  height: 0.55rem;
  border-radius: 50%;
  vertical-align: middle;
}
.ui-status-dot.is-on {
  background: #16a34a;
}
.ui-status-dot.is-off {
  background: #cbd5e1;
}

.ui-product-modal {
  display: flex;
  flex-direction: column;
  max-height: min(92vh, 40rem);
  overflow: hidden;
}
.ui-product-modal__body {
  flex: 1 1 auto;
  overflow: auto;
  padding-top: 0.85rem;
  padding-bottom: 0.85rem;
}
.ui-product-modal__layout {
  display: grid;
  grid-template-columns: 6.5rem minmax(0, 1fr);
  gap: 1rem;
  align-items: start;
}
.ui-product-modal__media {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}
.ui-product-modal__preview {
  width: 6.5rem;
  height: 6.5rem;
  border-radius: 0.75rem;
  border: 1px dashed #cbd5e1;
  background: #f8fafc;
  overflow: hidden;
  display: grid;
  place-items: center;
  color: #94a3b8;
  font-size: 0.75rem;
}
.ui-product-modal__preview img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.ui-product-modal__media-actions {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}
.ui-product-modal__media-actions .ui-btn {
  width: 100%;
  justify-content: center;
  padding: 0.35rem 0.5rem;
  font-size: 0.8rem;
}
.ui-product-modal__fields {
  display: flex;
  flex-direction: column;
  gap: 0.7rem;
  min-width: 0;
}
.ui-product-modal__grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.55rem 0.75rem;
}
.ui-product-modal__span2 {
  grid-column: 1 / -1;
}
.ui-product-modal__price {
  display: grid;
  grid-template-columns: 1fr 1fr 1.4fr;
  gap: 0.55rem 0.75rem;
  align-items: end;
  padding: 0.65rem 0.75rem;
  border-radius: 0.75rem;
  background: #f8fafc;
  border: 1px solid #eef2f6;
}
.ui-product-modal__suggest .ui-field-with-action {
  display: flex;
  gap: 0.35rem;
}
.ui-product-modal__margin-note {
  margin: 0;
  align-self: center;
}
.ui-product-modal__flags {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem 1.25rem;
  align-items: end;
}
.ui-product-modal__flags .ui-field--check {
  margin: 0;
}
@media (max-width: 640px) {
  .ui-product-modal__layout {
    grid-template-columns: 1fr;
  }
  .ui-product-modal__media {
    flex-direction: row;
    align-items: center;
  }
  .ui-product-modal__media-actions {
    flex-direction: row;
  }
  .ui-product-modal__media-actions .ui-btn {
    width: auto;
  }
  .ui-product-modal__price {
    grid-template-columns: 1fr 1fr;
  }
  .ui-product-modal__suggest {
    grid-column: 1 / -1;
  }
}
</style>
