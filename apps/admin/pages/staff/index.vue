<script setup lang="ts">
import { paginateItems } from "~/utils/pagination";
import {
  ADMIN_MENU_GROUPS,
  ALL_ADMIN_MENU_KEYS,
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
  adminMenus?: string[];
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
  adminMenus: string[];
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
  adminMenus: [...ALL_ADMIN_MENU_KEYS],
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

const { get, post } = useAdminApi();
const { askConfirm } = useConfirmDialog();
const pending = ref(false);
const saving = ref(false);
const error = ref("");
const q = ref("");
const rows = ref<Staff[]>([]);
const modalOpen = ref(false);
const editingId = ref<string | null>(null);
const form = ref<StaffForm>(emptyForm());
const showPassword = ref(false);
const codeLocked = ref(false);

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

function menusLabel(row: Staff) {
  if (!row.canLoginAdmin) return "-";
  if (row.role === "admin" || row.adminMenus?.includes("*")) return "ทุกเมนู";
  const n = (row.adminMenus ?? []).length;
  return n ? `${n} เมนู` : "แดชบอร์ด";
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
  showPassword.value = false;
  codeLocked.value = false;
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
    adminMenus:
      row.role === "admin" || row.adminMenus?.includes("*")
        ? [...ALL_ADMIN_MENU_KEYS]
        : [...(row.adminMenus ?? [])],
    active: row.active,
    dailyWage: String(row.dailyWage ?? 0),
    commissionEnabled: Boolean(row.commissionEnabled),
    commissionStartSales: String(row.commissionStartSales ?? 8000),
    commissionStepSales: String(row.commissionStepSales ?? 1000),
    commissionPerStep: String(row.commissionPerStep ?? 100),
  };
  showPassword.value = false;
  codeLocked.value = row.code === "admin";
  modalOpen.value = true;
}

function closeModal() {
  modalOpen.value = false;
  showPassword.value = false;
  codeLocked.value = false;
}

const PASSWORD_UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const PASSWORD_LOWER = "abcdefghijkmnopqrstuvwxyz";
const PASSWORD_DIGIT = "23456789";
const PASSWORD_SYMBOL = "!@#$%^&*?";
const PASSWORD_ALL =
  PASSWORD_UPPER + PASSWORD_LOWER + PASSWORD_DIGIT + PASSWORD_SYMBOL;

function pickChar(alphabet: string, n: number) {
  return alphabet[n % alphabet.length] ?? alphabet[0] ?? "x";
}

function generateStrongPassword(length = 16) {
  const buf = new Uint32Array(length * 2);
  crypto.getRandomValues(buf);
  const chars = [
    pickChar(PASSWORD_UPPER, buf[0] ?? 0),
    pickChar(PASSWORD_LOWER, buf[1] ?? 1),
    pickChar(PASSWORD_DIGIT, buf[2] ?? 2),
    pickChar(PASSWORD_SYMBOL, buf[3] ?? 3),
  ];
  for (let i = 4; i < length; i++) {
    chars.push(pickChar(PASSWORD_ALL, buf[i] ?? i));
  }
  for (let i = chars.length - 1; i > 0; i--) {
    const j = (buf[length + i] ?? i) % (i + 1);
    const a = chars[i];
    const b = chars[j];
    if (a == null || b == null) continue;
    chars[i] = b;
    chars[j] = a;
  }
  return chars.join("");
}

function fillStrongPassword() {
  form.value.password = generateStrongPassword();
  form.value.canLoginAdmin = true;
  showPassword.value = true;
}

function hasMenu(key: string) {
  return form.value.adminMenus.includes(key);
}

function toggleMenu(key: string, on: boolean) {
  if (on) {
    if (!form.value.adminMenus.includes(key)) form.value.adminMenus.push(key);
    return;
  }
  form.value.adminMenus = form.value.adminMenus.filter((k) => k !== key);
}

function groupAllChecked(id: string) {
  const items = ADMIN_MENU_GROUPS.find((g) => g.id === id)?.items ?? [];
  return items.length > 0 && items.every((i) => hasMenu(i.key));
}

function toggleMenuGroup(id: string, on: boolean) {
  const items = ADMIN_MENU_GROUPS.find((g) => g.id === id)?.items ?? [];
  for (const i of items) toggleMenu(i.key, on);
}

function toggleAllMenus(on: boolean) {
  form.value.adminMenus = on ? [...ALL_ADMIN_MENU_KEYS] : [];
}

