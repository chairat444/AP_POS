<script setup lang="ts">
definePageMeta({ layout: "auth" });

const { login } = useAuth();
const config = useRuntimeConfig();
const appName = computed(() => String(config.public.appName || "AP POS Admin"));
const apiBase = computed(() =>
  String(config.public.apiBase || "/api").replace(/\/$/, ""),
);

const brandName = ref("");
const brandLogo = ref("");
const brandTag = ref("");
const displayName = computed(() => brandName.value || appName.value);
const logoSrc = computed(() => {
  if (!brandLogo.value) return "/favicon.png";
  if (
    brandLogo.value.startsWith("http") ||
    brandLogo.value.startsWith("data:")
  ) {
    return brandLogo.value;
  }
  return `${apiBase.value}${brandLogo.value.startsWith("/") ? "" : "/"}${brandLogo.value}`;
});

const code = ref("");
const password = ref("");
const showPassword = ref(false);
const pending = ref(false);
const error = ref("");

async function loadBranding() {
  try {
    const data = await $fetch<{
      storeName?: string;
      storeTagline?: string;
      logoUrl?: string | null;
    }>(`${apiBase.value}/settings/branding`);
    brandName.value = data.storeName?.trim() || "";
    brandTag.value = data.storeTagline?.trim() || "";
    brandLogo.value = data.logoUrl || "";
  } catch {
    /* ignore — ใช้ค่า default */
  }
}

async function onSubmit() {
  pending.value = true;
  error.value = "";
  try {
    await login(code.value.trim(), password.value);
    await navigateTo("/");
  } catch (e: unknown) {
    const msg =
      (e as { data?: { message?: string | string[] } })?.data?.message ??
      (e as Error)?.message ??
      "เข้าสู่ระบบไม่สำเร็จ";
    error.value = Array.isArray(msg) ? msg.join(", ") : String(msg);
  } finally {
    pending.value = false;
  }
}

onMounted(loadBranding);
</script>

<template>
  <div class="ui-login">
    <div class="ui-login__card">
      <div class="ui-login__brand">
        <img class="ui-login__logo" :src="logoSrc" alt="" width="88" height="88" />
        <p class="ui-login__eyebrow">Backoffice</p>
        <h1>{{ displayName }}</h1>
        <p>{{ brandTag || "จัดการสินค้า สมาชิก พนักงาน และรายงานยอดขาย" }}</p>
      </div>
      <form class="ui-login__form" @submit.prevent="onSubmit">
        <h2>เข้าสู่ระบบ</h2>
        <p class="ui-login__hint">ใช้รหัสพนักงานกับรหัสผ่านที่ได้รับจากผู้ดูแล</p>
        <label class="ui-field">
          <span>รหัสพนักงาน</span>
          <input
            v-model="code"
            class="ui-input"
            type="text"
            name="username"
            autocomplete="username"
            autocapitalize="off"
            spellcheck="false"
          />
        </label>
        <label class="ui-field">
          <span>รหัสผ่าน</span>
          <div class="ui-password-field">
            <input
              v-model="password"
              class="ui-input"
              :type="showPassword ? 'text' : 'password'"
              name="password"
              autocomplete="current-password"
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
        </label>
        <p v-if="error" class="ui-login__error">{{ error }}</p>
        <button type="submit" class="ui-btn ui-btn--primary ui-login__submit" :disabled="pending">
          {{ pending ? "กำลังเข้าสู่ระบบ..." : "เข้าสู่ระบบ" }}
        </button>
      </form>
    </div>
  </div>
</template>

<style scoped>
.ui-login__logo {
  width: 6.5rem;
  height: 6.5rem;
  object-fit: contain;
  object-position: center;
  border-radius: 1rem;
  margin: 0 auto 0.75rem;
  display: block;
  background: transparent;
  padding: 0.25rem;
}
.ui-login .ui-password-field__toggle svg {
  width: 0.95rem;
  height: 0.95rem;
  stroke-width: 1.5;
}
</style>
