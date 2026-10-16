<script setup lang="ts">
type Branch = { id: string; code: string; name: string };
type Category = { id: string; name: string; active: boolean };
type Expense = {
  id: string;
  branchId: string | null;
  categoryId: string;
  categoryName?: string;
  amount: number;
  description: string | null;
  paidFrom: "drawer" | "external";
  spentAt: string;
  staffName: string | null;
  note: string | null;
};

const { get, post } = useAdminApi();
const { askConfirm } = useConfirmDialog();

const {
  todayIso,
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

const pending = ref(false);
const saving = ref(false);
const error = ref("");
const branches = ref<Branch[]>([]);
const categories = ref<Category[]>([]);
const rows = ref<Expense[]>([]);
const editingId = ref<string | null>(null);

const filters = reactive({
  branchId: "",
  paidFrom: "" as "" | "drawer" | "external",
  categoryId: "",
});

function onDateMode(mode: "day" | "range") {
  setDateMode(mode);
  void load();
}

const form = reactive({
  branchId: "",
  categoryId: "",
  amount: "",
  description: "",
  paidFrom: "external" as "drawer" | "external",
  spentAt: todayIso(),
  note: "",
});

function baht(n: number) {
  return n.toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function branchName(id: string | null) {
  if (!id) return "กลาง";
  return branches.value.find((b) => b.id === id)?.name ?? "กลาง";
}

function preferredCategoryId() {
  return (
    categories.value.find((c) => c.name === "ซื้อของ")?.id ||
    categories.value[0]?.id ||
    ""
  );
}

function paidLabel(v: string) {
  return v === "external" ? "นอกลิ้นชัก" : "ลิ้นชัก POS";
}

function fmtAt(iso: string) {
  return new Date(iso).toLocaleString("th-TH");
}

async function loadMeta() {
  const [b, c] = await Promise.all([
    get<{ branches: Branch[] }>("/branches"),
    get<{ categories: Category[] }>("/expense-categories?all=1"),
  ]);
  branches.value = b.branches ?? [];
  categories.value = (c.categories ?? []).filter((x) => x.active !== false);
  if (!form.categoryId) form.categoryId = preferredCategoryId();
}

async function load() {
  pending.value = true;
  error.value = "";
  try {
    const qs = new URLSearchParams();
    qs.set("from", rangeFrom.value);
    qs.set("to", rangeTo.value);
    if (filters.branchId) qs.set("branchId", filters.branchId);
    if (filters.paidFrom) qs.set("paidFrom", filters.paidFrom);
    if (filters.categoryId) qs.set("categoryId", filters.categoryId);
    const data = await get<{ expenses: Expense[] }>(`/expenses?${qs}`);
    rows.value = data.expenses ?? [];
  } catch (e) {
    error.value = e instanceof Error ? e.message : "โหลดไม่สำเร็จ";
    rows.value = [];
  } finally {
    pending.value = false;
  }
}

function resetForm() {
  editingId.value = null;
  form.branchId = filters.branchId === "shared" ? "" : filters.branchId || "";
  form.categoryId = preferredCategoryId();
  form.amount = "";
  form.description = "";
  form.paidFrom = "external";
  form.spentAt = dateMode.value === "day" ? day.value : todayIso();
  form.note = "";
  error.value = "";
}

function openCreate() {
  resetForm();
}

function openEdit(row: Expense) {
  editingId.value = row.id;
  form.branchId = row.branchId ?? "";
  form.categoryId = row.categoryId;
  form.amount = String(row.amount);
  form.description = row.description ?? "";
  form.paidFrom = row.paidFrom;
  form.spentAt = row.spentAt.slice(0, 10);
  form.note = row.note ?? "";
  error.value = "";
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function save() {
  const amount = Number(String(form.amount).replace(/,/g, ""));
  if (!form.categoryId || !Number.isFinite(amount) || amount <= 0) {
    error.value = "เลือกประเภท แล้วใส่จำนวนเงิน";
    return;
  }
  saving.value = true;
  error.value = "";
  try {
    const body = {
      branchId: form.branchId || null,
      categoryId: form.categoryId,
      amount,
      description: form.description.trim() || null,
      paidFrom: form.paidFrom,
      spentAt: `${form.spentAt}T12:00:00+07:00`,
      note: form.note.trim() || null,
    };
    if (editingId.value) {
      await post(`/expenses/update`, { id: editingId.value, ...body });
    } else {
      await post("/expenses", body);
    }
    const keepCat = form.categoryId;
    const keepDay = form.spentAt;
    resetForm();
    form.categoryId = keepCat;
    form.spentAt = keepDay;
    await load();
  } catch (e) {
    error.value = e instanceof Error ? e.message : "บันทึกไม่สำเร็จ";
  } finally {
    saving.value = false;
  }
}

async function remove(row: Expense) {
  const ok = await askConfirm({
    title: "ลบค่าใช้จ่ายหน้าร้าน",
    message: `ลบรายการ ${row.categoryName || ""} ${baht(row.amount)} บาท?`,
    confirmLabel: "ลบรายการ",
  });
  if (!ok) return;
  saving.value = true;
  try {
    await post(`/expenses/delete`, { id: row.id });
    await load();
  } catch (e) {
    error.value = e instanceof Error ? e.message : "ลบไม่สำเร็จ";
  } finally {
    saving.value = false;
  }
}

const total = computed(() =>
  rows.value.reduce((s, r) => s + r.amount, 0),
);

onMounted(async () => {
  await loadMeta();
  await load();
});
</script>

<template>
  <div>
    <div class="ui-page-head">
      <div>
        <h1 class="ui-page-title">ค่าใช้จ่ายหน้าร้าน</h1>
        <p class="ui-page-sub">
          กดประเภท ใส่ยอด แล้วบันทึก · ไม่ระบุสาขาได้ (กลาง) · เบิกจาก POS เข้าอัตโนมัติเมื่อ sync
        </p>
      </div>
      <div class="ui-page-head__actions">
        <NuxtLink to="/expenses/categories" class="ui-btn ui-btn--ghost">
          จัดการประเภท
        </NuxtLink>
        <NuxtLink to="/reports/cashflow" class="ui-btn ui-btn--ghost">
          สรุปรายรับ–รายจ่าย
        </NuxtLink>
        <button type="button" class="ui-btn ui-btn--ghost" :disabled="pending" @click="load">
          {{ pending ? "กำลังโหลด..." : "รีเฟรช" }}
        </button>
      </div>
    </div>

    <div class="ui-card ui-expense-filters">
      <div class="ui-expense-filters__period">
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

        <div v-if="dateMode === 'day'" class="ui-field ui-expense-filters__date">
          <span>วันที่</span>
          <div class="ui-date-daybar">
            <button
              type="button"
              class="ui-btn ui-btn--ghost"
              title="วันก่อน"
              @click="shiftDay(-1); load()"
            >
              ‹ วันก่อน
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
              @click="shiftDay(1); load()"
            >
              วันถัดไป ›
            </button>
            <button
              type="button"
              class="ui-btn ui-btn--ghost"
              :class="{ 'ui-btn--primary': day === todayIso() }"
              @click="setPreset('today'); load()"
            >
              วันนี้
            </button>
          </div>
        </div>

        <div v-else class="ui-expense-filters__range">
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
          <div class="ui-expense-filters__presets">
            <button
              type="button"
              class="ui-btn ui-btn--ghost"
              @click="setPreset('today'); load()"
            >
              วันนี้
            </button>
            <button
              type="button"
              class="ui-btn ui-btn--ghost"
              @click="setPreset('month'); load()"
            >
              เดือนนี้
            </button>
          </div>
        </div>
      </div>

      <div class="ui-expense-filters__meta">
        <label class="ui-field">
          <span>สาขา</span>
          <select v-model="filters.branchId" class="ui-input" @change="load">
            <option value="">ทุกสาขา</option>
            <option value="shared">กลาง</option>
            <option v-for="b in branches" :key="b.id" :value="b.id">
              {{ b.code }} — {{ b.name }}
            </option>
          </select>
        </label>
        <label class="ui-field">
          <span>จ่ายจาก</span>
          <select v-model="filters.paidFrom" class="ui-input" @change="load">
            <option value="">ทั้งหมด</option>
            <option value="drawer">ลิ้นชัก POS</option>
            <option value="external">นอกลิ้นชัก</option>
          </select>
        </label>
        <label class="ui-field">
          <span>หมวด</span>
          <select v-model="filters.categoryId" class="ui-input" @change="load">
            <option value="">ทุกหมวด</option>
            <option v-for="c in categories" :key="c.id" :value="c.id">
              {{ c.name }}
            </option>
          </select>
        </label>
      </div>
    </div>

    <div class="ui-card ui-expense-form">
      <div class="ui-expense-form__head">
        <strong>{{ editingId ? "แก้ไขรายการ" : "บันทึกค่าใช้จ่ายหน้าร้าน" }}</strong>
        <button
          v-if="editingId"
          type="button"
          class="ui-btn ui-btn--ghost"
          @click="openCreate"
        >
          ยกเลิกแก้ไข
        </button>
      </div>
      <div class="ui-field" style="margin-bottom: 0.65rem">
        <span>ประเภท *</span>
        <div class="ui-expense-cats">
          <button
            v-for="c in categories"
            :key="c.id"
            type="button"
            class="ui-expense-cat"
            :class="{ 'is-on': form.categoryId === c.id }"
            @click="form.categoryId = c.id"
          >
            {{ c.name }}
          </button>
          <NuxtLink to="/expenses/categories" class="ui-expense-cat ui-expense-cat--add">
            + เพิ่มประเภท
          </NuxtLink>
        </div>
      </div>
      <div class="ui-expense-form__row">
        <label class="ui-field ui-expense-form__amount">
          <span>จำนวนเงิน *</span>
          <input
            v-model="form.amount"
            class="ui-input"
            type="text"
            inputmode="decimal"
            placeholder="0"
            @keydown.enter.prevent="save"
          />
        </label>
        <label class="ui-field">
          <span>วันที่</span>
          <UiDateInput v-model="form.spentAt" aria-label="วันที่" />
        </label>
        <label class="ui-field">
          <span>สาขา</span>
          <select v-model="form.branchId" class="ui-input">
            <option value="">กลาง</option>
            <option v-for="b in branches" :key="b.id" :value="b.id">
              {{ b.name }}
            </option>
          </select>
        </label>
        <div class="ui-field">
          <span>จ่ายจาก</span>
          <div class="ui-date-mode">
            <button
              type="button"
              class="ui-btn"
              :class="form.paidFrom === 'external' ? 'ui-btn--primary' : 'ui-btn--ghost'"
              @click="form.paidFrom = 'external'"
            >
              นอกลิ้นชัก
            </button>
            <button
              type="button"
              class="ui-btn"
              :class="form.paidFrom === 'drawer' ? 'ui-btn--primary' : 'ui-btn--ghost'"
              @click="form.paidFrom = 'drawer'"
            >
              ลิ้นชัก POS
            </button>
          </div>
        </div>
      </div>
      <label class="ui-field">
        <span>รายละเอียด (ไม่บังคับ)</span>
        <input
          v-model="form.description"
          class="ui-input"
          type="text"
          placeholder="เช่น ใบเสร็จ / ของที่ซื้อ"
          @keydown.enter.prevent="save"
        />
      </label>
      <p v-if="error" class="ui-field-hint" style="color: #b91c1c">{{ error }}</p>
      <div class="ui-expense-form__foot">
        <button
          type="button"
          class="ui-btn ui-btn--primary"
          :disabled="saving"
          @click="save"
        >
          {{ saving ? "กำลังบันทึก..." : editingId ? "บันทึกการแก้ไข" : "บันทึก" }}
        </button>
      </div>
    </div>

    <div class="ui-card">
      <div class="ui-card__toolbar">
        <span class="ui-toolbar-meta ui-toolbar-meta--alone">
          {{ rows.length }} รายการ · รวม {{ baht(total) }} บาท
        </span>
      </div>
      <div v-if="pending && !rows.length" class="ui-empty">กำลังโหลด...</div>
      <div v-else-if="!rows.length" class="ui-empty">
        ยังไม่มีค่าใช้จ่ายในช่วงนี้
        <span class="ui-empty__hint">
          เบิกเงินจากลิ้นชักบน POS จะเข้าที่นี่หลัง sync · หรือกดบันทึกค่าใช้จ่ายนอกลิ้นชัก
        </span>
      </div>
      <div v-else class="ui-table-wrap">
        <table class="ui-table ui-table--fit">
          <thead>
            <tr>
              <th>วันเวลา</th>
              <th>สาขา</th>
              <th>หมวด</th>
              <th>รายละเอียด</th>
              <th>จ่ายจาก</th>
              <th>จำนวน</th>
              <th>โดย</th>
              <th class="ui-table__actions">จัดการ</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in rows" :key="row.id">
              <td>{{ fmtAt(row.spentAt) }}</td>
              <td>{{ branchName(row.branchId) }}</td>
              <td>{{ row.categoryName || "-" }}</td>
              <td>{{ row.description || row.note || "-" }}</td>
              <td>{{ paidLabel(row.paidFrom) }}</td>
              <td>{{ baht(row.amount) }}</td>
              <td>{{ row.staffName || "-" }}</td>
              <td class="ui-table__actions">
                <button type="button" class="ui-btn ui-btn--ghost" @click="openEdit(row)">
                  แก้ไข
                </button>
                <button
                  type="button"
                  class="ui-btn ui-btn--ghost-danger"
                  @click="remove(row)"
                >
                  ลบ
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

  </div>
</template>

<style scoped>
.ui-expense-filters {
  padding: 1rem 1.25rem 1.1rem;
  margin-bottom: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.95rem;
}
.ui-expense-filters .ui-field {
  margin-bottom: 0;
  min-width: 0;
}
.ui-expense-filters__period {
  display: flex;
  flex-wrap: wrap;
  gap: 0.85rem 1.25rem;
  align-items: end;
  padding-bottom: 0.95rem;
  border-bottom: 1px solid #eef2f6;
}
.ui-expense-filters__date {
  flex: 1 1 22rem;
}
.ui-expense-filters__date :deep(.ui-date) {
  width: 11rem;
  min-width: 11rem;
}
.ui-expense-filters__range {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem 1rem;
  align-items: end;
  flex: 1 1 28rem;
}
.ui-expense-filters__range .ui-field {
  flex: 0 1 11rem;
}
.ui-expense-filters__presets {
  display: flex;
  gap: 0.4rem;
  padding-bottom: 0.05rem;
}
.ui-expense-filters__meta {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.75rem 1rem;
  align-items: end;
}
@media (max-width: 900px) {
  .ui-expense-filters__meta {
    grid-template-columns: 1fr;
  }
}
.ui-expense-form {
  padding: 1rem 1.25rem 1.15rem;
  margin-bottom: 1rem;
}
.ui-expense-form__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  margin-bottom: 0.75rem;
}
.ui-expense-form__head strong {
  font-size: 1rem;
}
.ui-expense-cats {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}
.ui-expense-cat {
  border: 1px solid #e2e8f0;
  background: #fff;
  color: #334155;
  border-radius: 999px;
  padding: 0.38rem 0.8rem;
  font-size: 0.88rem;
  font-weight: 650;
  cursor: pointer;
}
.ui-expense-cat:hover {
  border-color: #fde68a;
  background: #fffbeb;
}
.ui-expense-cat.is-on {
  border-color: #ca8a04;
  background: #fef3c7;
  color: #854d0e;
}
.ui-expense-cat--add {
  text-decoration: none;
  color: #64748b;
  font-weight: 500;
  border-style: dashed;
}
.ui-expense-form__row {
  display: grid;
  grid-template-columns: minmax(8rem, 1fr) minmax(10rem, 0.9fr) minmax(8rem, 0.9fr) auto;
  gap: 0.75rem 1rem;
  align-items: end;
  margin-bottom: 0.75rem;
}
.ui-expense-form__amount .ui-input {
  font-size: 1.2rem;
  font-weight: 700;
}
.ui-expense-form__foot {
  margin-top: 0.85rem;
}
@media (max-width: 900px) {
  .ui-expense-form__row {
    grid-template-columns: 1fr 1fr;
  }
}
</style>
