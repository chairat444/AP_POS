<script setup lang="ts">
import { maybeWrapWafRequestBody } from "@ap-pos/shared";

definePageMeta({ layout: false });

useHead({
  meta: [
    {
      name: "viewport",
      content:
        "width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content",
    },
  ],
});

type Step =
  | "home"
  | "check"
  | "check-result"
  | "join"
  | "join-done"
  | "not-found";

type MemberView = {
  code: string;
  name: string;
  points: number;
  phone?: string;
  lineLinked?: boolean;
  linked?: boolean;
};

type KioskHit = {
  found: boolean;
  code?: string;
  name?: string;
  phone?: string;
  points?: number;
  lineLinked?: boolean;
  linked?: boolean;
};

const config = useRuntimeConfig();
const route = useRoute();
const apiBase = computed(() =>
  String(config.public.apiBase || "/api").replace(/\/$/, ""),
);

const brandName = ref("เอพีหมูสด");
const brandLogo = ref("");
const step = ref<Step>("home");
const phone = ref("");
const name = ref("");
const pending = ref(false);
const error = ref("");
const member = ref<MemberView | null>(null);
/** รหัสจาก QR (?k=) — เก็บ session ไว้ช่วงเปิดหน้า */
const accessKey = ref("");
const ready = ref(false);
/** เปิดจากลิงก์ LINE OA (`&src=line`) หรือ LIFF */
const fromLine = ref(false);
const lineIdToken = ref("");
const lineBound = ref(false);
/** เช็คเบอร์อื่นจากผลลัพธ์ — ดูอย่างเดียว ไม่ผูกไลน์ */
const checkOtherOnly = ref(false);
const lineOffer = ref({ active: false, points: 0, headline: "" });

const hasAccess = computed(() => Boolean(accessKey.value));
const showLineBonus = computed(
  () =>
    fromLine.value &&
    lineOffer.value.active &&
    lineOffer.value.points > 0,
);

function kioskOpts() {
  return {
    headers: { "x-member-kiosk-key": accessKey.value },
    timeout: 30_000 as const,
  };
}

const PAD_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫"] as const;

let idleTimer: ReturnType<typeof setTimeout> | null = null;
const IDLE_MS = 45_000;

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

