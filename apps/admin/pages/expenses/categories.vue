<script setup lang="ts">
type Category = {
  id: string;
  name: string;
  sortOrder: number;
  posReason: string | null;
  active: boolean;
  updatedAt: string;
};

const { get, post, patch, del } = useAdminApi();
const { askConfirm } = useConfirmDialog();

const pending = ref(false);
const saving = ref(false);
const error = ref("");
const rows = ref<Category[]>([]);
const modalOpen = ref(false);
const editingId = ref<string | null>(null);
const dragIndex = ref<number | null>(null);
const dragOverIndex = ref<number | null>(null);
let saveTimer: ReturnType<typeof setTimeout> | null = null;
const form = reactive({
  name: "",
  active: true,
  posReason: "",
});

async function load() {
  pending.value = true;
  error.value = "";
  try {
    const data = await get<{ categories: Category[] }>("/expense-categories?all=1");
    rows.value = data.categories ?? [];
  } catch (e) {
    error.value = e instanceof Error ? e.message : "โหลดไม่สำเร็จ";
    rows.value = [];
  } finally {
    pending.value = false;
  }
}

function openCreate() {
  editingId.value = null;
  form.name = "";
  form.active = true;
  form.posReason = "";
  error.value = "";
  modalOpen.value = true;
}

function openEdit(row: Category) {
  editingId.value = row.id;
  form.name = row.name;
  form.active = row.active;
  form.posReason = row.posReason ?? "";
  error.value = "";
  modalOpen.value = true;
}

function onDragStart(index: number, e: DragEvent) {
  dragIndex.value = index;
  e.dataTransfer?.setData("text/plain", String(index));
  if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
}

function onDragOver(index: number, e: DragEvent) {
  e.preventDefault();
  dragOverIndex.value = index;
  if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
}

function onDrop(index: number, e: DragEvent) {
  e.preventDefault();
  const from = dragIndex.value;
  dragIndex.value = null;
  dragOverIndex.value = null;
  if (from == null || from === index) return;
  const next = [...rows.value];
  const [item] = next.splice(from, 1);
  if (!item) return;
  next.splice(index, 0, item);
  rows.value = next.map((row, i) => ({ ...row, sortOrder: (i + 1) * 10 }));
  scheduleReorder();
}

function onDragEnd() {
  dragIndex.value = null;
  dragOverIndex.value = null;
}

function scheduleReorder() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    void persistOrder();
  }, 250);
}

async function persistOrder() {
  saving.value = true;
  error.value = "";
  try {
    const data = await post<{ categories: Category[] }>("/expense-categories/reorder", {
      ids: rows.value.map((r) => r.id),
    });
    if (data.categories) rows.value = data.categories;
  } catch (e) {
    error.value = e instanceof Error ? e.message : "เรียงลำดับไม่สำเร็จ";
    await load();
  } finally {
    saving.value = false;
  }
}

async function save() {
  if (!form.name.trim()) {
    error.value = "ใส่ชื่อประเภท";
    return;
  }
  saving.value = true;
  error.value = "";
  try {
    const body = {
      name: form.name.trim(),
      sortOrder: editingId.value
        ? rows.value.find((r) => r.id === editingId.value)?.sortOrder
        : (rows.value.length + 1) * 10,
      active: form.active,
      posReason: form.posReason.trim() || null,
    };
    if (editingId.value) await patch(`/expense-categories/${editingId.value}`, body);
    else await post("/expense-categories", body);
    modalOpen.value = false;
    await load();
  } catch (e) {
    error.value = e instanceof Error ? e.message : "บันทึกไม่สำเร็จ";
  } finally {
    saving.value = false;
  }
}

async function toggleActive(row: Category) {
  saving.value = true;
  try {
    await patch(`/expense-categories/${row.id}`, { active: !row.active });
    await load();
  } catch (e) {
    error.value = e instanceof Error ? e.message : "อัปเดตไม่สำเร็จ";
  } finally {
    saving.value = false;
  }
}

