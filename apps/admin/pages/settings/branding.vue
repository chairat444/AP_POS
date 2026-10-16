<script setup lang="ts">
type BrandingConfig = {
  storeName: string;
  storeTagline: string;
  logoUrl: string | null;
};

type SettingsRecord = {
  branding?: BrandingConfig;
};

const { get, post, upload, assetUrl } = useAdminApi();
const pending = ref(false);
const saving = ref(false);
const error = ref("");
const ok = ref("");
const form = reactive({
  storeName: "AP หมูสด",
  storeTagline: "Fresh Pork POS",
  logoUrl: "" as string,
});
const imageFile = ref<File | null>(null);
const imagePreview = ref("");
const removeLogo = ref(false);
const fileInput = ref<HTMLInputElement | null>(null);

const previewSrc = computed(() => {
  if (imagePreview.value) return imagePreview.value;
  if (removeLogo.value) return "";
  return form.logoUrl ? assetUrl(form.logoUrl) : "";
});

async function load() {
  pending.value = true;
  error.value = "";
  ok.value = "";
  try {
    const data = await get<SettingsRecord>("/settings");
    form.storeName = data.branding?.storeName || "AP หมูสด";
    form.storeTagline = data.branding?.storeTagline || "Fresh Pork POS";
    form.logoUrl = data.branding?.logoUrl || "";
    imageFile.value = null;
    imagePreview.value = "";
    removeLogo.value = false;
  } catch (e) {
    error.value = e instanceof Error ? e.message : "โหลดตั้งค่าไม่สำเร็จ";
  } finally {
    pending.value = false;
  }
}

function onPickFile(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  imageFile.value = file;
  removeLogo.value = false;
  imagePreview.value = URL.createObjectURL(file);
}

function clearPicked() {
  imageFile.value = null;
  imagePreview.value = "";
  if (fileInput.value) fileInput.value.value = "";
}

function markRemoveLogo() {
  clearPicked();
  removeLogo.value = true;
}

async function save() {
  saving.value = true;
  error.value = "";
  ok.value = "";
  try {
    await post("/settings/branding", {
      storeName: form.storeName.trim(),
      storeTagline: form.storeTagline.trim(),
    });
    if (imageFile.value) {
      const fd = new FormData();
      fd.append("file", imageFile.value);
      await upload("/settings/logo", fd);
    } else if (removeLogo.value && form.logoUrl) {
      await post("/settings/logo/clear");
    }
    ok.value = "บันทึกแล้ว — Admin/POS จะใช้โลโก้ใหม่ (POS ตอน sync)";
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

onMounted(load);
</script>

<template>
  <div>
    <div class="ui-page-head">
      <div>
        <h1 class="ui-page-title">โลโก้ร้าน</h1>
        <p class="ui-page-sub">
          อัปโหลดโลโก้และชื่อร้าน · แสดงใน Admin, POS และจอลูกค้า
        </p>
      </div>
      <div class="ui-page-head__actions">
        <button type="button" class="ui-btn ui-btn--ghost" :disabled="pending" @click="load">
          {{ pending ? "กำลังโหลด..." : "รีเฟรช" }}
        </button>
        <button type="button" class="ui-btn ui-btn--primary" :disabled="saving" @click="save">
          {{ saving ? "กำลังบันทึก..." : "บันทึก" }}
        </button>
      </div>
    </div>

    <div v-if="error" class="ui-empty">{{ error }}</div>
    <div v-if="ok" class="ui-empty" style="color: #0f5a3d">{{ ok }}</div>

    <div class="ui-card ui-branding-card">
      <div class="ui-branding-grid">
        <div class="ui-branding-preview">
          <div class="ui-branding-preview__frame">
            <img v-if="previewSrc" :src="previewSrc" alt="โลโก้ร้าน" />
            <span v-else>ยังไม่มีโลโก้</span>
          </div>
          <div class="ui-branding-preview__actions">
            <button type="button" class="ui-btn ui-btn--ghost" @click="fileInput?.click()">
              เลือกไฟล์รูป
            </button>
            <button
              v-if="previewSrc || form.logoUrl"
              type="button"
              class="ui-btn ui-btn--ghost-danger"
              @click="markRemoveLogo"
            >
              ลบโลโก้
            </button>
          </div>
          <input
            ref="fileInput"
            class="ui-branding-file"
            type="file"
            accept="image/*"
            @change="onPickFile"
          />
          <p class="ui-field-hint">
            รองรับ JPG/PNG · สูงสุด 5MB · แนะนำ PNG พื้นหลังโปร่งใส · แสดงแบบเก็บสัดส่วนจริง
          </p>
        </div>

        <div class="ui-branding-fields">
          <label class="ui-field">
            <span>ชื่อร้าน</span>
            <input v-model="form.storeName" class="ui-input" type="text" maxlength="80" />
          </label>
          <label class="ui-field">
            <span>คำโปรย / Tagline</span>
            <input v-model="form.storeTagline" class="ui-input" type="text" maxlength="120" />
          </label>
          <p class="ui-field-hint">
            ใช้ในแถบข้าง Admin, หน้า login, หน้าแคชเชียร์ และจอลูกค้า
          </p>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ui-branding-card {
  padding: 1.25rem 1.35rem 1.4rem;
}
.ui-branding-grid {
  display: grid;
  grid-template-columns: minmax(12rem, 16rem) minmax(0, 1fr);
  gap: 1.5rem;
  align-items: start;
}
.ui-branding-preview__frame {
  width: 100%;
  aspect-ratio: 1;
  border-radius: 1rem;
  border: 1px solid #e2e8f0;
  background-color: #f8fafc;
  background-image:
    linear-gradient(45deg, #e2e8f0 25%, transparent 25%),
    linear-gradient(-45deg, #e2e8f0 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, #e2e8f0 75%),
    linear-gradient(-45deg, transparent 75%, #e2e8f0 75%);
  background-size: 16px 16px;
  background-position: 0 0, 0 8px, 8px -8px, -8px 0;
  display: grid;
  place-items: center;
  overflow: hidden;
  color: #94a3b8;
  font-size: 0.9rem;
  padding: 0.85rem;
  box-sizing: border-box;
}
.ui-branding-preview__frame img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  object-position: center;
  display: block;
}
.ui-branding-preview__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-top: 0.75rem;
}
.ui-branding-file {
  display: none;
}
.ui-branding-fields {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}
@media (max-width: 720px) {
  .ui-branding-grid {
    grid-template-columns: 1fr;
  }
}
</style>