const phoneDisplay = computed(() => {
  const d = phone.value;
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}-${d.slice(3)}`;
  return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
});

function clearIdle() {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
}

function armIdle() {
  if (fromLine.value || lineBound.value) return;
  clearIdle();
  idleTimer = setTimeout(() => resetHome(), IDLE_MS);
}

function resetHome() {
  clearIdle();
  step.value = "home";
  phone.value = "";
  name.value = "";
  error.value = "";
  member.value = null;
  pending.value = false;
  checkOtherOnly.value = false;
}

function applyHit(data: KioskHit) {
  member.value = {
    code: data.code || "",
    name: data.name || "",
    points: Number(data.points) || 0,
    phone: data.phone,
    lineLinked: Boolean(data.lineLinked),
    linked: Boolean(data.linked),
  };
  const p = String(data.phone ?? "").replace(/\D/g, "").slice(0, 10);
  if (p) phone.value = p;
}

async function goCheck() {
  phone.value = "";
  error.value = "";
  member.value = null;
  checkOtherOnly.value = false;
  if (lineIdToken.value) {
    pending.value = true;
    try {
      const data = await apiLookupLine();
      if (data.found) {
        applyHit(data);
        step.value = "check-result";
        return;
      }
    } catch {
      /* ใส่เบอร์เอง */
    } finally {
      pending.value = false;
    }
  }
  step.value = "check";
}

function goCheckOther() {
  phone.value = "";
  error.value = "";
  member.value = null;
  checkOtherOnly.value = true;
  step.value = "check";
}

function goJoin(keepPhone = false) {
  if (!keepPhone) phone.value = "";
  name.value = "";
  error.value = "";
  member.value = null;
  checkOtherOnly.value = false;
  step.value = "join";
  void nextTick(() => {
    nameInput.value?.focus();
    scrollFieldIntoView(nameInput.value);
  });
}

const nameInput = ref<HTMLInputElement | null>(null);
const phoneInput = ref<HTMLInputElement | null>(null);

function scrollFieldIntoView(el: HTMLElement | null | undefined) {
  if (!el) return;
  // รอแป้นพิมพ์เด้ง แล้วเลื่อนช่องให้อยู่เหนือแป้น
  window.setTimeout(() => {
    el.scrollIntoView({ block: "center", behavior: "smooth" });
  }, 280);
}

function onNameEnter() {
  phoneInput.value?.focus();
  scrollFieldIntoView(phoneInput.value);
}

function onPhoneTyped(raw: string) {
  error.value = "";
  phone.value = String(raw).replace(/\D/g, "").slice(0, 10);
}

function onPhoneInput(e: Event) {
  const t = e.target as HTMLInputElement | null;
  onPhoneTyped(t?.value ?? "");
}

function onPad(key: string) {
  error.value = "";
  if (key === "⌫") {
    phone.value = phone.value.slice(0, -1);
    return;
  }
  if (!/^\d$/.test(key)) return;
  if (phone.value.length >= 10) return;
  phone.value += key;
}

async function apiLookupPhone() {
  return await $fetch<KioskHit>(`${apiBase.value}/members/kiosk/lookup`, {
    query: { phone: phone.value },
    ...kioskOpts(),
  });
}

async function apiLookupLine(phoneOverride?: string) {
  return await $fetch<KioskHit>(`${apiBase.value}/members/kiosk/lookup`, {
    method: "POST",
    body: maybeWrapWafRequestBody({
      idToken: lineIdToken.value || undefined,
      phone: phoneOverride ?? (phone.value || undefined),
    }) as Record<string, unknown>,
    ...kioskOpts(),
  });
}

async function submitCheck() {
  if (phone.value.length < 9) {
    error.value = "กรอกเบอร์ให้ครบ";
    return;
  }
  pending.value = true;
  error.value = "";
  try {
    const data =
      lineIdToken.value && !checkOtherOnly.value
        ? await apiLookupLine()
        : await apiLookupPhone();
    if (!data.found) {
      step.value = "not-found";
      armIdle();
      return;
    }
    applyHit(data);
    step.value = "check-result";
    armIdle();
  } catch (e: unknown) {
    error.value = errMsg(e, "ค้นหาไม่สำเร็จ · ลองอีกครั้ง");
  } finally {
    pending.value = false;
  }
}

async function submitJoin() {
  const n = name.value.trim();
  if (!n) {
    error.value = "กรอกชื่อ";
    return;
  }
  if (phone.value.length < 9) {
    error.value = "กรอกเบอร์ให้ครบ";
    return;
  }
  pending.value = true;
  error.value = "";
  try {
    const data = await $fetch<{
      code: string;
      name: string;
      points: number;
    }>(`${apiBase.value}/members/kiosk/register`, {
      method: "POST",
      body: maybeWrapWafRequestBody({
        name: n,
        phone: phone.value,
        source: fromLine.value || lineBound.value ? "line" : undefined,
        idToken: lineIdToken.value || undefined,
      }) as Record<string, unknown>,
      ...kioskOpts(),
    });
    member.value = {
      code: data.code,
      name: data.name,
      points: Number(data.points) || 0,
    };
    step.value = "join-done";
    armIdle();
  } catch (e: unknown) {
    const msg = errMsg(e, "สมัครไม่สำเร็จ");
    // เบอร์ซ้ำ → ดึงแต้มให้เลย
    if (/มีสมาชิกแล้ว/.test(msg)) {
      try {
        const data = lineIdToken.value
          ? await apiLookupLine()
          : await apiLookupPhone();
        if (data.found) {
          applyHit(data);
          error.value = "เบอร์นี้เป็นสมาชิกแล้ว";
          step.value = "check-result";
          armIdle();
          return;
        }
      } catch {
        /* fall through */
      }
    }
    error.value = msg;
  } finally {
    pending.value = false;
  }
}

function errMsg(e: unknown, fallback: string) {
  const raw =
    (e as { data?: { message?: string | string[] } })?.data?.message ??
    (e as Error)?.message ??
    fallback;
  return Array.isArray(raw) ? raw.join(", ") : String(raw);
}

function formatPoints(n: number) {
  return n.toLocaleString("th-TH");
}

async function loadBranding() {
  try {
    const data = await $fetch<{
      storeName?: string;
      logoUrl?: string | null;
    }>(`${apiBase.value}/settings/branding`);
    if (data.storeName?.trim()) brandName.value = data.storeName.trim();
    brandLogo.value = data.logoUrl || "";
  } catch {
    /* default */
  }
}

function resolveAccessKey() {
  const fromQuery = String(route.query.k ?? "").trim();
  if (fromQuery) {
    try {
      sessionStorage.setItem("member-kiosk-k", fromQuery);
    } catch {
      /* private mode */
    }
    accessKey.value = fromQuery;
    return;
  }
  try {
    accessKey.value = sessionStorage.getItem("member-kiosk-k") || "";
  } catch {
    accessKey.value = "";
  }
}

function resolveLineSource() {
  const q = String(route.query.src ?? route.query.from ?? "")
    .trim()
    .toLowerCase();
  if (q === "line" || q === "oa" || q === "liff") {
    try {
      sessionStorage.setItem("member-kiosk-src", "line");
    } catch {
      /* private mode */
    }
    fromLine.value = true;
    return;
  }
  try {
    fromLine.value = sessionStorage.getItem("member-kiosk-src") === "line";
  } catch {
    fromLine.value = false;
  }
}

type LineLiff = {
  init: (opts: { liffId: string }) => Promise<void>;
  isLoggedIn: () => boolean;
  isInClient: () => boolean;
  login: () => void;
  getIDToken?: () => string | null;
  getProfile: () => Promise<{ displayName?: string }>;
};

async function initLiff() {
  const liffId = String(config.public.lineLiffId || "").trim();
  if (!liffId || typeof window === "undefined") return;
  try {
    const w = window as Window & { liff?: LineLiff };
    if (!w.liff) {
      await new Promise<void>((resolve, reject) => {
        const s = document.createElement("script");
        s.src = "https://static.line-scdn.net/liff/edge/2/sdk.js";
        s.onload = () => resolve();
        s.onerror = () => reject(new Error("liff"));
        document.head.appendChild(s);
      });
    }
    const liff = (window as Window & { liff: LineLiff }).liff;
    await liff.init({ liffId });
    if (!liff.isLoggedIn()) {
      if (liff.isInClient()) liff.login();
      return;
    }
    fromLine.value = true;
    lineBound.value = true;
    lineIdToken.value = liff.getIDToken?.() || "";
    try {
      const profile = await liff.getProfile();
      if (!name.value.trim() && profile.displayName) {
        name.value = profile.displayName;
      }
    } catch {
      /* ยังไม่เปิด scope profile */
    }
  } catch {
    /* เปิดจากเว็บ/QR ปกติ */
  }
}

async function loadLineOffer() {
  if (!hasAccess.value) return;
  try {
    const data = await $fetch<{
      active?: boolean;
      points?: number;
      headline?: string;
    }>(`${apiBase.value}/members/kiosk/offer`, {
      query: { k: accessKey.value },
      ...kioskOpts(),
      timeout: 15_000,
    });
    const points = Math.max(0, Math.floor(Number(data.points) || 0));
    lineOffer.value = {
      active: Boolean(data.active) && points > 0,
      points,
      headline: String(data.headline ?? "").trim(),
    };
  } catch {
    lineOffer.value = { active: false, points: 0, headline: "" };
  }
}

async function tryAutoLineCheck() {
  if (!hasAccess.value || !lineIdToken.value) return;
  try {
    const data = await apiLookupLine();
    if (data.found) {
      applyHit(data);
      step.value = "check-result";
    }
  } catch {
    /* ยังไม่ผูก — อยู่หน้าแรก */
  }
}

onMounted(async () => {
  resolveAccessKey();
  resolveLineSource();
  await initLiff();
  if (hasAccess.value) {
    await Promise.all([loadBranding(), loadLineOffer()]);
    await tryAutoLineCheck();
  }
  ready.value = true;
});
onBeforeUnmount(clearIdle);
</script>

<template>
  <div class="mk">
    <div class="mk__bg" aria-hidden="true" />

    <!-- ไม่มีรหัสจาก QR -->
    <section v-if="ready && !hasAccess" class="mk__panel mk__result">
      <header class="mk__brand">
        <img class="mk__logo" :src="logoSrc" alt="" width="96" height="96" />
        <h1>{{ brandName }}</h1>
        <p>สมาชิก · สะสมแต้ม</p>
      </header>
      <h2 class="mk__title">สแกน QR จากร้าน</h2>
      <p class="mk__lead">
        เปิดลิงก์จากคิวอาร์โค้ดที่ร้านเท่านั้น จึงจะสมัครหรือเช็คแต้มได้
      </p>
    </section>

    <!-- หน้าแรก -->
    <section v-else-if="ready && step === 'home'" class="mk__panel mk__home">
      <header class="mk__brand">
        <img class="mk__logo" :src="logoSrc" alt="" width="96" height="96" />
        <h1>{{ brandName }}</h1>
        <p>สมาชิก · สะสมแต้ม</p>
      </header>

      <div class="mk__card">
        <p v-if="showLineBonus" class="mk__line-bonus">
          {{ lineOffer.headline }}
        </p>
        <ul class="mk__perk-list">
          <li>
            <strong>100 บาท</strong>
            <span>ได้ 1 แต้ม</span>
          </li>
          <li>
            <strong>1 แต้ม</strong>
            <span>= 1 บาท</span>
          </li>
          <li>
            <strong>ไม่หมดอายุ</strong>
            <span>ใช้ได้เรื่อยไป</span>
          </li>
        </ul>
      </div>

      <div class="mk__actions">
        <button type="button" class="mk__tile mk__tile--check" @click="goCheck">
          <strong>เช็คแต้ม</strong>
          <span class="mk__tile-hint">ใส่เบอร์โทร</span>
        </button>
        <button type="button" class="mk__tile mk__tile--join" @click="goJoin">
          <strong>สมัครสมาชิก</strong>
          <span class="mk__tile-hint">{{
            showLineBonus ? `รับ ${lineOffer.points} แต้ม` : "สมัครฟรี"
          }}</span>
        </button>
      </div>
    </section>

    <!-- เช็คแต้ม · ใส่เบอร์ -->
    <section v-else-if="step === 'check'" class="mk__panel">
      <button type="button" class="mk__back" @click="resetHome">← กลับ</button>
      <h2 class="mk__title">เช็คแต้ม</h2>
      <p class="mk__lead">ใส่เบอร์โทร</p>

      <div class="mk__phone" :class="{ 'is-ready': phone.length >= 9 }">
        {{ phoneDisplay || "0xx-xxx-xxxx" }}
      </div>
      <p v-if="error" class="mk__err">{{ error }}</p>

      <div class="mk__pad" role="group" aria-label="แป้นเบอร์">
        <button
          v-for="(key, i) in PAD_KEYS"
          :key="i"
          type="button"
          class="mk__key"
          :class="{ 'is-ghost': !key }"
          :disabled="!key || pending"
          @click="key && onPad(key)"
        >
          {{ key === "⌫" ? "ลบ" : key }}
        </button>
      </div>

      <button
        type="button"
        class="mk__primary"
        :disabled="pending || phone.length < 9"
        @click="submitCheck"
      >
        {{ pending ? "กำลังค้นหา..." : "ดูแต้ม" }}
      </button>
    </section>

    <!-- ผลเช็คแต้ม -->
    <section
      v-else-if="step === 'check-result' && member"
      class="mk__panel mk__result"
    >
      <p v-if="error" class="mk__note">{{ error }}</p>
      <p v-else-if="fromLine || lineBound" class="mk__note">
        บอกเบอร์ {{ phoneDisplay }}
      </p>
      <p class="mk__hello">สวัสดีคุณ</p>
      <h2 class="mk__name">{{ member.name }}</h2>
      <p class="mk__code">รหัส {{ member.code }}</p>

      <div class="mk__points">
        <span>แต้มสะสม</span>
        <strong>{{ formatPoints(member.points) }}</strong>
      </div>

      <div class="mk__result-actions">
        <button type="button" class="mk__primary" @click="resetHome">
          เสร็จสิ้น
        </button>
        <button type="button" class="mk__ghost" @click="goCheckOther">
          เช็คเบอร์อื่น
        </button>
      </div>
      <p v-if="!(fromLine || lineBound)" class="mk__idle">จะกลับหน้าแรกอัตโนมัติ</p>
    </section>

    <!-- ไม่พบ -->
    <section v-else-if="step === 'not-found'" class="mk__panel mk__result">
      <h2 class="mk__title">ยังไม่พบสมาชิก</h2>
      <p class="mk__lead">เบอร์ {{ phoneDisplay }} ยังไม่มีในระบบ</p>
      <div class="mk__result-actions">
        <button type="button" class="mk__primary" @click="goJoin(true)">
          สมัครสมาชิก
        </button>
        <button type="button" class="mk__ghost" @click="goCheck">
          ลองเบอร์อื่น
        </button>
        <button type="button" class="mk__ghost" @click="resetHome">
          กลับหน้าแรก
        </button>
      </div>
    </section>

    <!-- สมัคร · ชื่อ + เบอร์ หน้าเดียว (ใช้แป้นมือถือ ไม่ใช้ปุ่มกดเอง) -->
    <section v-else-if="step === 'join'" class="mk__panel mk__join">
      <button type="button" class="mk__back" @click="resetHome">← กลับ</button>
      <p class="mk__shop">{{ brandName }}</p>
      <h2 class="mk__title">สมัครสมาชิก</h2>
      <p v-if="showLineBonus" class="mk__line-bonus">{{ lineOffer.headline }}</p>
      <p class="mk__lead">กรอกชื่อกับเบอร์โทร · กดถัดไปเพื่อไปช่องถัดไป</p>

      <label class="mk__field">
        <span>1. ชื่อของคุณ</span>
        <input
          ref="nameInput"
          v-model="name"
          class="mk__text"
          type="text"
          inputmode="text"
          enterkeyhint="next"
          autocomplete="name"
          placeholder="เช่น สมชาย"
          maxlength="80"
          :disabled="pending"
          @focus="scrollFieldIntoView(nameInput)"
          @keydown.enter.prevent="onNameEnter"
        />
      </label>

      <label class="mk__field">
        <span>2. เบอร์โทร</span>
        <input
          ref="phoneInput"
          class="mk__text mk__text--phone"
          :class="{ 'is-ready': phone.length >= 9 }"
          type="tel"
          inputmode="numeric"
          pattern="[0-9]*"
          enterkeyhint="done"
          autocomplete="tel"
          placeholder="08xxxxxxxx"
          maxlength="10"
          :value="phone"
          :disabled="pending"
          @focus="scrollFieldIntoView(phoneInput)"
          @input="onPhoneInput"
          @keydown.enter.prevent="submitJoin"
        />
      </label>
      <p v-if="error" class="mk__err">{{ error }}</p>

      <button
        type="button"
        class="mk__primary mk__primary--join"
        :disabled="pending || !name.trim() || phone.length < 9"
        @click="submitJoin"
      >
        {{ pending ? "กำลังสมัคร..." : "สมัครเลย" }}
      </button>
    </section>

    <!-- สมัครสำเร็จ -->
    <section
      v-else-if="step === 'join-done' && member"
      class="mk__panel mk__success"
    >
      <div class="mk__success-badge" aria-hidden="true">
        <svg viewBox="0 0 48 48" fill="none">
          <circle cx="24" cy="24" r="22" fill="#e8f5e9" />
          <circle cx="24" cy="24" r="18" stroke="#2e7d32" stroke-width="2.5" />
          <path
            d="M14.5 24.5 21 31l12.5-14"
            stroke="#2e7d32"
            stroke-width="3.2"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </div>
      <p class="mk__success-kicker">สมัครสำเร็จแล้ว</p>
      <h2 class="mk__success-title">ยินดีต้อนรับ</h2>
      <p class="mk__success-name">คุณ{{ member.name }}</p>
      <p class="mk__success-code">รหัสสมาชิก {{ member.code }}</p>

      <p
        v-if="fromLine && member.points > 0"
        class="mk__line-bonus mk__line-bonus--got"
      >
        ได้รับ {{ formatPoints(member.points) }} แต้มของขวัญจากไลน์แล้ว
      </p>

      <div class="mk__success-card">
        <p class="mk__success-card-title">พร้อมสะสมแต้มแล้ว</p>
        <ul class="mk__success-list">
          <li v-if="fromLine && member.points > 0">
            สมัครผ่านไลน์ รับ {{ formatPoints(member.points) }} แต้ม
          </li>
          <li>ซื้อครบ 100 บาท ได้ 1 แต้ม</li>
          <li>1 แต้มใช้แทนเงินสด 1 บาท</li>
          <li>แต้มไม่มีวันหมดอายุ</li>
        </ul>
        <p class="mk__success-phone">บอกเบอร์ {{ phoneDisplay }}</p>
      </div>

      <button
        type="button"
        class="mk__primary mk__primary--success"
        @click="resetHome"
      >
        เสร็จสิ้น
      </button>
      <p class="mk__idle">จะกลับหน้าแรกอัตโนมัติ</p>
    </section>
  </div>
</template>

<style scoped>
.mk {
  --mk-ink: #1a1212;
  --mk-red: #c62828;
  --mk-red-deep: #8e1b1b;
  --mk-red-soft: #fde8e8;
  --mk-paper: #fffdfb;
  --mk-snow: #f6f1ef;
  --mk-line: #ead4d4;
  position: relative;
  box-sizing: border-box;
  min-height: 100dvh;
  max-width: 28rem;
  margin: 0 auto;
  padding: 1.25rem 1.1rem 1.75rem;
  color: var(--mk-ink);
  font-family: "IBM Plex Sans Thai", system-ui, sans-serif;
  background: var(--mk-snow);
  overflow-x: hidden;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}
.mk:has(.mk__home) {
  display: flex;
  flex-direction: column;
  height: 100svh;
  min-height: 100svh;
  max-height: 100svh;
  overflow: hidden;
  padding: max(0.7rem, env(safe-area-inset-top)) 1.05rem
    max(0.85rem, env(safe-area-inset-bottom));
}
.mk:has(.mk__home) .mk__bg {
  background:
    radial-gradient(95% 55% at 50% -12%, #ffc8c8 0%, transparent 58%),
    radial-gradient(70% 40% at 110% 108%, #ffd8b8 0%, transparent 52%),
    linear-gradient(180deg, #fff8f6 0%, #f6e9e6 100%);
}
.mk *,
.mk *::before,
.mk *::after {
  box-sizing: border-box;
}
.mk__bg {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background:
    radial-gradient(120% 70% at 50% -10%, #ffd5d5 0%, transparent 55%),
    linear-gradient(180deg, #fff 0%, var(--mk-snow) 45%, #f3e6e4 100%);
}
.mk__panel {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
  min-height: calc(100dvh - 2.5rem);
  animation: mk-in 0.35s ease both;
}
.mk__home {
  flex: 1 1 auto;
  min-height: 0;
  height: auto;
  gap: 0.75rem;
  justify-content: center;
}
@keyframes mk-in {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}
.mk__brand {
  text-align: center;
  padding: 1.25rem 0 0.5rem;
}
.mk__home .mk__brand {
  padding: 0.2rem 0 0;
}
.mk__home .mk__logo {
  width: 4.35rem;
  height: 4.35rem;
  padding: 0.18rem;
  border-radius: 50%;
  background: #fff;
  box-shadow:
    0 0 0 3px #fff,
    0 0 0 5px #efc2c2,
    0 12px 26px #c6282828;
}
.mk__home .mk__brand h1 {
  margin: 0.55rem 0 0.08rem;
  font-size: clamp(1.55rem, 6.2vw, 1.95rem);
}
.mk__home .mk__brand p {
  font-size: 0.92rem;
  letter-spacing: 0.04em;
}
.mk__home .mk__card {
  position: relative;
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 0.65rem;
  min-height: 0;
  margin-top: 0.15rem;
  padding: 1.05rem 0.75rem 1rem;
  overflow: hidden;
  border-radius: 1.35rem;
  background: linear-gradient(180deg, #ffffff 0%, #fffaf7 100%);
  border: 1px solid #f0d6d2;
  box-shadow:
    0 1px 0 #fff inset,
    0 16px 36px #c6282812;
}
.mk__home .mk__card::before {
  content: "";
  position: absolute;
  top: 0;
  right: 0;
  left: 0;
  height: 4px;
  background: linear-gradient(90deg, #c62828 0%, #e8a598 50%, #c62828 100%);
}
.mk__home .mk__line-bonus {
  margin: 0.15rem 0.15rem 0;
  padding: 0.48rem 0.75rem;
  border: 0;
  border-radius: 999px;
  background: linear-gradient(180deg, #fff6d8 0%, #fde7a8 100%);
  color: #7a4e00;
  font-size: 0.9rem;
  font-weight: 750;
  box-shadow: 0 1px 0 #fff6 inset;
}
.mk__logo {
  width: 5.5rem;
  height: 5.5rem;
  object-fit: contain;
  border-radius: 1.25rem;
  background: #fff;
  box-shadow: 0 10px 28px #c6282822;
}
.mk__brand h1 {
  margin: 0.85rem 0 0.2rem;
  /* ชื่อร้านไทย — ใช้ฟอนต์ไทย ไม่ใช้ Latin display */
  font-family: "IBM Plex Sans Thai", system-ui, sans-serif;
  font-size: clamp(2.1rem, 7.5vw, 2.65rem);
  font-weight: 800;
  letter-spacing: 0.01em;
  color: var(--mk-red-deep);
  line-height: 1.15;
}
.mk__shop {
  margin: 0;
  font-family: "IBM Plex Sans Thai", system-ui, sans-serif;
  font-size: 1.05rem;
  font-weight: 750;
  color: var(--mk-red);
  letter-spacing: 0.01em;
}
.mk__brand p {
  margin: 0;
  color: #7a5a5a;
  font-size: 1.05rem;
  font-weight: 500;
}
.mk__line-bonus {
  margin: 0;
  padding: 0.75rem 0.9rem;
  border-radius: 0.95rem;
  background: #ecfdf5;
  border: 1px solid #6ee7b7;
  color: #065f46;
  font-weight: 800;
  text-align: center;
  line-height: 1.35;
  font-size: 1.05rem;
}
.mk__line-bonus small {
  display: block;
  margin-top: 0.2rem;
  font-weight: 600;
  font-size: 0.82rem;
  color: #047857;
}
.mk__line-bonus--got {
  background: #d1fae5;
  border-color: #34d399;
}
.mk__perk-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 0.55rem;
}
.mk__home .mk__perk-list {
  grid-template-columns: 1fr 1fr 1fr;
  gap: 0;
}
.mk__perk-list li {
  display: grid;
  gap: 0.1rem;
  padding: 0.55rem 0.7rem;
  border-radius: 0.75rem;
  background: var(--mk-red-soft);
  font-size: 0.95rem;
  font-weight: 650;
  line-height: 1.3;
  color: var(--mk-ink);
}
.mk__home .mk__perk-list li {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.12rem;
  padding: 0.55rem 0.25rem;
  background: transparent;
  text-align: center;
}
.mk__home .mk__perk-list li + li::before {
  content: "";
  position: absolute;
  top: 18%;
  bottom: 18%;
  left: 0;
  width: 1px;
  background: #f0d4d0;
}
.mk__home .mk__perk-list strong {
  font-size: 1.02rem;
  font-weight: 800;
  color: var(--mk-red-deep);
  line-height: 1.2;
}
.mk__home .mk__perk-list span {
  font-size: 0.78rem;
  font-weight: 600;
  color: #8a6a6a;
  line-height: 1.3;
}
.mk__actions {
  display: grid;
  gap: 0.85rem;
  margin-top: auto;
  padding-bottom: 0.5rem;
}
.mk__home .mk__actions {
  grid-template-columns: 1fr;
  gap: 0.55rem;
  margin-top: 0.15rem;
  padding-bottom: 0;
}
.mk__tile {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.2rem;
  padding: 1.35rem 1.25rem;
  border: 1px solid var(--mk-line);
  border-radius: 1.15rem;
  background: #fff;
  text-align: left;
  touch-action: manipulation;
  transition:
    transform 0.15s ease,
    border-color 0.15s ease,
    box-shadow 0.15s ease;
}
.mk__home .mk__tile {
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  min-height: 3.7rem;
  padding: 0.75rem 1rem 0.75rem 1.1rem;
  border-radius: 1.1rem;
  text-align: left;
}
.mk__tile:active {
  transform: scale(0.985);
}
.mk__tile--check {
  border-color: #e5b0b0;
  box-shadow: 0 8px 24px #c6282814;
}
.mk__tile--join {
  background: linear-gradient(145deg, var(--mk-red) 0%, var(--mk-red-deep) 100%);
  border-color: transparent;
  color: #fff;
  box-shadow: 0 12px 28px #c6282840;
}
.mk__home .mk__tile--check {
  background: #fff;
  border-color: #f0c8c4;
  box-shadow: 0 8px 20px #c6282810;
}
.mk__home .mk__tile--join {
  background: linear-gradient(165deg, #d32f2f 0%, var(--mk-red-deep) 100%);
  box-shadow: 0 12px 26px #c6282845;
}
.mk__home .mk__tile--join .mk__tile-hint {
  color: #ffe8e8;
  opacity: 0.92;
}
.mk__tile-kicker {
  font-size: 0.88rem;
  font-weight: 600;
  opacity: 0.75;
}
.mk__tile strong {
  font-size: 1.65rem;
  font-weight: 750;
  line-height: 1.15;
}
.mk__home .mk__tile strong {
  font-size: 1.18rem;
}
.mk__home .mk__tile-hint {
  display: inline-flex;
  align-items: center;
  gap: 0.15rem;
  font-size: 0.82rem;
  font-weight: 650;
  opacity: 0.78;
}
.mk__home .mk__tile-hint::after {
  content: "›";
  font-size: 1.15rem;
  line-height: 1;
  opacity: 0.7;
}
.mk__tile-hint {
  font-size: 0.95rem;
  opacity: 0.8;
}
.mk__tile--check .mk__tile-kicker,
.mk__tile--check .mk__tile-hint {
  color: #8a5a5a;
}
.mk__tile--check strong {
  color: var(--mk-red-deep);
}
.mk__back {
  align-self: flex-start;
  border: 0;
  background: transparent;
  color: #8a5a5a;
  font-size: 1rem;
  font-weight: 650;
  padding: 0.35rem 0;
  touch-action: manipulation;
}
.mk__title {
  margin: 0;
  font-size: 1.75rem;
  font-weight: 750;
  color: var(--mk-red-deep);
}
.mk__lead {
  margin: -0.35rem 0 0;
  color: #7a5a5a;
  font-size: 1.05rem;
}
.mk__field {
  display: grid;
  gap: 0.35rem;
  margin: 0.15rem 0 0;
  width: 100%;
}
.mk__field > span {
  font-size: 0.92rem;
  font-weight: 650;
  color: #7a5a5a;
}
.mk__join .mk__field .mk__text,
.mk__join .mk__field .mk__phone {
  width: 100%;
  max-width: none;
  margin: 0;
}
.mk__join {
  /* ให้เลื่อนตามแป้นพิมพ์มือถือได้ */
  min-height: auto;
  padding-bottom: max(1.25rem, env(safe-area-inset-bottom));
}
.mk__join .mk__title {
  font-size: 1.45rem;
}
.mk__join .mk__lead {
  font-size: 0.95rem;
}
.mk__join .mk__primary,
.mk__join .mk__primary--join {
  width: 100%;
  max-width: none;
  margin-left: 0;
  margin-right: 0;
  margin-top: 0.75rem;
  position: sticky;
  bottom: 0.5rem;
  z-index: 2;
}
.mk__text--phone {
  letter-spacing: 0.06em;
  font-variant-numeric: tabular-nums;
  text-align: center;
}
.mk__text--phone.is-ready {
  border-color: var(--mk-red);
  background: var(--mk-red-soft);
  color: var(--mk-ink);
}
.mk__phone {
  margin: 0.35rem 0;
  padding: 0.95rem 1rem;
  text-align: center;
  font-size: 1.85rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  border-radius: 0.95rem;
  background: #fff;
  border: 2px solid var(--mk-line);
  color: #b0a0a0;
  min-height: 3.6rem;
}
.mk__phone.is-ready {
  color: var(--mk-ink);
  border-color: var(--mk-red);
  background: var(--mk-red-soft);
}
.mk__text {
  width: 100%;
  min-height: 3.6rem;
  padding: 0.85rem 1rem;
  border: 2px solid var(--mk-line);
  border-radius: 0.95rem;
  font-size: 1.45rem;
  font-weight: 650;
  font-family: inherit;
  background: #fff;
  color: var(--mk-ink);
}
.mk__text:focus {
  outline: none;
  border-color: var(--mk-red);
  background: var(--mk-red-soft);
}
.mk__pad {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0.5rem;
  margin-top: 0.15rem;
}
.mk__key {
  height: 3.5rem;
  border: 1px solid var(--mk-line);
  border-radius: 0.85rem;
  background: #fff;
  font-size: 1.45rem;
  font-weight: 700;
  color: var(--mk-ink);
  touch-action: manipulation;
}
.mk__key:active:not(:disabled) {
  background: var(--mk-red-soft);
}
.mk__key.is-ghost {
  visibility: hidden;
}
.mk__key:disabled {
  opacity: 0.45;
}
.mk__primary {
  margin-top: auto;
  min-height: 3.4rem;
  border: 0;
  border-radius: 0.95rem;
  background: linear-gradient(145deg, var(--mk-red) 0%, var(--mk-red-deep) 100%);
  color: #fff;
  font-size: 1.2rem;
  font-weight: 750;
  font-family: inherit;
  touch-action: manipulation;
  box-shadow: 0 10px 22px #c6282833;
}
.mk__primary:disabled {
  opacity: 0.45;
  box-shadow: none;
}
.mk__ghost {
  min-height: 3rem;
  border: 1px solid var(--mk-line);
  border-radius: 0.85rem;
  background: #fff;
  color: #5a4040;
  font-size: 1.05rem;
  font-weight: 650;
  font-family: inherit;
  touch-action: manipulation;
}
.mk__err {
  margin: 0;
  text-align: center;
  color: #9b1c1c;
  font-weight: 650;
}
.mk__note {
  margin: 0;
  text-align: center;
  color: #8a6a00;
  font-weight: 650;
  background: #fff4d6;
  border-radius: 0.75rem;
  padding: 0.55rem 0.75rem;
}
.mk__result {
  align-items: center;
  text-align: center;
  justify-content: center;
  gap: 0.55rem;
}
.mk__success {
  align-items: center;
  text-align: center;
  justify-content: flex-start;
  gap: 0.4rem;
  padding-top: 0.75rem;
}
.mk__success-badge {
  width: 4.75rem;
  height: 4.75rem;
  margin: 0.25rem 0 0.35rem;
  animation: mk-pop 0.5s cubic-bezier(0.2, 0.9, 0.2, 1.15) both;
}
.mk__success-badge svg {
  width: 100%;
  height: 100%;
  display: block;
}
.mk__success-kicker {
  margin: 0;
  color: #2e7d32;
  font-size: 1.05rem;
  font-weight: 750;
  letter-spacing: 0.02em;
}
.mk__success-title {
  margin: 0;
  font-size: clamp(1.85rem, 7vw, 2.35rem);
  font-weight: 800;
  color: var(--mk-ink);
  line-height: 1.15;
}
.mk__success-name {
  margin: 0.15rem 0 0;
  font-size: 1.35rem;
  font-weight: 700;
  color: var(--mk-red-deep);
}
.mk__success-code {
  margin: 0.15rem 0 0;
  color: #8a5a5a;
  font-size: 0.98rem;
}
.mk__success-card {
  width: 100%;
  margin: 0.85rem 0 0.5rem;
  padding: 1rem 1.05rem 1.05rem;
  text-align: left;
  border-radius: 1.05rem;
  background: #fff;
  border: 1px solid #c8e6c9;
  box-shadow: 0 10px 24px #2e7d3214;
}
.mk__success-card-title {
  margin: 0 0 0.55rem;
  font-size: 1.08rem;
  font-weight: 750;
  color: #1b5e20;
}
.mk__success-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 0.4rem;
}
.mk__success-list li {
  position: relative;
  padding: 0.35rem 0.55rem 0.35rem 1.55rem;
  border-radius: 0.55rem;
  background: #f1f8f2;
  font-size: 0.95rem;
  font-weight: 600;
  color: #2a3a2a;
  line-height: 1.35;
}
.mk__success-list li::before {
  content: "✓";
  position: absolute;
  left: 0.5rem;
  top: 0.35rem;
  color: #2e7d32;
  font-weight: 800;
}
.mk__success-phone {
  margin: 0.75rem 0 0;
  padding-top: 0.7rem;
  border-top: 1px dashed #c8e6c9;
  font-size: 0.95rem;
  color: #5a6a5a;
  line-height: 1.4;
}
.mk__success-phone strong {
  color: var(--mk-ink);
  font-weight: 750;
  letter-spacing: 0.02em;
}
.mk__primary--success {
  background: linear-gradient(145deg, #43a047 0%, #2e7d32 100%);
  box-shadow: 0 10px 22px #2e7d3233;
}
.mk__hello {
  margin: 0;
  color: #8a5a5a;
  font-size: 1.1rem;
  font-weight: 600;
}
.mk__name {
  margin: 0;
  font-size: clamp(1.8rem, 7vw, 2.35rem);
  font-weight: 750;
  color: var(--mk-ink);
  line-height: 1.15;
}
.mk__code {
  margin: 0;
  color: #8a5a5a;
  font-size: 1rem;
}
.mk__points {
  width: 100%;
  margin: 0.75rem 0 0.35rem;
  padding: 1.35rem 1rem;
  border-radius: 1.2rem;
  background: linear-gradient(160deg, var(--mk-red) 0%, var(--mk-red-deep) 100%);
  color: #fff;
  box-shadow: 0 14px 32px #c6282838;
  animation: mk-pop 0.45s cubic-bezier(0.2, 0.9, 0.2, 1.2) both;
}
.mk__points--soft {
  background: linear-gradient(160deg, #fff 0%, var(--mk-red-soft) 100%);
  color: var(--mk-red-deep);
  border: 1px solid #e5b0b0;
  box-shadow: none;
}
.mk__points span {
  display: block;
  font-size: 1rem;
  font-weight: 600;
  opacity: 0.9;
}
.mk__points strong {
  display: block;
  margin-top: 0.2rem;
  font-size: clamp(3rem, 14vw, 4rem);
  font-weight: 800;
  line-height: 1;
  letter-spacing: -0.02em;
}
@keyframes mk-pop {
  from {
    opacity: 0;
    transform: scale(0.92);
  }
  to {
    opacity: 1;
    transform: none;
  }
}
.mk__result-actions {
  width: 100%;
  display: grid;
  gap: 0.55rem;
  margin-top: 0.75rem;
}
.mk__tip {
  margin: 0;
  color: #7a5a5a;
  font-size: 1rem;
}
.mk__idle {
  margin: 0.25rem 0 0;
  color: #b0a0a0;
  font-size: 0.88rem;
}

@media (min-width: 720px) {
  .mk {
    max-width: 42rem;
    padding: 1.75rem 1.75rem 2rem;
  }
  .mk__home .mk__actions {
    grid-template-columns: 1fr;
    margin-top: 0;
  }
  .mk__home .mk__tile {
    min-height: 3.9rem;
  }
  .mk__panel:not(.mk__home) .mk__tile {
    min-height: 11rem;
    justify-content: center;
  }
  /* เช็คแต้ม / ผลลัพธ์ — จัดกลางคอลัมน์เดียว */
  .mk__panel:not(.mk__join):not(.mk__home):not(.mk__success) .mk__pad,
  .mk__panel:not(.mk__join):not(.mk__home):not(.mk__success) .mk__primary,
  .mk__panel:not(.mk__join):not(.mk__home):not(.mk__success) .mk__ghost,
  .mk__panel:not(.mk__join):not(.mk__home):not(.mk__success) .mk__phone,
  .mk__panel:not(.mk__join):not(.mk__home):not(.mk__success) .mk__text,
  .mk__panel:not(.mk__join):not(.mk__home):not(.mk__success) .mk__result-actions {
    max-width: 22rem;
    margin-left: auto;
    margin-right: auto;
    width: 100%;
  }
  .mk__success {
    max-width: 22rem;
    margin-left: auto;
    margin-right: auto;
    width: 100%;
  }
  /* สมัคร — ชื่อ/เบอร์/แป้น กว้างเท่ากันทั้งแถว */
  .mk__join {
    max-width: 22rem;
    margin-left: auto;
    margin-right: auto;
    width: 100%;
  }
}
</style>