watch(
  () => form.value.canLoginAdmin,
  (on) => {
    if (on && !form.value.adminMenus.length) {
      form.value.adminMenus = [...ALL_ADMIN_MENU_KEYS];
    }
  },
);

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
      adminMenus: form.value.adminMenus,
      active: form.value.active,
      dailyWage: Number(form.value.dailyWage) || 0,
      commissionEnabled: form.value.commissionEnabled,
      commissionStartSales: Number(form.value.commissionStartSales),
      commissionStepSales: Number(form.value.commissionStepSales),
      commissionPerStep: Number(form.value.commissionPerStep),
    };
    if (form.value.password.trim()) body.password = form.value.password.trim();
    if (editingId.value) {
      await post(`/staff/update`, { id: editingId.value, ...body });
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
    await post(`/staff/delete`, { id: row.id });
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
          จัดการรหัส / PIN / ค่าแรงรายวัน / ค่าคอม · พนักงานใช้ได้ทุกสาขา ·
          วันอาทิตย์มาขายได้ค่าแรง 800 (คอมตามเรทเดิม)
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
              <th>เมนู</th>
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
              <td>{{ menusLabel(row) }}</td>
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
              <span>รหัสเข้าสู่ระบบ</span>
              <input
                v-model="form.code"
                class="ui-input"
                type="text"
                maxlength="32"
                :readonly="codeLocked"
                :title="codeLocked ? 'บัญชี admin หลักเปลี่ยนรหัสไม่ได้' : 'ใช้เข้า Admin'"
                placeholder="เช่น ploy"
                autocapitalize="off"
                spellcheck="false"
              />
              <p class="ui-field-hint">
                {{
                  codeLocked
                    ? "บัญชีผู้ดูแลหลักใช้รหัส admin"
                    : "ใช้ล็อกอินหลังบ้าน · เปลี่ยนจาก 02 เป็นชื่อได้ เช่น ploy · ว่างตอนเพิ่มใหม่จะออกเลขให้"
                }}
              </p>
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
              <div class="ui-staff-password">
                <div class="ui-password-field">
                  <input
                    v-model="form.password"
                    class="ui-input"
                    :type="showPassword ? 'text' : 'password'"
                    autocomplete="new-password"
                    spellcheck="false"
                  />
                  <button
                    class="ui-password-field__toggle"
                    type="button"
                    :title="showPassword ? 'ซ่อนรหัสผ่าน' : 'ดูรหัสผ่าน'"
                    :aria-label="showPassword ? 'ซ่อนรหัสผ่าน' : 'ดูรหัสผ่าน'"
                    @click="showPassword = !showPassword"
                  >
                    <svg
                      v-if="!showPassword"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                    <svg
                      v-else
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M3 3l18 18" />
                      <path d="M10.6 10.6A3 3 0 0 0 12 15a3 3 0 0 0 2.4-4.4" />
                      <path d="M9.9 5.1A10.8 10.8 0 0 1 12 5c6.5 0 10 7 10 7a17.6 17.6 0 0 1-3.2 3.9" />
                      <path d="M6.1 6.1C3.8 7.8 2 12 2 12s3.5 7 10 7a10.4 10.4 0 0 0 4.2-.9" />
                    </svg>
                  </button>
                </div>
                <button
                  class="ui-btn ui-btn--ghost"
                  type="button"
                  title="สุ่มรหัสผ่านแข็งแรง 16 ตัว"
                  @click="fillStrongPassword"
                >
                  สุ่มรหัส
                </button>
              </div>
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

          <div
            v-if="form.canLoginAdmin"
            class="ui-staff-menus"
          >
            <div class="ui-staff-menus__head">
              <strong>เมนูที่เข้าได้ใน Admin</strong>
              <label v-if="form.role !== 'admin'" class="ui-staff-menus__all">
                <input
                  type="checkbox"
                  :checked="form.adminMenus.length === ALL_ADMIN_MENU_KEYS.length"
                  @change="toggleAllMenus(($event.target as HTMLInputElement).checked)"
                />
                เลือกทั้งหมด
              </label>
            </div>
            <p v-if="form.role === 'admin'" class="ui-field-hint">
              ผู้ดูแลเข้าได้ทุกเมนู รวมหน้าพนักงาน
            </p>
            <div v-else class="ui-staff-menus__grid">
              <section
                v-for="group in ADMIN_MENU_GROUPS"
                :key="group.id"
                class="ui-staff-menus__group"
              >
                <label class="ui-staff-menus__group-head">
                  <input
                    type="checkbox"
                    :checked="groupAllChecked(group.id)"
                    @change="toggleMenuGroup(group.id, ($event.target as HTMLInputElement).checked)"
                  />
                  {{ group.label }}
                </label>
                <label
                  v-for="item in group.items"
                  :key="item.key"
                  class="ui-staff-menus__item"
                >
                  <input
                    type="checkbox"
                    :checked="hasMenu(item.key)"
                    @change="toggleMenu(item.key, ($event.target as HTMLInputElement).checked)"
                  />
                  {{ item.label }}
                </label>
              </section>
            </div>
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
.ui-staff-password {
  display: flex;
  align-items: stretch;
  gap: 0.45rem;
}
.ui-staff-password .ui-password-field {
  flex: 1;
  min-width: 0;
}
.ui-staff-password .ui-btn {
  flex: 0 0 auto;
  white-space: nowrap;
}
.ui-staff-password .ui-password-field__toggle svg {
  width: 0.95rem;
  height: 0.95rem;
  stroke-width: 1.5;
}
.ui-staff-menus {
  margin-top: 1.1rem;
  padding-top: 1rem;
  border-top: 1px solid #e2e8f0;
  display: grid;
  gap: 0.75rem;
}
.ui-staff-menus__head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.75rem;
}
.ui-staff-menus__all,
.ui-staff-menus__group-head,
.ui-staff-menus__item {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.88rem;
}
.ui-staff-menus__group-head {
  font-weight: 700;
  margin-bottom: 0.25rem;
}
.ui-staff-menus__grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
  gap: 0.85rem;
}
.ui-staff-menus__group {
  display: grid;
  gap: 0.28rem;
  padding: 0.7rem 0.8rem;
  border: 1px solid #e2e8f0;
  border-radius: 0.75rem;
  background: #f8fafc;
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
