<script setup lang="ts">
import { paginateItems } from "~/utils/pagination";
import {
  calcDailyCommission,
  formatCommissionRule,
  type CommissionConfig,
} from "@ap-pos/shared";

type Staff = {
  id: string;
  code: string;
  name: string;
  pin: string;
  role: "admin" | "manager" | "cashier";
  canLoginAdmin: boolean;
  active: boolean;
  hasPassword: boolean;
  commissionEnabled: boolean;
  commissionStartSales: number;
  commissionStepSales: number;
  commissionPerStep: number;
  dailyWage: number;
};

type StaffForm = {
  code: string;
  name: string;
  pin: string;
  password: string;
  role: "admin" | "manager" | "cashier";
  canLoginAdmin: boolean;
  active: boolean;
  dailyWage: string;
  commissionEnabled: boolean;
  commissionStartSales: string;
  commissionStepSales: string;
  commissionPerStep: string;
};

const emptyForm = (): StaffForm => ({
  code: "",
  name: "",
  pin: "0000",
  password: "",
  role: "cashier",
  canLoginAdmin: false,
  active: true,
  dailyWage: "0",
  commissionEnabled: false,
  commissionStartSales: "8000",
  commissionStepSales: "1000",
  commissionPerStep: "100",
});

const ROLE_LABEL: Record<string, string> = {
  admin: "ผู้ดูแล",
  manager: "ผู้จัดการ",
  cashier: "แคชเชียร์",
};

const { get, post, patch, del } = useAdminApi();
const { askConfirm } = useConfirmDialog();
const pending = ref(false);
const saving = ref(false);
const error = ref("");
const q = ref("");
const rows = ref<Staff[]>([]);
const modalOpen = ref(false);
const editingId = ref<string | null>(null);
const form = ref<StaffForm>(emptyForm());

const commissionPreview = computed(() => {
  const config: CommissionConfig = {
    enabled: form.value.commissionEnabled,
    startSales: Number(form.value.commissionStartSales) || 0,
    stepSales: Number(form.value.commissionStepSales) || 1000,
    amountPerStep: Number(form.value.commissionPerStep) || 0,
  };
  const rule = formatCommissionRule(config);
  if (!config.enabled) return { rule, samples: [] as string[] };
  const samples = [0, 1, 2, 3].map((i) => {
    const sales = config.startSales + i * config.stepSales;
    const r = calcDailyCommission(sales, config);
    return `ยอด ${sales.toLocaleString("th-TH")}฿ → คอม ${r.amount.toLocaleString("th-TH")}฿`;
  });
  return { rule, samples };
});

