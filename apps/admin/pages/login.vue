<script setup lang="ts">
definePageMeta({ layout: "auth" });

const { login } = useAuth();
const config = useRuntimeConfig();
const appName = computed(() => String(config.public.appName || "AP POS Admin"));
const apiBase = computed(() =>
  String(config.public.apiBase || "http://127.0.0.1:3000").replace(/\/$/, ""),
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

const code = ref("admin");
const password = ref("admin123");
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
        <p class="ui-login__hint">ใช้รหัสพนักงาน + รหัสผ่าน (บัญชีเริ่มต้น admin / admin123)</p>
        <label class="ui-field">
          <span>รหัสพนักงาน</span>
          <input v-model="code" class="ui-input" type="text" autocomplete="username" />
        </label>
        <label class="ui-field">
          <span>รหัสผ่าน</span>
          <input
            v-model="password"
            class="ui-input"
            type="password"
            autocomplete="current-password"
          />
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
</style>
