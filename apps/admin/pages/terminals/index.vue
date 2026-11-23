<script setup lang="ts">
import { paginateItems } from "~/utils/pagination";

type Branch = { id: string; code: string; name: string };

type Terminal = {
  id: string;
  code: string;
  name: string;
  branchId: string;
  active: boolean;
  paperWidth?: "58mm" | "80mm";
  autoPrint?: boolean;
  printSilent?: boolean;
  printerName?: string | null;
  receiptFooterHours?: string | null;
  receiptFooterPhones?: string | null;
  lastSeenAt: string | null;
  updatedAt: string;
};

type TerminalForm = {
  code: string;
  name: string;
  branchId: string;
  active: boolean;
  paperWidth: "58mm" | "80mm";
  autoPrint: boolean;
  printSilent: boolean;
  printerName: string;
  receiptFooterHours: string;
  receiptFooterPhones: string;
};

const emptyForm = (): TerminalForm => ({
  code: "",
  name: "",
  branchId: "",
  active: true,
  paperWidth: "80mm",
  autoPrint: true,
  printSilent: true,
  printerName: "",
  receiptFooterHours: "เปิดบริการทุกวัน 09.00 - 20.00 น.",
  receiptFooterPhones: "ติดต่อ 084 912 3509, 092 494 5442",
});

const { get, post } = useAdminApi();
const { askConfirm } = useConfirmDialog();
const pending = ref(false);
const saving = ref(false);
const error = ref("");
const q = ref("");
const branchFilter = ref("");
const rows = ref<Terminal[]>([]);
const branches = ref<Branch[]>([]);
const modalOpen = ref(false);
const editingId = ref<string | null>(null);
const form = ref<TerminalForm>(emptyForm());

