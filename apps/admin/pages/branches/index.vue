<script setup lang="ts">
import { paginateItems } from "~/utils/pagination";

type Branch = {
  id: string;
  code: string;
  name: string;
  active: boolean;
};

type BranchForm = {
  code: string;
  name: string;
  active: boolean;
};

const emptyForm = (): BranchForm => ({
  code: "",
  name: "",
  active: true,
});

const { get, post, patch, del } = useAdminApi();
const { askConfirm } = useConfirmDialog();
const pending = ref(false);
const saving = ref(false);
const error = ref("");
const q = ref("");
const rows = ref<Branch[]>([]);
const modalOpen = ref(false);
const editingId = ref<string | null>(null);
const form = ref<BranchForm>(emptyForm());

const filtered = computed(() => {
  const s = q.value.trim().toLowerCase();
  if (!s) return rows.value;
  return rows.value.filter(
    (r) =>
      r.name.toLowerCase().includes(s) || r.code.toLowerCase().includes(s),
  );
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

async function load() {
  pending.value = true;
  error.value = "";
  try {
    const data = await get<{ branches: Branch[] }>("/branches");
    rows.value = data.branches ?? [];
  } catch (e) {
    error.value = e instanceof Error ? e.message : "โหลดสาขาไม่สำเร็จ";
  } finally {
    pending.value = false;
  }
}

async function openCreate() {
  editingId.value = null;
  form.value = emptyForm();
  try {
    const next = await get<{ code: string }>("/branches/next-code");
    form.value.code = next.code;
  } catch {
    // ignore
  }
  modalOpen.value = true;
}

function openEdit(row: Branch) {
  editingId.value = row.id;
  form.value = {
    code: row.code,
    name: row.name,
    active: row.active,
  };
  modalOpen.value = true;
}

function closeModal() {
  modalOpen.value = false;
}

async function save() {
  if (!form.value.name.trim()) {
    error.value = "กรุณากรอกชื่อสาขา";
    return;
  }
  saving.value = true;
  error.value = "";
  try {
    const body = {
      code: form.value.code.trim() || undefined,
      name: form.value.name.trim(),
      active: form.value.active,
    };
    if (editingId.value) {
      await patch(`/branches/${editingId.value}`, body);
    } else {
      await post("/branches", body);
    }
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

async function remove(row: Branch) {
  const ok = await askConfirm({
    title: "ลบสาขา",
    message: `ต้องการลบ 「${row.name}」 ใช่หรือไม่?`,
    detail: `รหัส ${row.code}`,
    confirmLabel: "ลบสาขา",
  });
  if (!ok) return;
  saving.value = true;
  error.value = "";
  try {
    await del(`/branches/${row.id}`);
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
        <h1 class="ui-page-title">สาขา</h1>
        <p class="ui-page-sub">
          จัดการสาขาสำหรับ POS · พนักงานใช้ได้ทุกสาขา (เลือกสาขาตอนเปิดรอบ)
        </p>
      </div>
      <div class="ui-page-head__actions">
        <button type="button" class="ui-btn ui-btn--ghost" :disabled="pending" @click="load">
          {{ pending ? "กำลังโหลด..." : "รีเฟรช" }}
        </button>
        <button type="button" class="ui-btn ui-btn--primary" @click="openCreate">
          + เพิ่มสาขา
        </button>
      </div>
    </div>

    <div class="ui-card ui-filter-bar">
      <label class="ui-list-filters__field">
        <span class="ui-list-filters__label">คำค้น</span>
        <input
          v-model="q"
          class="ui-input"
          type="search"
          placeholder="ชื่อ / รหัส"
        />
      </label>
    </div>

    <div v-if="error" class="ui-empty">{{ error }}</div>

    <div class="ui-card">
      <div class="ui-card__toolbar">
        <span class="ui-toolbar-meta ui-toolbar-meta--alone">
          สาขา ({{ meta.total }} รายการ)
        </span>
      </div>
      <div v-if="pending && !rows.length" class="ui-empty">กำลังโหลด...</div>
      <div v-else-if="!pageRows.length" class="ui-empty">ไม่พบข้อมูล</div>
      <div v-else class="ui-table-wrap">
        <table class="ui-table ui-table--fit">
          <thead>
            <tr>
              <th>รหัส</th>
              <th>ชื่อสาขา</th>
              <th>สถานะ</th>
              <th class="ui-table__actions">จัดการ</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in pageRows" :key="row.id">
              <td>{{ row.code }}</td>
              <td>{{ row.name }}</td>
              <td>{{ row.active ? "ใช้งาน" : "ปิด" }}</td>
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
          <h2>{{ editingId ? "แก้ไขสาขา" : "เพิ่มสาขา" }}</h2>
          <button class="ui-icon-btn" type="button" @click="closeModal">×</button>
        </div>
        <div class="ui-modal__body">
          <div class="ui-form-grid">
            <label class="ui-field">
              <span>รหัสสาขา (ออโต้)</span>
              <input
                v-model="form.code"
                class="ui-input"
                type="text"
                readonly
                title="ออกเลขอัตโนมัติ"
              />
            </label>
            <label class="ui-field">
              <span>ชื่อสาขา *</span>
              <input v-model="form.name" class="ui-input" type="text" />
            </label>
            <label class="ui-field ui-field--check">
              <input v-model="form.active" type="checkbox" />
              <span>เปิดใช้งาน</span>
            </label>
          </div>
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
