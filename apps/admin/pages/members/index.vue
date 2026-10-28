<script setup lang="ts">
import { paginateItems } from "~/utils/pagination";

type Member = {
  id: string;
  code: string;
  name: string;
  phone?: string;
  points: number;
  createdAt?: string;
  lastUsedAt?: string | null;
};

type SortKey = "points" | "name" | "code" | "phone" | "createdAt" | "lastUsedAt";

type MemberForm = {
  code: string;
  name: string;
  phone: string;
  points: string;
};

const emptyForm = (): MemberForm => ({
  code: "",
  name: "",
  phone: "",
  points: "0",
});

const nameInput = ref<HTMLInputElement | null>(null);
const phoneInput = ref<HTMLInputElement | null>(null);
const pointsInput = ref<HTMLInputElement | null>(null);

const { get, post, postForm } = useAdminApi();
const { askConfirm } = useConfirmDialog();
const pending = ref(false);
const saving = ref(false);
const error = ref("");
const q = ref("");
/** default: สมัครล่าสุดก่อน */
const sortKey = ref<SortKey>("createdAt");
const sortDir = ref<"desc" | "asc">("desc");
const rows = ref<Member[]>([]);
const modalOpen = ref(false);
const editingId = ref<string | null>(null);
const form = ref<MemberForm>(emptyForm());

function ts(iso?: string | null) {
  if (!iso) return 0;
  const n = Date.parse(iso);
  return Number.isFinite(n) ? n : 0;
}