const filtered = computed(() => {
  const s = q.value.trim().toLowerCase();
  return rows.value.filter((r) => {
    if (branchFilter.value && r.branchId !== branchFilter.value) return false;
    if (!s) return true;
    return (
      r.name.toLowerCase().includes(s) ||
      r.code.toLowerCase().includes(s) ||
      r.id.toLowerCase().includes(s)
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

watch([q, branchFilter], () => {
  page.value = 1;
});

function onPageChange(payload: { page: number; per_page: number }) {
  page.value = payload.page;
  perPage.value = payload.per_page;
}

function branchName(id: string) {
  return branches.value.find((b) => b.id === id)?.name ?? id;
}

function fmtAt(iso: string | null) {
  if (!iso) return "-";
  return new Date(iso).toLocaleString("th-TH");
}

async function load() {
  pending.value = true;
  error.value = "";
  try {
    const [termData, branchData] = await Promise.all([
      get<{ terminals: Terminal[] }>("/terminals"),
      get<{ branches: Branch[] }>("/branches"),
    ]);
    rows.value = termData.terminals ?? [];
    branches.value = branchData.branches ?? [];
  } catch (e) {
    error.value = e instanceof Error ? e.message : "โหลดเครื่อง POS ไม่สำเร็จ";
  } finally {
    pending.value = false;
  }
}

async function openCreate() {
  editingId.value = null;
  form.value = emptyForm();
  form.value.branchId = branches.value[0]?.id ?? "";
  try {
    const next = await get<{ code: string }>("/terminals/next-code");
    form.value.code = next.code;
  } catch {
    // ignore
  }
  modalOpen.value = true;
}

function openEdit(row: Terminal) {
  editingId.value = row.id;
  form.value = {
    code: row.code,
    name: row.name,
    branchId: row.branchId,
    active: row.active,
    paperWidth: row.paperWidth === "58mm" ? "58mm" : "80mm",
    autoPrint: row.autoPrint !== false,
    printSilent: row.printSilent !== false,
    printerName: row.printerName?.trim() || "",
    receiptFooterHours:
      row.receiptFooterHours?.trim() ||
      "เปิดบริการทุกวัน 09.00 - 20.00 น.",
    receiptFooterPhones:
      row.receiptFooterPhones?.trim() ||
      "ติดต่อ 084 912 3509, 092 494 5442",
  };
  modalOpen.value = true;
}

function closeModal() {
  modalOpen.value = false;
}

async function save() {
  if (!form.value.name.trim()) {
    error.value = "กรุณากรอกชื่อเครื่อง";
    return;
  }
  if (!form.value.branchId) {
    error.value = "กรุณาเลือกสาขา";
    return;
  }
  saving.value = true;
  error.value = "";
  try {
    const body = {
      code: form.value.code.trim() || undefined,
      name: form.value.name.trim(),
      branchId: form.value.branchId,
      active: form.value.active,
      paperWidth: form.value.paperWidth,
      autoPrint: form.value.autoPrint,
      printSilent: form.value.printSilent,
      printerName: form.value.printerName.trim() || null,
      receiptFooterHours: form.value.receiptFooterHours.trim(),
      receiptFooterPhones: form.value.receiptFooterPhones.trim(),
    };
    if (editingId.value) {
      await post(`/terminals/update`, { id: editingId.value, ...body });
    } else {
      await post("/terminals", body);
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

async function remove(row: Terminal) {
  const ok = await askConfirm({
    title: "ลบเครื่อง POS",
    message: `ต้องการลบ 「${row.name}」 ใช่หรือไม่?`,
    detail: `รหัส ${row.code}`,
    confirmLabel: "ลบเครื่อง",
  });
  if (!ok) return;
  saving.value = true;
  error.value = "";
  try {
    await post(`/terminals/delete`, { id: row.id });
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
        <h1 class="ui-page-title">เครื่อง POS</h1>
        <p class="ui-page-sub">
          สร้างเครื่องให้แต่ละสาขาก่อน · ตั้งขนาดใบเสร็จและชื่อเครื่องพิมพ์ต่อเครื่อง ·
          POS เลือกได้เฉพาะเครื่องที่ลงทะเบียนไว้
        </p>
      </div>
      <div class="ui-page-head__actions">
        <button type="button" class="ui-btn ui-btn--ghost" :disabled="pending" @click="load">
          {{ pending ? "กำลังโหลด..." : "รีเฟรช" }}
        </button>
        <button type="button" class="ui-btn ui-btn--primary" @click="openCreate">
          + เพิ่มเครื่อง
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
      <label class="ui-list-filters__field">
        <span class="ui-list-filters__label">สาขา</span>
        <select v-model="branchFilter" class="ui-input">
          <option value="">ทั้งหมด</option>
          <option v-for="b in branches" :key="b.id" :value="b.id">
            {{ b.code }} — {{ b.name }}
          </option>
        </select>
      </label>
    </div>

    <div v-if="error" class="ui-empty">{{ error }}</div>

    <div class="ui-card">
      <div class="ui-card__toolbar">
        <span class="ui-toolbar-meta ui-toolbar-meta--alone">
          เครื่อง POS ({{ meta.total }} รายการ)
        </span>
      </div>
      <div v-if="pending && !rows.length" class="ui-empty">กำลังโหลด...</div>
      <div v-else-if="!pageRows.length" class="ui-empty">ไม่พบข้อมูล</div>
      <div v-else class="ui-table-wrap">
        <table class="ui-table ui-table--fit ui-table--cards ui-terminals-table">
          <thead>
            <tr>
              <th>รหัส</th>
              <th class="ui-table__col-name">ชื่อเครื่อง</th>
              <th>สาขา</th>
              <th class="ui-terminals-col-secondary">ใบเสร็จ</th>
              <th class="ui-terminals-col-secondary">เครื่องพิมพ์</th>
              <th class="ui-terminals-col-secondary">เห็นล่าสุด</th>
              <th>สถานะ</th>
              <th class="ui-table__actions">จัดการ</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in pageRows" :key="row.id">
              <td>{{ row.code }}</td>
              <td class="ui-table__col-name">{{ row.name }}</td>
              <td>{{ branchName(row.branchId) }}</td>
              <td class="ui-terminals-col-secondary">{{ row.paperWidth === "58mm" ? "58mm" : "80mm" }}</td>
              <td class="ui-terminals-col-secondary">{{ row.printerName?.trim() || "Default" }}</td>
              <td class="ui-terminals-col-secondary">{{ fmtAt(row.lastSeenAt) }}</td>
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
          <h2>{{ editingId ? "แก้ไขเครื่อง" : "เพิ่มเครื่อง" }}</h2>
          <button class="ui-icon-btn" type="button" @click="closeModal">×</button>
        </div>
        <div class="ui-modal__body">
          <div class="ui-form-grid">
            <label class="ui-field">
              <span>รหัสเครื่อง (ออโต้)</span>
              <input
                v-model="form.code"
                class="ui-input"
                type="text"
                readonly
                title="ออกเลขอัตโนมัติ"
              />
            </label>
            <label class="ui-field">
              <span>ชื่อเครื่อง *</span>
              <input v-model="form.name" class="ui-input" type="text" />
            </label>
            <label class="ui-field">
              <span>สาขา *</span>
              <select v-model="form.branchId" class="ui-input">
                <option disabled value="">เลือกสาขา</option>
                <option v-for="b in branches" :key="b.id" :value="b.id">
                  {{ b.code }} — {{ b.name }}
                </option>
              </select>
            </label>
            <label class="ui-field ui-field--check">
              <input v-model="form.active" type="checkbox" />
              <span>เปิดใช้งาน</span>
            </label>

            <div class="ui-field" style="grid-column: 1 / -1">
              <span>ขนาดกระดาษใบเสร็จ *</span>
              <div style="display: flex; gap: 1rem; margin-top: 0.35rem">
                <label class="ui-field--check">
                  <input v-model="form.paperWidth" type="radio" value="80mm" />
                  <span>80 mm</span>
                </label>
                <label class="ui-field--check">
                  <input v-model="form.paperWidth" type="radio" value="58mm" />
                  <span>58 mm</span>
                </label>
              </div>
            </div>
            <label class="ui-field ui-field--check">
              <input v-model="form.autoPrint" type="checkbox" />
              <span>พิมพ์อัตโนมัติหลังชำระเงิน</span>
            </label>
            <label class="ui-field ui-field--check">
              <input v-model="form.printSilent" type="checkbox" />
              <span>พิมพ์เงียบ (ไม่โชว์ไดอะล็อก)</span>
            </label>
            <label class="ui-field" style="grid-column: 1 / -1">
              <span>ชื่อเครื่องพิมพ์ (ไดรเวอร์ Windows)</span>
              <input
                v-model="form.printerName"
                class="ui-input"
                type="text"
                placeholder="เช่น XP-80C / EPSON TM-T82 Receipt"
              />
              <small style="opacity: 0.7; margin-top: 0.25rem; display: block">
                ใส่ชื่อให้ตรงกับ Printers &amp; scanners บนเครื่อง POS นั้น
                (ชื่อ Windows กับ Mac ต่างกันได้) · ว่าง = ใช้ Default ของเครื่อง ·
                ถ้าไม่ตรงระบบจะลองจับคู่ใกล้เคียง / fallback default
              </small>
            </label>
            <label class="ui-field" style="grid-column: 1 / -1">
              <span>ข้อความเวลาเปิดบริการ (ท้ายใบเสร็จ)</span>
              <input v-model="form.receiptFooterHours" class="ui-input" type="text" />
            </label>
            <label class="ui-field" style="grid-column: 1 / -1">
              <span>เบอร์ติดต่อท้ายใบเสร็จ</span>
              <input v-model="form.receiptFooterPhones" class="ui-input" type="text" />
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

<style scoped>
@media (max-width: 800px) {
  .ui-table-wrap:has(.ui-terminals-table) {
    overflow-x: visible !important;
  }

  .ui-terminals-table {
    width: 100% !important;
    min-width: 0 !important;
    table-layout: auto !important;
  }

  .ui-terminals-table thead {
    display: none;
  }

  .ui-terminals-table tbody {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .ui-terminals-table tr {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    grid-template-areas:
      "name status"
      "code branch"
      "paper printer"
      "seen seen"
      "actions actions";
    gap: 0.28rem 0.55rem;
    padding: 0.7rem 0.75rem;
    border: 1px solid #e2e8f0;
    border-radius: 0.65rem;
    background: #fff;
  }

  .ui-terminals-table td {
    border: 0 !important;
    padding: 0 !important;
    overflow: visible !important;
    white-space: normal !important;
    position: static !important;
    box-shadow: none !important;
  }

  .ui-terminals-table td:nth-child(1) {
    grid-area: code;
    font-size: 0.8rem;
    color: #94a3b8;
  }

  .ui-terminals-table td:nth-child(1)::before {
    content: "รหัส ";
    font-weight: 600;
  }

  .ui-terminals-table .ui-table__col-name {
    grid-area: name;
    min-width: 0 !important;
    font-weight: 700;
    font-size: 0.95rem;
    line-height: 1.35;
    word-break: keep-all;
  }

  .ui-terminals-table td:nth-child(3) {
    grid-area: branch;
    color: #64748b;
    font-size: 0.84rem;
    text-align: right;
  }

  .ui-terminals-table td:nth-child(4) {
    grid-area: paper;
    font-size: 0.82rem;
    color: #475569;
  }

  .ui-terminals-table td:nth-child(4)::before {
    content: "ใบเสร็จ ";
    font-weight: 600;
    color: #94a3b8;
  }

  .ui-terminals-table td:nth-child(5) {
    grid-area: printer;
    font-size: 0.82rem;
    color: #475569;
    text-align: right;
  }

  .ui-terminals-table td:nth-child(5)::before {
    content: "พิมพ์ ";
    font-weight: 600;
    color: #94a3b8;
  }

  .ui-terminals-table td:nth-child(6) {
    grid-area: seen;
    font-size: 0.8rem;
    color: #64748b;
  }

  .ui-terminals-table td:nth-child(6)::before {
    content: "เห็นล่าสุด ";
    font-weight: 600;
    color: #94a3b8;
  }

  .ui-terminals-table td:nth-child(7) {
    grid-area: status;
    text-align: right;
    font-size: 0.8rem;
    color: #64748b;
  }

  .ui-terminals-table .ui-table__actions {
    grid-area: actions;
    display: flex;
    width: 100%;
    min-width: 0 !important;
    gap: 0.4rem;
    padding-top: 0.45rem !important;
    border-top: 1px solid #f1f5f9;
    text-align: left !important;
  }

  .ui-terminals-table .ui-table__actions .ui-btn {
    flex: 1 1 0;
    justify-content: center;
    min-height: 2.15rem;
    margin: 0;
  }
}
</style>