const filtered = computed(() => {
  const s = q.value.trim().toLowerCase();
  if (!s) return rows.value;
  return rows.value.filter(
    (r) =>
      r.name.toLowerCase().includes(s) ||
      r.code.toLowerCase().includes(s) ||
      r.role.toLowerCase().includes(s),
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

function baht(n: number) {
  return n.toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function commissionLabel(row: Staff) {
  if (!row.commissionEnabled) return "-";
  return formatCommissionRule({
    enabled: true,
    startSales: row.commissionStartSales,
    stepSales: row.commissionStepSales,
    amountPerStep: row.commissionPerStep,
  });
}

async function load() {
  pending.value = true;
  error.value = "";
  try {
    const data = await get<{ staff: Staff[] }>("/staff");
    rows.value = data.staff ?? [];
  } catch (e) {
    error.value = e instanceof Error ? e.message : "โหลดพนักงานไม่สำเร็จ";
  } finally {
    pending.value = false;
  }
}

async function openCreate() {
  editingId.value = null;
  form.value = emptyForm();
  try {
    const next = await get<{ code: string }>("/staff/next-code");
    form.value.code = next.code;
  } catch {
    // ignore
  }
  modalOpen.value = true;
}

function openEdit(row: Staff) {
  editingId.value = row.id;
  form.value = {
    code: row.code,
    name: row.name,
    pin: row.pin,
    password: "",
    role: row.role,
    canLoginAdmin: row.canLoginAdmin,
    active: row.active,
    dailyWage: String(row.dailyWage ?? 0),
    commissionEnabled: Boolean(row.commissionEnabled),
    commissionStartSales: String(row.commissionStartSales ?? 8000),
    commissionStepSales: String(row.commissionStepSales ?? 1000),
    commissionPerStep: String(row.commissionPerStep ?? 100),
  };
  modalOpen.value = true;
}

function closeModal() {
  modalOpen.value = false;
}

async function save() {
  if (!form.value.name.trim()) {
    error.value = "กรุณากรอกชื่อ";
    return;
  }
  if (form.value.canLoginAdmin && !editingId.value && !form.value.password.trim()) {
    error.value = "บัญชีเข้า Admin ต้องตั้งรหัสผ่าน";
    return;
  }
  saving.value = true;
  error.value = "";
  try {
    const body: Record<string, unknown> = {
      code: form.value.code.trim() || undefined,
      name: form.value.name.trim(),
      pin: form.value.pin,
      role: form.value.role,
      canLoginAdmin: form.value.canLoginAdmin,
      active: form.value.active,
      dailyWage: Number(form.value.dailyWage) || 0,
      commissionEnabled: form.value.commissionEnabled,
      commissionStartSales: Number(form.value.commissionStartSales),
      commissionStepSales: Number(form.value.commissionStepSales),
      commissionPerStep: Number(form.value.commissionPerStep),
    };
    if (form.value.password.trim()) body.password = form.value.password.trim();
    if (editingId.value) {
      await patch(`/staff/${editingId.value}`, body);
    } else {
      await post("/staff", body);
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

async function remove(row: Staff) {
  const ok = await askConfirm({
    title: "ลบพนักงาน",
    message: `ต้องการลบ 「${row.name}」 ใช่หรือไม่?`,
    detail: `รหัส ${row.code}`,
    confirmLabel: "ลบพนักงาน",
  });
  if (!ok) return;
  saving.value = true;
  error.value = "";
  try {
    await del(`/staff/${row.id}`);
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
        <h1 class="ui-page-title">พนักงาน</h1>
        <p class="ui-page-sub">
          จัดการรหัส / PIN / ค่าแรงรายวัน / ค่าคอม · พนักงานใช้ได้ทุกสาขา
        </p>
      </div>
      <div class="ui-page-head__actions">
        <button type="button" class="ui-btn ui-btn--ghost" :disabled="pending" @click="load">
          {{ pending ? "กำลังโหลด..." : "รีเฟรช" }}
        </button>
        <button type="button" class="ui-btn ui-btn--primary" @click="openCreate">
          + เพิ่มพนักงาน
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
          placeholder="ชื่อ / รหัส / บทบาท"
        />
      </label>
    </div>

    <div v-if="error" class="ui-empty">{{ error }}</div>

    <div class="ui-card">
      <div class="ui-card__toolbar">
        <span class="ui-toolbar-meta ui-toolbar-meta--alone">
          พนักงาน ({{ meta.total }} รายการ)
        </span>
      </div>
      <div v-if="pending && !rows.length" class="ui-empty">กำลังโหลด...</div>
      <div v-else-if="!pageRows.length" class="ui-empty">ไม่พบข้อมูล</div>
      <div v-else class="ui-table-wrap">
        <table class="ui-table ui-table--fit">
          <thead>
            <tr>
              <th>รหัส</th>
              <th>ชื่อ</th>
              <th>บทบาท</th>
              <th>PIN</th>
              <th>ค่าแรง/วัน</th>
              <th>ค่าคอม</th>
              <th>Admin</th>
              <th>สถานะ</th>
              <th class="ui-table__actions">จัดการ</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in pageRows" :key="row.id">
              <td>{{ row.code }}</td>
              <td>{{ row.name }}</td>
              <td>{{ ROLE_LABEL[row.role] || row.role }}</td>
              <td>{{ row.pin }}</td>
              <td>{{ baht(row.dailyWage ?? 0) }}</td>
              <td class="ui-staff-comm">{{ commissionLabel(row) }}</td>
              <td>{{ row.canLoginAdmin ? "ได้" : "-" }}</td>
              <td>{{ row.active ? "ใช้งาน" : "ปิด" }}</td>
              <td class="ui-table__actions">
                <button type="button" class="ui-btn ui-btn--ghost" @click="openEdit(row)">
                  แก้ไข
                </button>
                <button
                  type="button"
                  class="ui-btn ui-btn--ghost-danger"
                  :disabled="row.code === 'admin' || saving"
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
      <div class="ui-modal__panel ui-modal__panel--wide" role="dialog" aria-modal="true">
        <div class="ui-modal__head">
          <h2>{{ editingId ? "แก้ไขพนักงาน" : "เพิ่มพนักงาน" }}</h2>
          <button class="ui-icon-btn" type="button" @click="closeModal">×</button>
        </div>
        <div class="ui-modal__body">
          <div class="ui-form-grid">
            <label class="ui-field">
              <span>รหัส (ออโต้)</span>
              <input
                v-model="form.code"
                class="ui-input"
                type="text"
                readonly
                title="ออกเลขอัตโนมัติ"
              />
            </label>
            <label class="ui-field">
              <span>ชื่อ *</span>
              <input v-model="form.name" class="ui-input" type="text" />
            </label>
            <label class="ui-field">
              <span>PIN เปิดรอบ POS</span>
              <input v-model="form.pin" class="ui-input" type="text" maxlength="6" />
            </label>
            <label class="ui-field">
              <span>บทบาท</span>
              <select v-model="form.role" class="ui-input">
                <option value="cashier">แคชเชียร์</option>
                <option value="manager">ผู้จัดการ</option>
                <option value="admin">ผู้ดูแล</option>
              </select>
            </label>
            <label class="ui-field">
              <span>ค่าแรงรายวัน (บาท)</span>
              <input
                v-model="form.dailyWage"
                class="ui-input"
                type="number"
                min="0"
                step="50"
                placeholder="เช่น 400"
              />
              <p class="ui-field-hint">
                ได้ทุกวันที่มาเปิดรอบขาย · คนละอัตราได้ · รายงาน = จำนวนวัน × อัตรานี้
              </p>
            </label>
            <label class="ui-field">
              <span>
                รหัสผ่าน Admin
                {{ editingId ? "(ว่าง = ไม่เปลี่ยน)" : "" }}
              </span>
              <input v-model="form.password" class="ui-input" type="password" />
            </label>
            <label class="ui-field ui-field--check">
              <input v-model="form.canLoginAdmin" type="checkbox" />
              <span>เข้าสู่ระบบ Admin ได้</span>
            </label>
            <label class="ui-field ui-field--check">
              <input v-model="form.active" type="checkbox" />
              <span>เปิดใช้งาน</span>
            </label>
          </div>

          <div class="ui-staff-comm-box">
            <label class="ui-switch ui-switch--labeled">
              <input v-model="form.commissionEnabled" type="checkbox" />
              <span class="ui-switch__track" aria-hidden="true" />
              <span class="ui-switch__copy">
                <strong>ค่าคอมมิชชั่นรายวัน</strong>
                <small>คิดจากยอดขายรวมทั้งวัน · แจ้งตอนปิดรอบที่ POS</small>
              </span>
            </label>

            <div v-if="form.commissionEnabled" class="ui-form-grid ui-staff-comm-fields">
              <label class="ui-field">
                <span>ยอดขายเริ่มได้คอม (บาท)</span>
                <input
                  v-model="form.commissionStartSales"
                  class="ui-input"
                  type="number"
                  min="1"
                  step="100"
                />
              </label>
              <label class="ui-field">
                <span>ขยับทุกกี่บาท</span>
                <input
                  v-model="form.commissionStepSales"
                  class="ui-input"
                  type="number"
                  min="1"
                  step="100"
                />
              </label>
              <label class="ui-field">
                <span>ได้คอมกี่บาทต่อขั้น</span>
                <input
                  v-model="form.commissionPerStep"
                  class="ui-input"
                  type="number"
                  min="0"
                  step="10"
                />
              </label>
            </div>

            <div v-if="form.commissionEnabled" class="ui-staff-comm-preview">
              <div>{{ commissionPreview.rule }}</div>
              <div
                v-for="(s, i) in commissionPreview.samples"
                :key="i"
                class="ui-staff-comm-sample"
              >
                {{ s }}
              </div>
            </div>
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
.ui-staff-comm {
  max-width: 16rem;
  font-size: 0.82rem;
  color: #475569;
  line-height: 1.35;
}
.ui-staff-comm-box {
  margin-top: 1.1rem;
  padding-top: 1rem;
  border-top: 1px solid #e2e8f0;
  display: grid;
  gap: 0.85rem;
}
.ui-staff-comm-fields {
  margin-top: 0.15rem;
}
.ui-staff-comm-preview {
  padding: 0.75rem 0.9rem;
  border-radius: 0.75rem;
  background: color-mix(in srgb, var(--ui-primary) 8%, white);
  border: 1px solid color-mix(in srgb, var(--ui-primary) 18%, white);
  color: #0f3d2a;
  font-size: 0.88rem;
  line-height: 1.45;
}
.ui-staff-comm-sample {
  margin-top: 0.25rem;
  color: #345c4a;
  font-size: 0.82rem;
}
</style>
