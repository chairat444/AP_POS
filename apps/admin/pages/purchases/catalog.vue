<script setup lang="ts">
type CatalogItem = {
  id: string;
  name: string;
  aliases: string;
  groupKey: string;
  unit: string | null;
  active: boolean;
};

const GROUPS = [
  { key: "meatball", label: "ร้านลูกชิ้น" },
  { key: "market", label: "ร้านในตลาด" },
  { key: "veg", label: "ร้านผัก" },
  { key: "transfer", label: "ส่งสาขา" },
  { key: "makro", label: "แม็คโค" },
];

const { get, post } = useAdminApi();
const { askConfirm } = useConfirmDialog();
const pending = ref(false);
const saving = ref(false);
const error = ref("");
const message = ref("");
const items = ref<CatalogItem[]>([]);
const q = ref("");
const selected = ref<Record<string, boolean>>({});
const modalOpen = ref(false);
const editingId = ref<string | null>(null);
const form = reactive({
  name: "",
  aliases: "",
  groupKey: "market",
  unit: "",
});

const filtered = computed(() => {
  const s = q.value.trim().toLowerCase();
  if (!s) return items.value;
  return items.value.filter(
    (i) =>
      i.name.toLowerCase().includes(s) ||
      i.aliases.toLowerCase().includes(s),
  );
});

const selectedIds = computed(() =>
  filtered.value.filter((row) => selected.value[row.id]).map((row) => row.id),
);

const allFilteredSelected = computed(
  () =>
    filtered.value.length > 0 &&
    filtered.value.every((row) => selected.value[row.id]),
);

function groupLabel(key: string) {
  return GROUPS.find((g) => g.key === key)?.label ?? key;
}

function toggleSelectAll() {
  const next = { ...selected.value };
  const on = !allFilteredSelected.value;
  for (const row of filtered.value) {
    if (on) next[row.id] = true;
    else delete next[row.id];
  }
  selected.value = next;
}

function clearSelection() {
  selected.value = {};
}

async function load() {
  pending.value = true;
  error.value = "";
  try {
    const data = await get<{ items: CatalogItem[] }>("/purchases/catalog");
    items.value = data.items ?? [];
    const keep = new Set(items.value.map((i) => i.id));
    const next: Record<string, boolean> = {};
    for (const [id, on] of Object.entries(selected.value)) {
      if (on && keep.has(id)) next[id] = true;
    }
    selected.value = next;
  } catch (e) {
    error.value = e instanceof Error ? e.message : "โหลดไม่สำเร็จ";
  } finally {
    pending.value = false;
  }
}

function openCreate() {
  editingId.value = null;
  form.name = "";
  form.aliases = "";
  form.groupKey = "market";
  form.unit = "";
  modalOpen.value = true;
}

function openEdit(row: CatalogItem) {
  editingId.value = row.id;
  form.name = row.name;
  form.aliases = row.aliases;
  form.groupKey = row.groupKey;
  form.unit = row.unit ?? "";
  modalOpen.value = true;
}

function closeModal() {
  modalOpen.value = false;
}

async function save() {
  if (!form.name.trim()) {
    error.value = "ใส่ชื่อสินค้า";
    return;
  }
  if (saving.value) return;
  saving.value = true;
  error.value = "";
  try {
    const body = {
      name: form.name.trim(),
      aliases: form.aliases.trim(),
      groupKey: form.groupKey,
      unit: form.unit.trim() || null,
    };
    // ใช้ POST — nginx หน้า HTTPS บล็อก PATCH/DELETE
    if (editingId.value) {
      await post("/purchases/catalog/update", {
        id: editingId.value,
        ...body,
      });
    } else {
      await post("/purchases/catalog", body);
    }
    modalOpen.value = false;
    message.value = "บันทึกแล้ว";
    await load();
  } catch (e) {
    error.value = e instanceof Error ? e.message : "บันทึกไม่สำเร็จ";
  } finally {
    saving.value = false;
  }
}

async function removeRow(row: CatalogItem) {
  const ok = await askConfirm({
    title: "ลบชื่อสินค้า?",
    message: `ลบ「${row.name}」ออกจากรายการ map`,
    detail: "ชื่อนี้จะไม่ถูกใช้จัดเข้าแผงอีก · แผงวันที่จัดไว้แล้วยังอยู่ · เพิ่มใหม่ได้ภายหลัง",
    confirmLabel: "ลบ",
  });
  if (!ok) return;
  saving.value = true;
  error.value = "";
  message.value = "";
  try {
    await post("/purchases/catalog/bulk-delete", { ids: [row.id] });
    message.value = `ลบ「${row.name}」แล้ว`;
    await load();
  } catch (e) {
    error.value = e instanceof Error ? e.message : "ลบไม่สำเร็จ";
  } finally {
    saving.value = false;
  }
}