async function remove(row: Category) {
  const ok = await askConfirm({
    title: "ลบประเภทค่าใช้จ่ายหน้าร้าน",
    message: `ลบ「${row.name}」ใช่หรือไม่?`,
    detail: "ถ้ายังมีรายการใช้ประเภทนี้ จะลบไม่ได้ — ให้ปิดการใช้งานแทน",
    confirmLabel: "ลบประเภท",
  });
  if (!ok) return;
  saving.value = true;
  error.value = "";
  try {
    await del(`/expense-categories/${row.id}`);
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
  <div>
    <div class="ui-page-head">
      <div>
        <h1 class="ui-page-title">ประเภทค่าใช้จ่ายหน้าร้าน</h1>
        <p class="ui-page-sub">
          ลาก ⋮⋮ เพื่อจัดลำดับที่แสดงตอนบันทึกค่าใช้จ่ายหน้าร้าน
        </p>
      </div>
      <div class="ui-page-head__actions">
        <NuxtLink to="/expenses" class="ui-btn ui-btn--ghost">กลับค่าใช้จ่ายหน้าร้าน</NuxtLink>
        <button type="button" class="ui-btn ui-btn--primary" @click="openCreate">
          + เพิ่มประเภท
        </button>
      </div>
    </div>

    <div v-if="error && !modalOpen" class="ui-empty">{{ error }}</div>

    <div class="ui-card">
      <div class="ui-card__toolbar">
        <span class="ui-toolbar-meta ui-toolbar-meta--alone">
          {{ rows.length }} ประเภท · ลากเพื่อเรียง
        </span>
      </div>
      <div v-if="pending && !rows.length" class="ui-empty">กำลังโหลด...</div>
      <div v-else-if="!rows.length" class="ui-empty">ยังไม่มีประเภท</div>
      <div v-else class="ui-table-wrap">
        <table class="ui-table ui-table--fit">
          <thead>
            <tr>
              <th class="ui-table__col-drag" />
              <th>ลำดับ</th>
              <th>ชื่อ</th>
              <th>สถานะ</th>
              <th class="ui-table__actions">จัดการ</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(row, index) in rows"
              :key="row.id"
              class="ui-expense-cat-row"
              :class="{
                'is-off': !row.active,
                'is-dragging': dragIndex === index,
                'is-over': dragOverIndex === index && dragIndex !== index,
              }"
              @dragover="onDragOver(index, $event)"
              @drop="onDrop(index, $event)"
            >
              <td class="ui-table__col-drag">
                <span
                  class="ui-expense-cat-grip"
                  draggable="true"
                  title="ลากเพื่อเรียง"
                  @dragstart="onDragStart(index, $event)"
                  @dragend="onDragEnd"
                >⋮⋮</span>
              </td>
              <td class="ui-muted">{{ index + 1 }}</td>
              <td>
                <strong>{{ row.name }}</strong>
              </td>
              <td>{{ row.active ? "ใช้" : "ปิด" }}</td>
              <td class="ui-table__actions">
                <button type="button" class="ui-btn ui-btn--ghost" @click="openEdit(row)">
                  แก้ไข
                </button>
                <button
                  type="button"
                  class="ui-btn ui-btn--ghost"
                  :disabled="saving"
                  @click="toggleActive(row)"
                >
                  {{ row.active ? "ปิดใช้" : "เปิดใช้" }}
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
    </div>

    <div v-if="modalOpen" class="ui-modal">
      <div class="ui-modal__panel" role="dialog" aria-modal="true">
        <div class="ui-modal__head">
          <h2>{{ editingId ? "แก้ไขประเภท" : "เพิ่มประเภท" }}</h2>
          <button class="ui-icon-btn" type="button" @click="modalOpen = false">×</button>
        </div>
        <div class="ui-modal__body">
          <label class="ui-field">
            <span>ชื่อประเภท *</span>
            <input
              v-model="form.name"
              class="ui-input"
              type="text"
              placeholder="เช่น ค่าหมู"
              autofocus
              @keyup.enter="save"
            />
          </label>
          <label class="ui-check">
            <input v-model="form.active" type="checkbox" />
            <span>เปิดใช้งาน</span>
          </label>
          <p v-if="error" class="ui-field-hint" style="color: #b91c1c">{{ error }}</p>
        </div>
        <div class="ui-modal__foot">
          <button type="button" class="ui-btn ui-btn--ghost" @click="modalOpen = false">
            ยกเลิก
          </button>
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
.is-off td {
  color: #94a3b8;
}
.ui-expense-cat-row.is-dragging {
  opacity: 0.45;
}
.ui-expense-cat-row.is-over td {
  background: #fffbeb;
}
.ui-expense-cat-grip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.55rem;
  height: 1.55rem;
  color: #64748b;
  font-size: 0.72rem;
  letter-spacing: -0.12em;
  user-select: none;
  cursor: grab;
}
.ui-expense-cat-grip:active {
  cursor: grabbing;
}
</style>