function formatWhen(iso?: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("th-TH", {
    day: "numeric",
    month: "short",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const filtered = computed(() => {
  const s = q.value.trim().toLowerCase();
  const digits = s.replace(/\D/g, "");
  let list = !s
    ? [...rows.value]
    : rows.value.filter((m) => {
        const phone = (m.phone ?? "").replace(/\D/g, "");
        return (
          m.name.toLowerCase().includes(s) ||
          m.code.toLowerCase().includes(s) ||
          (digits.length > 0 && phone.includes(digits)) ||
          (m.phone ?? "").includes(s)
        );
      });

  const dir = sortDir.value === "asc" ? 1 : -1;
  list.sort((a, b) => {
    if (sortKey.value === "points") {
      return (a.points - b.points) * dir;
    }
    if (sortKey.value === "phone") {
      return (a.phone ?? "").localeCompare(b.phone ?? "", "th") * dir;
    }
    if (sortKey.value === "code") {
      return a.code.localeCompare(b.code, "th", { numeric: true }) * dir;
    }
    if (sortKey.value === "createdAt") {
      return (ts(a.createdAt) - ts(b.createdAt)) * dir;
    }
    if (sortKey.value === "lastUsedAt") {
      return (ts(a.lastUsedAt) - ts(b.lastUsedAt)) * dir;
    }
    return a.name.localeCompare(b.name, "th") * dir;
  });
  return list;
});

const page = ref(1);
const perPage = ref(20);
const paged = computed(() =>
  paginateItems(filtered.value, page.value, perPage.value),
);
const pageRows = computed(() => paged.value.rows);
const meta = computed(() => paged.value.meta);

watch([q, sortKey, sortDir], () => {
  page.value = 1;
});

function toggleSort(key: SortKey) {
  if (sortKey.value === key) {
    sortDir.value = sortDir.value === "asc" ? "desc" : "asc";
  } else {
    sortKey.value = key;
    sortDir.value =
      key === "points" || key === "createdAt" || key === "lastUsedAt"
        ? "desc"
        : "asc";
  }
}

function sortMark(key: SortKey) {
  if (sortKey.value !== key) return "";
  return sortDir.value === "asc" ? " ↑" : " ↓";
}

const sortLabel = computed(() => {
  const labels: Record<SortKey, string> = {
    points: "แต้ม",
    name: "ชื่อ",
    code: "รหัส",
    phone: "เบอร์",
    createdAt: "วันที่สมัคร",
    lastUsedAt: "ใช้งานล่าสุด",
  };
  return labels[sortKey.value];
});

function onPageChange(payload: { page: number; per_page: number }) {
  page.value = payload.page;
  perPage.value = payload.per_page;
}

async function load() {
  pending.value = true;
  error.value = "";
  try {
    const data = await get<{ members: Member[] }>("/members");
    rows.value = data.members ?? [];
  } catch (e) {
    error.value = e instanceof Error ? e.message : "โหลดสมาชิกไม่สำเร็จ";
  } finally {
    pending.value = false;
  }
}

function errMsg(e: unknown, fallback: string) {
  const status =
    (e as { statusCode?: number; status?: number })?.statusCode ??
    (e as { status?: number })?.status;
  if (status === 403) {
    return "บันทึกไม่ผ่าน (403) · ลองกดบันทึกอีกครั้ง ไม่ต้องรีเฟรชทั้งหน้า";
  }
  const msg = (e as { data?: { message?: string | string[] } })?.data?.message;
  if (Array.isArray(msg) && msg.length) return msg.join(", ");
  if (typeof msg === "string" && msg.trim()) return msg;
  return e instanceof Error ? e.message : fallback;
}

function focusNameSoon() {
  void nextTick(() => {
    nameInput.value?.focus();
    nameInput.value?.select();
  });
}

async function openCreate() {
  editingId.value = null;
  form.value = emptyForm();
  try {
    const next = await get<{ code: string }>("/members/next-code");
    form.value.code = next.code;
  } catch {
    // server จะออกเลขให้อีกทีตอนบันทึก
  }
  modalOpen.value = true;
  focusNameSoon();
}

function openEdit(row: Member) {
  editingId.value = row.id;
  form.value = {
    code: row.code,
    name: row.name,
    phone: row.phone ?? "",
    points: String(row.points ?? 0),
  };
  modalOpen.value = true;
  focusNameSoon();
}

function onFieldEnter(field: "name" | "phone" | "points") {
  if (field === "name") {
    phoneInput.value?.focus();
    return;
  }
  if (field === "phone") {
    pointsInput.value?.focus();
    pointsInput.value?.select();
    return;
  }
  void save();
}

function closeModal() {
  modalOpen.value = false;
}

function digits(phone?: string | null) {
  return String(phone ?? "").replace(/\D/g, "");
}

function findPhoneOwner(phone: string) {
  const p = digits(phone);
  if (p.length < 9) return null;
  return (
    rows.value.find(
      (row) => digits(row.phone) === p && row.id !== editingId.value,
    ) ?? null
  );
}

async function warnDuplicatePhone(owner: Member) {
  const phone = digits(form.value.phone);
  error.value = `เบอร์ ${phone} มีสมาชิกแล้ว · ${owner.code} ${owner.name}`;
  const openExisting = await askConfirm({
    title: "เบอร์โทรซ้ำ",
    message: `เบอร์ ${phone} มีสมาชิกแล้ว`,
    detail: `${owner.code}  ${owner.name}`,
    confirmLabel: "เปิดคนนี้",
    cancelLabel: "แก้เบอร์",
    tone: "primary",
  });
  if (openExisting) openEdit(owner);
}

async function save() {
  if (saving.value) return;
  if (!form.value.name.trim()) {
    error.value = "กรุณากรอกชื่อสมาชิก";
    return;
  }
  if (!digits(form.value.phone)) {
    error.value = "กรุณากรอกเบอร์โทร";
    return;
  }
  const localDup = findPhoneOwner(form.value.phone);
  if (localDup) {
    await warnDuplicatePhone(localDup);
    return;
  }
  saving.value = true;
  error.value = "";
  try {
    const body = {
      name: form.value.name.trim(),
      phone: form.value.phone.trim(),
      points: Math.max(0, Math.floor(Number(form.value.points) || 0)),
    };
    if (editingId.value) {
      await postForm("/members/update", {
        id: editingId.value,
        code: form.value.code.trim() || undefined,
        ...body,
      });
    } else {
      await postForm("/members/create", body);
    }
    closeModal();
    await load();
  } catch (e) {
    const msg = errMsg(e, "บันทึกไม่สำเร็จ");
    error.value = msg;
    if (/มีสมาชิกแล้ว/.test(msg)) {
      await load();
      const owner = findPhoneOwner(form.value.phone);
      if (owner) {
        saving.value = false;
        await warnDuplicatePhone(owner);
        return;
      }
    }
  } finally {
    saving.value = false;
  }
}

async function remove(row: Member) {
  const ok = await askConfirm({
    title: "ลบสมาชิก",
    message: `ต้องการลบ 「${row.name}」 ใช่หรือไม่?`,
    detail: row.code ? `รหัส ${row.code}` : undefined,
    confirmLabel: "ลบสมาชิก",
  });
  if (!ok) return;
  saving.value = true;
  error.value = "";
  try {
    // nginx บล็อก DELETE → ใช้ POST
    await post("/members/delete", { id: row.id });
    await load();
  } catch (e) {
    error.value = errMsg(e, "ลบไม่สำเร็จ");
  } finally {
    saving.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div class="ui-members">
    <div class="ui-page-head">
      <div>
        <h1 class="ui-page-title">สมาชิก</h1>
        <p class="ui-page-sub">เพิ่ม แก้ไข ลบ และปรับแต้มที่ส่วนกลาง</p>
      </div>
      <div class="ui-page-head__actions">
        <button type="button" class="ui-btn ui-btn--ghost" :disabled="pending" @click="load">
          {{ pending ? "กำลังโหลด..." : "รีเฟรช" }}
        </button>
        <NuxtLink to="/members/points" class="ui-btn ui-btn--ghost">ประวัติแต้ม</NuxtLink>
        <NuxtLink
          to="/member"
          class="ui-btn ui-btn--ghost"
          target="_blank"
          title="ต้องเปิดด้วยลิงก์ QR (?k=…)"
        >
          หน้าลูกค้า
        </NuxtLink>
        <button type="button" class="ui-btn ui-btn--primary" @click="openCreate">
          + เพิ่มสมาชิก
        </button>
      </div>
    </div>

    <div v-if="error && !modalOpen" class="ui-empty">{{ error }}</div>

    <div class="ui-card">
      <div class="ui-card__toolbar">
        <div class="ui-toolbar-search">
          <span class="ui-toolbar-search__meta">
            สมาชิก {{ meta.total }} รายการ
            · เรียงตาม {{ sortLabel }}
            {{
              sortKey === "createdAt" || sortKey === "lastUsedAt"
                ? sortDir === "desc"
                  ? "ใหม่→เก่า"
                  : "เก่า→ใหม่"
                : sortDir === "desc"
                  ? "มาก→น้อย"
                  : "น้อย→มาก"
            }}
          </span>
          <div class="ui-toolbar-search__controls">
            <input
              v-model="q"
              class="ui-input"
              type="search"
              placeholder="ค้นหาชื่อ / รหัส / เบอร์..."
              aria-label="ค้นหาสมาชิก"
            />
          </div>
        </div>
      </div>
      <div v-if="pending && !rows.length" class="ui-empty">กำลังโหลด...</div>
      <div v-else-if="!pageRows.length" class="ui-empty">ไม่พบข้อมูล</div>
      <div v-else class="ui-table-wrap">
        <table class="ui-table ui-table--fit">
          <thead>
            <tr>
              <th>
                <button type="button" class="ui-th-sort" @click="toggleSort('code')">
                  รหัส{{ sortMark("code") }}
                </button>
              </th>
              <th>
                <button type="button" class="ui-th-sort" @click="toggleSort('name')">
                  ชื่อ{{ sortMark("name") }}
                </button>
              </th>
              <th>
                <button type="button" class="ui-th-sort" @click="toggleSort('phone')">
                  เบอร์{{ sortMark("phone") }}
                </button>
              </th>
              <th>
                <button type="button" class="ui-th-sort" @click="toggleSort('points')">
                  แต้ม{{ sortMark("points") }}
                </button>
              </th>
              <th>
                <button
                  type="button"
                  class="ui-th-sort"
                  @click="toggleSort('createdAt')"
                >
                  สมัคร{{ sortMark("createdAt") }}
                </button>
              </th>
              <th>
                <button
                  type="button"
                  class="ui-th-sort"
                  @click="toggleSort('lastUsedAt')"
                >
                  ใช้ล่าสุด{{ sortMark("lastUsedAt") }}
                </button>
              </th>
              <th class="ui-table__actions">จัดการ</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in pageRows" :key="row.id">
              <td>{{ row.code }}</td>
              <td>{{ row.name }}</td>
              <td>{{ row.phone || "-" }}</td>
              <td>
                <strong>{{ row.points.toLocaleString("th-TH") }}</strong>
              </td>
              <td class="ui-members__when">{{ formatWhen(row.createdAt) }}</td>
              <td class="ui-members__when">
                {{ row.lastUsedAt ? formatWhen(row.lastUsedAt) : "ยังไม่เคยใช้" }}
              </td>
              <td class="ui-table__actions">
                <div class="ui-members__actions">
                  <NuxtLink
                    :to="`/members/points?id=${row.id}&q=${encodeURIComponent(row.phone || row.code)}`"
                    class="ui-btn ui-btn--ghost"
                    title="ประวัติแต้ม"
                  >
                    แต้ม
                  </NuxtLink>
                  <button
                    type="button"
                    class="ui-btn ui-btn--ghost"
                    @click="openEdit(row)"
                  >
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
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <UiPagination :meta="meta" @change="onPageChange" />
    </div>

    <div v-if="modalOpen" class="ui-modal">
      <form
        class="ui-modal__panel"
        role="dialog"
        aria-modal="true"
        @submit.prevent="save"
      >
        <div class="ui-modal__head">
          <h2>{{ editingId ? "แก้ไขสมาชิก" : "เพิ่มสมาชิก" }}</h2>
          <button class="ui-icon-btn" type="button" @click="closeModal">×</button>
        </div>
        <div class="ui-modal__body">
          <div class="ui-form-grid">
            <label class="ui-field">
              <span>รหัสสมาชิก (ออโต้)</span>
              <input
                v-model="form.code"
                class="ui-input"
                type="text"
                readonly
                tabindex="-1"
                title="ออกเลขอัตโนมัติ"
              />
            </label>
            <label class="ui-field">
              <span>ชื่อ *</span>
              <input
                ref="nameInput"
                v-model="form.name"
                class="ui-input"
                type="text"
                enterkeyhint="next"
                autocomplete="name"
                @keydown.enter.prevent="onFieldEnter('name')"
              />
            </label>
            <label class="ui-field">
              <span>เบอร์โทร *</span>
              <input
                ref="phoneInput"
                v-model="form.phone"
                class="ui-input"
                type="tel"
                inputmode="tel"
                enterkeyhint="next"
                autocomplete="tel"
                @keydown.enter.prevent="onFieldEnter('phone')"
              />
            </label>
            <label class="ui-field">
              <span>แต้ม</span>
              <input
                ref="pointsInput"
                v-model="form.points"
                class="ui-input"
                type="number"
                min="0"
                step="1"
                enterkeyhint="done"
                @keydown.enter.prevent="onFieldEnter('points')"
              />
            </label>
          </div>
          <p v-if="error && modalOpen" class="ui-members__form-error">{{ error }}</p>
        </div>
        <div class="ui-modal__foot">
          <button type="button" class="ui-btn ui-btn--ghost" @click="closeModal">ยกเลิก</button>
          <button
            type="submit"
            class="ui-btn ui-btn--primary"
            :disabled="saving"
          >
            {{ saving ? "กำลังบันทึก..." : "บันทึก" }}
          </button>
        </div>
      </form>
    </div>
  </div>
</template>

<style scoped>
.ui-members :deep(.ui-table--fit .ui-table__actions) {
  width: 11.5rem;
  max-width: 11.5rem;
  white-space: normal;
  overflow: hidden;
  text-align: right !important;
  vertical-align: middle;
  padding-left: 0.5rem;
  padding-right: 0.85rem;
}

.ui-members__actions {
  display: inline-flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 0.25rem;
  max-width: 100%;
}

.ui-members__actions :deep(.ui-btn),
.ui-members__actions .ui-btn {
  margin: 0 !important;
  padding: 0.35rem 0.55rem;
  font-size: 0.8rem;
  line-height: 1.2;
}

.ui-members__form-error {
  margin: 0.75rem 0 0;
  color: #b91c1c;
  font-size: 0.88rem;
}

.ui-members__when {
  white-space: nowrap;
  font-size: 0.86rem;
  color: #475569;
}
</style>