async function removeSelected() {
  const ids = selectedIds.value;
  if (!ids.length) {
    error.value = "เลือกรายการก่อน";
    return;
  }
  const names = filtered.value
    .filter((row) => selected.value[row.id])
    .map((row) => row.name);
  const preview =
    names.length <= 5
      ? names.map((n) => `「${n}」`).join(" ")
      : `${names
          .slice(0, 3)
          .map((n) => `「${n}」`)
          .join(" ")} และอีก ${names.length - 3} รายการ`;
  const ok = await askConfirm({
    title: `ลบ ${ids.length} รายการ?`,
    message: preview,
    detail: "ชื่อเหล่านี้จะไม่ถูกใช้จัดเข้าแผงอีก · แผงวันที่จัดไว้แล้วยังอยู่",
    confirmLabel: `ลบ ${ids.length} รายการ`,
  });
  if (!ok) return;
  saving.value = true;
  error.value = "";
  message.value = "";
  try {
    await post("/purchases/catalog/bulk-delete", { ids });
    clearSelection();
    message.value = `ลบแล้ว ${ids.length} รายการ`;
    await load();
  } catch (e) {
    error.value = e instanceof Error ? e.message : "ลบไม่สำเร็จ";
  } finally {
    saving.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div
    class="ui-catalog-page"
    :class="{ 'ui-catalog-page--selecting': selectedIds.length > 0 }"
  >
    <div class="ui-page-head">
      <div>
        <h1 class="ui-page-title">ตั้งค่าชื่อสินค้า → ร้าน</h1>
        <p class="ui-page-sub">
          map ชื่อที่น้องพิมพ์ (และชื่อเรียกอื่น) ไปคอลัมน์ร้านลูกชิ้น / ตลาด / ผัก / ส่งสาขา / แม็คโค
        </p>
      </div>
      <div class="ui-page-head__actions">
        <NuxtLink to="/purchases" class="ui-btn ui-btn--ghost">กลับแผงสรุป</NuxtLink>
        <button type="button" class="ui-btn ui-btn--primary" @click="openCreate">
          + เพิ่มชื่อ
        </button>
      </div>
    </div>

    <div class="ui-card ui-filter-bar">
      <label class="ui-list-filters__field">
        <span class="ui-list-filters__label">ค้นหา</span>
        <input v-model="q" class="ui-input ui-list-filters__input" type="search" />
      </label>
      <span class="ui-catalog-count">{{ filtered.length }} รายการ</span>
    </div>

    <div v-if="error && !modalOpen" class="ui-empty ui-catalog-flash">{{ error }}</div>
    <div
      v-else-if="message && !modalOpen"
      class="ui-empty ui-catalog-flash"
      style="color: #166534"
    >
      {{ message }}
    </div>

    <div class="ui-card ui-catalog-list">
      <div v-if="pending && !items.length" class="ui-empty">กำลังโหลด...</div>
      <div v-else class="ui-table-wrap ui-catalog-scroll">
        <table class="ui-table ui-table--fit ui-catalog-table">
          <colgroup>
            <col class="ui-catalog-col-check" />
            <col class="ui-catalog-col-name" />
            <col class="ui-catalog-col-aliases" />
            <col class="ui-catalog-col-group" />
            <col class="ui-catalog-col-actions" />
          </colgroup>
          <thead>
            <tr>
              <th class="ui-catalog-check">
                <input
                  type="checkbox"
                  :checked="allFilteredSelected"
                  :disabled="!filtered.length || saving"
                  title="เลือกทั้งหมดที่กรอง"
                  @change="toggleSelectAll"
                />
              </th>
              <th>ชื่อมาตรฐาน</th>
              <th>ชื่อเรียกอื่น</th>
              <th>ร้าน</th>
              <th class="ui-table__actions">จัดการ</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in filtered"
              :key="row.id"
              :class="{ 'is-selected': selected[row.id] }"
            >
              <td class="ui-catalog-check">
                <input v-model="selected[row.id]" type="checkbox" :disabled="saving" />
              </td>
              <td class="ui-catalog-name" :title="row.name">{{ row.name }}</td>
              <td class="ui-catalog-aliases" :title="row.aliases || ''">
                {{ row.aliases || "—" }}
              </td>
              <td class="ui-catalog-group">{{ groupLabel(row.groupKey) }}</td>
              <td class="ui-table__actions">
                <button type="button" class="ui-btn ui-btn--ghost" @click="openEdit(row)">
                  แก้ไข
                </button>
                <button
                  type="button"
                  class="ui-btn ui-btn--ghost-danger"
                  :disabled="saving"
                  @click="removeRow(row)"
                >
                  ลบ
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <Teleport to="body">
      <div v-if="selectedIds.length && !modalOpen" class="ui-catalog-dock">
        <div class="ui-catalog-dock__inner">
          <span class="ui-catalog-dock__count">
            เลือกแล้ว <strong>{{ selectedIds.length }}</strong> รายการ
          </span>
          <div class="ui-catalog-dock__actions">
            <button type="button" class="ui-btn ui-btn--ghost" @click="clearSelection">
              ยกเลิกเลือก
            </button>
            <button
              type="button"
              class="ui-btn ui-btn--danger"
              :disabled="saving"
              @click="removeSelected"
            >
              ลบที่เลือก ({{ selectedIds.length }})
            </button>
          </div>
        </div>
      </div>
    </Teleport>

    <Teleport to="body">
      <div
        v-if="modalOpen"
        class="ui-modal ui-catalog-modal"
      >
        <div class="ui-modal__panel" role="dialog" aria-modal="true">
          <div class="ui-modal__head">
            <h2>{{ editingId ? "แก้ไข" : "เพิ่มชื่อสินค้า" }}</h2>
            <button class="ui-icon-btn" type="button" @click="closeModal">×</button>
          </div>
          <div class="ui-modal__body">
            <div v-if="error" class="ui-empty" style="padding: 0.5rem 0; color: #b91c1c">
              {{ error }}
            </div>
            <div class="ui-form-grid">
              <label class="ui-field">
                <span>ชื่อมาตรฐาน *</span>
                <input v-model="form.name" class="ui-input" type="text" />
              </label>
              <label class="ui-field">
                <span>ร้าน *</span>
                <select v-model="form.groupKey" class="ui-input">
                  <option v-for="g in GROUPS" :key="g.key" :value="g.key">
                    {{ g.label }}
                  </option>
                </select>
              </label>
              <label class="ui-field" style="grid-column: 1 / -1">
                <span>ชื่อเรียกอื่น (คั่นด้วย |)</span>
                <input
                  v-model="form.aliases"
                  class="ui-input"
                  type="text"
                  placeholder="เช่น ชิมิจิ|ชิเมจิ"
                />
              </label>
            </div>
          </div>
          <div class="ui-modal__foot">
            <button type="button" class="ui-btn ui-btn--ghost" @click="closeModal">
              ยกเลิก
            </button>
            <button
              type="button"
              class="ui-btn ui-btn--primary"
              :disabled="saving || !form.name.trim()"
              @click="save"
            >
              {{ saving ? "กำลังบันทึก..." : "บันทึก" }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.ui-catalog-page {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  min-width: 0;
}
.ui-catalog-page--selecting {
  padding-bottom: 5rem;
}
.ui-filter-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 0.75rem;
}
.ui-catalog-count {
  margin-left: auto;
  font-size: 0.88rem;
  color: #64748b;
}
.ui-catalog-flash {
  margin: 0;
  padding: 0.45rem 0.75rem;
}
.ui-catalog-list {
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
  padding: 0;
}
.ui-catalog-scroll {
  max-height: calc(100dvh - 14rem);
  overflow: auto;
  -webkit-overflow-scrolling: touch;
}
.ui-catalog-table {
  width: 100%;
  table-layout: fixed;
}
.ui-catalog-col-check {
  width: 2.75rem;
}
.ui-catalog-col-name {
  width: 28%;
}
.ui-catalog-col-aliases {
  width: auto;
}
.ui-catalog-col-group {
  width: 7.5rem;
}
.ui-catalog-col-actions {
  width: 10.5rem;
}
.ui-catalog-scroll thead th {
  position: sticky;
  top: 0;
  z-index: 2;
  background: #f8fafc;
  box-shadow: 0 1px 0 #e2e8f0;
}
.ui-catalog-check {
  width: 2.75rem;
  min-width: 2.75rem;
  max-width: 2.75rem;
  text-align: center;
  vertical-align: middle;
  padding-left: 0.65rem !important;
  padding-right: 0.35rem !important;
}
.ui-catalog-check input {
  width: 1rem;
  height: 1rem;
  margin: 0;
  cursor: pointer;
  vertical-align: middle;
}
.ui-catalog-name,
.ui-catalog-aliases {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}
.ui-catalog-group {
  white-space: nowrap;
}
.ui-catalog-table .ui-table__actions {
  width: 10.5rem;
  min-width: 10.5rem;
  white-space: nowrap;
  overflow: visible;
  text-align: right;
  padding-right: 0.75rem !important;
}
.ui-catalog-table .ui-table__actions .ui-btn {
  margin-left: 0.25rem;
}
.ui-table tbody tr.is-selected {
  background: #fef9c3;
}
@media (max-width: 720px) {
  .ui-catalog-col-aliases,
  .ui-catalog-aliases {
    display: none;
  }
  .ui-catalog-col-actions {
    width: 6.5rem;
  }
  .ui-catalog-table .ui-table__actions {
    width: 6.5rem;
    min-width: 6.5rem;
  }
}
</style>

<style>
.ui-catalog-modal {
  z-index: 200 !important;
}
.ui-catalog-dock {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 80;
  pointer-events: none;
  padding: 0.75rem 1rem calc(0.75rem + env(safe-area-inset-bottom, 0px));
  background: linear-gradient(to top, rgba(15, 23, 42, 0.12), transparent);
}
.ui-catalog-dock__inner {
  pointer-events: auto;
  max-width: 56rem;
  margin: 0 auto;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.65rem;
  padding: 0.7rem 0.9rem;
  border: 1px solid #fde68a;
  border-radius: 0.85rem;
  background: #fffbeb;
  box-shadow: 0 10px 28px rgba(15, 23, 42, 0.14);
}
.ui-catalog-dock__count {
  font-size: 0.92rem;
  color: #854d0e;
}
.ui-catalog-dock__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
}
</style>
