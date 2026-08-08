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
  { key: "transfer", label: "ร้าน (ส่งหลุมดิน)" },
  { key: "makro", label: "แม็คโค" },
];

const { get, post, patch } = useAdminApi();
const pending = ref(false);
const saving = ref(false);
const error = ref("");
const items = ref<CatalogItem[]>([]);
const q = ref("");
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

function groupLabel(key: string) {
  return GROUPS.find((g) => g.key === key)?.label ?? key;
}

async function load() {
  pending.value = true;
  error.value = "";
  try {
    const data = await get<{ items: CatalogItem[] }>("/purchases/catalog");
    items.value = data.items ?? [];
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

async function save() {
  if (!form.name.trim()) {
    error.value = "ใส่ชื่อสินค้า";
    return;
  }
  saving.value = true;
  error.value = "";
  try {
    const body = {
      name: form.name.trim(),
      aliases: form.aliases.trim(),
      groupKey: form.groupKey,
      unit: form.unit.trim() || null,
    };
    if (editingId.value) {
      await patch(`/purchases/catalog/${editingId.value}`, body);
    } else {
      await post("/purchases/catalog", body);
    }
    modalOpen.value = false;
    await load();
  } catch (e) {
    error.value = e instanceof Error ? e.message : "บันทึกไม่สำเร็จ";
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
        <h1 class="ui-page-title">ตั้งค่าชื่อสินค้า → ร้าน</h1>
        <p class="ui-page-sub">
          map ชื่อที่น้องพิมพ์ (และชื่อเรียกอื่น) ไปคอลัมน์ร้านลูกชิ้น / ตลาด / ผัก / ส่งหลุมดิน / แม็คโค
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
    </div>

    <div v-if="error && !modalOpen" class="ui-empty">{{ error }}</div>

    <div class="ui-card">
      <div v-if="pending && !items.length" class="ui-empty">กำลังโหลด...</div>
      <div v-else class="ui-table-wrap">
        <table class="ui-table ui-table--fit">
          <thead>
            <tr>
              <th>ชื่อมาตรฐาน</th>
              <th>ชื่อเรียกอื่น</th>
              <th>ร้าน</th>
              <th class="ui-table__actions">จัดการ</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in filtered" :key="row.id">
              <td>{{ row.name }}</td>
              <td>{{ row.aliases || "-" }}</td>
              <td>{{ groupLabel(row.groupKey) }}</td>
              <td class="ui-table__actions">
                <button type="button" class="ui-btn ui-btn--ghost" @click="openEdit(row)">
                  แก้ไข
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div v-if="modalOpen" class="ui-modal">
      <div class="ui-modal__panel" role="dialog">
        <div class="ui-modal__head">
          <h2>{{ editingId ? "แก้ไข" : "เพิ่มชื่อสินค้า" }}</h2>
          <button class="ui-icon-btn" type="button" @click="modalOpen = false">×</button>
        </div>
        <div class="ui-modal__body">
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
          <button type="button" class="ui-btn ui-btn--ghost" @click="modalOpen = false">
            ยกเลิก
          </button>
          <button
            type="button"
            class="ui-btn ui-btn--primary"
            :disabled="saving"
            @click="save"
          >
            บันทึก
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
