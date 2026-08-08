<script setup lang="ts">
import { paginateItems } from "~/utils/pagination";

type Unit = {
  id: string;
  name: string;
  updatedAt?: string;
};

const { get, post, patch, del } = useAdminApi();
const { askConfirm } = useConfirmDialog();
const pending = ref(false);
const saving = ref(false);
const error = ref("");
const q = ref("");
const rows = ref<Unit[]>([]);
const modalOpen = ref(false);
const editingId = ref<string | null>(null);
const name = ref("");

const filtered = computed(() => {
  const s = q.value.trim().toLowerCase();
  const list = !s
    ? [...rows.value]
    : rows.value.filter((r) => r.name.toLowerCase().includes(s));
  return list.sort((a, b) => a.name.localeCompare(b.name, "th"));
});

const page = ref(1);
const perPage = ref(20);
const paged = computed(() =>
  paginateItems(filtered.value, page.value, perPage.value),
);
const pageRows = computed(() => paged.value.rows);
const meta = computed(() => paged.value.meta);

watch(q, () => {
  page.value = 1;
});

function onPageChange(payload: { page: number; per_page: number }) {
  page.value = payload.page;
  perPage.value = payload.per_page;
}

function fmtAt(iso?: string) {
  if (!iso) return "-";
  return new Date(iso).toLocaleString("th-TH", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

async function load() {
  pending.value = true;
  error.value = "";
  try {
    const data = await get<{ units: Unit[] }>("/units");
    rows.value = data.units ?? [];
  } catch (e) {
    error.value = e instanceof Error ? e.message : "โหลดหน่วยไม่สำเร็จ";
  } finally {
    pending.value = false;
  }
}

function openCreate() {
  editingId.value = null;
  name.value = "";
  error.value = "";
  modalOpen.value = true;
}

function openEdit(row: Unit) {
  editingId.value = row.id;
  name.value = row.name;
  error.value = "";
  modalOpen.value = true;
}

function closeModal() {
  modalOpen.value = false;
}

async function save() {
  if (!name.value.trim()) {
    error.value = "กรุณากรอกชื่อหน่วย";
    return;
  }
  saving.value = true;
  error.value = "";
  try {
    const body = { name: name.value.trim() };
    if (editingId.value) await patch(`/units/${editingId.value}`, body);
    else await post("/units", body);
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

async function remove(row: Unit) {
  const ok = await askConfirm({
    title: "ลบหน่วย",
    message: `ต้องการลบหน่วย 「${row.name}」 ใช่หรือไม่?`,
    detail: "ถ้ามีสินค้าใช้อยู่ อาจลบไม่ได้จนกว่าจะเปลี่ยนหน่วยของสินค้านั้นก่อน",
    confirmLabel: "ลบหน่วย",
  });
  if (!ok) return;
  saving.value = true;
  error.value = "";
  try {
    await del(`/units/${row.id}`);
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
        <h1 class="ui-page-title">หน่วยสินค้า</h1>
        <p class="ui-page-sub">
          master หน่วยที่ใช้กับสินค้า เช่น ชิ้น · กก. · แพ็ค · ขวด
        </p>
      </div>
      <div class="ui-page-head__actions">
        <button type="button" class="ui-btn ui-btn--ghost" :disabled="pending" @click="load">
          {{ pending ? "กำลังโหลด..." : "รีเฟรช" }}
        </button>
        <button type="button" class="ui-btn ui-btn--primary" @click="openCreate">
          + เพิ่มหน่วย
        </button>
      </div>
    </div>

    <div v-if="error && !modalOpen" class="ui-empty">{{ error }}</div>

    <div class="ui-card">
      <div class="ui-card__toolbar">
        <div class="ui-toolbar-search">
          <span class="ui-toolbar-search__meta">
            หน่วยทั้งหมด {{ rows.length }} · แสดง {{ meta.total }} รายการ
          </span>
          <div class="ui-toolbar-search__controls">
            <input
              v-model="q"
              class="ui-input"
              type="search"
              placeholder="ค้นหาชื่อหน่วย..."
              aria-label="ค้นหาหน่วย"
            />
          </div>
        </div>
      </div>

      <div v-if="pending && !rows.length" class="ui-empty">กำลังโหลด...</div>
      <div v-else-if="!pageRows.length" class="ui-empty">
        {{ q.trim() ? "ไม่พบหน่วยที่ตรงคำค้น" : "ยังไม่มีหน่วยสินค้า" }}
        <span v-if="!q.trim()" class="ui-empty__hint">
          กด “เพิ่มหน่วย” เพื่อสร้างหน่วยใหม่ หรือใช้หน่วยที่ระบบสร้างให้อัตโนมัติจากสินค้า
        </span>
      </div>
      <div v-else class="ui-table-wrap">
        <table class="ui-table ui-table--fit">
          <thead>
            <tr>
              <th>ชื่อหน่วย</th>
              <th>อัปเดตล่าสุด</th>
              <th class="ui-table__actions">จัดการ</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in pageRows" :key="row.id">
              <td>
                <strong>{{ row.name }}</strong>
              </td>
              <td class="ui-muted">{{ fmtAt(row.updatedAt) }}</td>
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
      <div class="ui-modal__panel" role="dialog" aria-modal="true">
        <div class="ui-modal__head">
          <h2>{{ editingId ? "แก้ไขหน่วย" : "เพิ่มหน่วย" }}</h2>
          <button class="ui-icon-btn" type="button" @click="closeModal">×</button>
        </div>
        <div class="ui-modal__body">
          <label class="ui-field">
            <span>ชื่อหน่วย *</span>
            <input
              v-model="name"
              class="ui-input"
              type="text"
              placeholder="เช่น ชิ้น, กก., แพ็ค"
              autofocus
              @keyup.enter="save"
            />
            <p class="ui-field-hint">ชื่อต้องไม่ซ้ำกับหน่วยที่มีอยู่แล้ว</p>
          </label>
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
