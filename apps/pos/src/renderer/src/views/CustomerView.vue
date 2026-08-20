<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { storeToRefs } from "pinia";
import { earnPoints, type CartSnapshot } from "@ap-pos/shared";
import { useSettingsStore } from "../stores/settings";
import {
  ensureSettingsMediaCached,
  fetchSettingsFromApi,
  loadCachedSettings,
  loadMediaIndex,
  mediaCacheEpoch,
  resolveAdMediaUrl,
  resolveImage,
} from "../services/sync";
import { formatInt, formatMoney } from "../utils/format";
import fallbackLogo from "../assets/store-logo.png";

const settings = useSettingsStore();
const {
  storeName,
  storeTagline,
  logoUrl,
  customerBannerUrl,
  customerMidBannerUrl,
  customerPanelUrl,
  customerAds,
  activeCustomerAds,
} = storeToRefs(settings);
const brandLogoSrc = computed(() => {
  void mediaCacheEpoch.value;
  return resolveImage(logoUrl.value, fallbackLogo);
});
const bannerSrc = computed(() => {
  void mediaCacheEpoch.value;
  return customerBannerUrl.value
    ? resolveImage(customerBannerUrl.value, "")
    : "";
});
const midBannerSrc = computed(() => {
  void mediaCacheEpoch.value;
  return customerMidBannerUrl.value
    ? resolveImage(customerMidBannerUrl.value, "")
    : "";
});
const panelSrc = computed(() => {
  void mediaCacheEpoch.value;
  return customerPanelUrl.value
    ? resolveImage(customerPanelUrl.value, "")
    : "";
});
const hasBanner = computed(() => Boolean(bannerSrc.value));
const hasMidBanner = computed(() => Boolean(midBannerSrc.value));
const hasPanel = computed(() => Boolean(panelSrc.value));

const emptyCart: CartSnapshot = {
  lines: [],
  itemCount: 0,
  subtotal: 0,
  discount: 0,
  total: 0,
  change: 0,
  memberName: "ลูกค้าทั่วไป",
  pointsUsable: 0,
  pointsToEarn: 0,
  pointsDiscount: 0,
  promptPayPayload: null,
  promptPayQrDataUrl: null,
  promptPayAmount: null,
  promptPayName: null,
  promptPayId: null,
};

const cart = ref<CartSnapshot>({ ...emptyCart });
const listEl = ref<HTMLElement | null>(null);
const videoEl = ref<HTMLVideoElement | null>(null);

const hasItems = computed(() => cart.value.lines.length > 0);
const isPaying = computed(() => Boolean(cart.value.paying));
const isPostPaid = computed(() => Boolean(cart.value.postPaid));
const showChange = computed(
  () => !isPaying.value && cart.value.change > 0,
);
const showThanks = computed(
  () => isPostPaid.value && !showChange.value && !isPaying.value,
);

/** ถ้าวิดีโอพังต่อเนื่อง → ถอยไปใช้รูปด้านล่าง (แล้วลองใหม่) */
const adsUnavailable = ref(false);
const playlistKey = computed(() =>
  activeCustomerAds.value.map((a) => `${a.id}|${a.url}|${a.type}`).join(";"),
);
/** โฆษณา / รูปล่าง นิยามหลัง showPromptPayQr */
const memberLabel = computed(
  () => cart.value.memberName?.trim() || "ลูกค้าทั่วไป",
);
const isNamedMember = computed(() => {
  const n = cart.value.memberName?.trim() || "";
  return Boolean(n) && n !== "ลูกค้าทั่วไป";
});

/** แต้มบิลนี้ — คำนวณจากยอดบนจอ 2 ให้ตรงกับที่ลูกค้าเห็น */
const displayPointsToEarn = computed(() => {
  if (!isNamedMember.value) return 0;
  if (cart.value.postPaid) {
    return Math.max(0, Math.floor(Number(cart.value.pointsToEarn) || 0));
  }
  const earnBase =
    Number(cart.value.total) + Math.max(0, Number(cart.value.pointsDiscount) || 0);
  return earnPoints(earnBase, settings.pointsConfig);
});

const displayPointsUsable = computed(() =>
  Math.max(0, Math.floor(Number(cart.value.pointsUsable) || 0)),
);

/** ส่วนลดที่ใช้ได้ (บาท) = แต้มคงเหลือ × อัตราแลก */
const displayUsableDiscount = computed(() => {
  const rate = Number(settings.pointsConfig.bahtPerRedeemPoint) || 1;
  return Math.max(0, displayPointsUsable.value * rate);
});

const paymentLines = computed(() => cart.value.paymentLines ?? []);
const paidAmount = computed(() => Number(cart.value.paid) || 0);
const remainingAmount = computed(() => Number(cart.value.remaining) || 0);
const promptPayAmount = computed(() => Number(cart.value.promptPayAmount) || 0);
const promptPayAccountName = computed(
  () => String(cart.value.promptPayName || "").trim() || "",
);
const promptPayIdMasked = computed(() => {
  const d = String(cart.value.promptPayId || "").replace(/\D/g, "");
  if (d.length < 4) return "";
  if (d.length === 13) {
    return `${d.slice(0, 1)}-xxxx-xxxxx-${d.slice(-4, -1)}${d.slice(-1)}`;
  }
  const tail = d.slice(-4);
  const head = d.slice(0, Math.min(3, d.length - 4));
  return `${head}${"x".repeat(Math.max(0, d.length - head.length - 4))}${tail}`;
});
const promptPayPayload = computed(
  () => String(cart.value.promptPayPayload || "").trim() || "",
);
const qrFromCart = computed(
  () => String(cart.value.promptPayQrDataUrl || "").trim() || "",
);
const qrLocal = ref("");
const qrDataUrl = computed(() => qrFromCart.value || qrLocal.value);
const showPromptPayQr = computed(
  () =>
    isPaying.value &&
    Boolean(qrDataUrl.value) &&
    promptPayAmount.value > 0,
);

/** โฆษณา — ซ่อนเฉพาะตอนโอน PromptPay (QR) หรือสื่อพัง */
const showAds = computed(
  () =>
    !showPromptPayQr.value &&
    activeCustomerAds.value.length > 0 &&
    !adsUnavailable.value,
);
/** รูปด้านล่าง — ซ่อนตอนชำระเงิน / เงินทอน / ขอบคุณ */
const showPanelMedia = computed(
  () =>
    !isPaying.value &&
    hasPanel.value &&
    !showChange.value &&
    !showThanks.value,
);

watch(
  promptPayPayload,
  async (payload) => {
    if (!payload || qrFromCart.value) {
      if (!payload) qrLocal.value = "";
      return;
    }
    try {
      const { toDataURL } = await import("qrcode");
      qrLocal.value = await toDataURL(payload, {
        errorCorrectionLevel: "M",
        margin: 2,
        width: 400,
        color: { dark: "#000000", light: "#ffffff" },
      });
    } catch (err) {
      console.error("[promptpay] customer QR failed", err);
      qrLocal.value = "";
    }
  },
  { immediate: true },
);
const payChangeAmount = computed(() =>
  isPaying.value ? Number(cart.value.change) || 0 : 0,
);

const mediaType = ref<"image" | "video" | null>(null);
const mediaSrc = ref("");
const mediaIndex = ref(0);
const mediaLoop = ref(false);
const dots = computed(() => activeCustomerAds.value.length);

let rotateTimer: ReturnType<typeof setTimeout> | null = null;
let errorTimer: ReturnType<typeof setTimeout> | null = null;
let retryAdsTimer: ReturnType<typeof setTimeout> | null = null;
let settingsPollTimer: number | null = null;
let stopped = false;
let errorStreak = 0;
let playGen = 0;

function clearRotateTimer() {
  if (rotateTimer != null) {
    clearTimeout(rotateTimer);
    rotateTimer = null;
  }
}

function clearErrorTimer() {
  if (errorTimer != null) {
    clearTimeout(errorTimer);
    errorTimer = null;
  }
}

function clearRetryAdsTimer() {
  if (retryAdsTimer != null) {
    clearTimeout(retryAdsTimer);
    retryAdsTimer = null;
  }
}

function hardUnloadVideo() {
  const v = videoEl.value;
  if (!v) return;
  try {
    v.pause();
    v.removeAttribute("src");
    v.load();
  } catch {
    /* ignore */
  }
}

function unloadMedia() {
  clearRotateTimer();
  hardUnloadVideo();
  mediaSrc.value = "";
  mediaType.value = null;
  mediaLoop.value = false;
}

async function waitForVideoEl(gen: number) {
  for (let i = 0; i < 12; i++) {
    if (stopped || gen !== playGen) return null;
    if (videoEl.value) return videoEl.value;
    await nextTick();
    await new Promise((r) => setTimeout(r, 40));
  }
  return videoEl.value;
}

async function playCurrentVideo(gen = playGen) {
  const v = await waitForVideoEl(gen);
  if (!v || stopped || gen !== playGen) return;
  if (!mediaSrc.value || mediaType.value !== "video") return;
  v.muted = true;
  v.defaultMuted = true;
  v.playsInline = true;
  v.loop = mediaLoop.value;
  try {
    await v.play();
    if (gen === playGen) errorStreak = 0;
  } catch (err) {
    const name = err instanceof DOMException ? err.name : "";
    // ถูก pause/unload ระหว่าง play — ไม่นับเป็นสื่อพัง
    if (name === "AbortError" || stopped || gen !== playGen) return;
    scheduleMediaError();
  }
}

async function showAdAt(index: number) {
  if (stopped || adsUnavailable.value || showPromptPayQr.value) return;
  if (!activeCustomerAds.value.length) {
    unloadMedia();
    return;
  }
  clearRotateTimer();
  clearErrorTimer();
  const list = activeCustomerAds.value;
  const i = ((index % list.length) + list.length) % list.length;
  const item = list[i]!;
  void mediaCacheEpoch.value;
  const nextSrc = resolveAdMediaUrl(item.url, item.type);
  if (!nextSrc) {
    scheduleMediaError();
    return;
  }
  const gen = ++playGen;

  // วิดีโอเดิมที่เล่นอยู่แล้ว — ไม่ remount (กัน OOM)
  if (
    item.type === "video" &&
    mediaType.value === "video" &&
    mediaSrc.value === nextSrc
  ) {
    mediaIndex.value = i;
    mediaLoop.value = list.length === 1;
    await playCurrentVideo(gen);
    return;
  }

  if (mediaType.value === "video") hardUnloadVideo();
  mediaSrc.value = "";
  mediaType.value = null;
  await nextTick();
  if (stopped || gen !== playGen) return;

  mediaIndex.value = i;
  mediaType.value = item.type;
  mediaSrc.value = nextSrc;
  mediaLoop.value = item.type === "video" && list.length === 1;
  await nextTick();
  if (stopped || gen !== playGen) return;

  if (item.type === "image") {
    const sec = item.durationSec || customerAds.value.imageDurationSec || 8;
    rotateTimer = setTimeout(() => {
      void advanceAd();
    }, Math.max(3, sec) * 1000);
    return;
  }

  await playCurrentVideo(gen);
}

async function advanceAd() {
  if (stopped || adsUnavailable.value || showPromptPayQr.value) return;
  const list = activeCustomerAds.value;
  if (!list.length) return;
  if (list.length === 1) {
    const only = list[0]!;
    if (only.type === "video") {
      // loop attribute จัดการเอง — อย่า remount
      const v = videoEl.value;
      if (v) {
        try {
          v.currentTime = 0;
          await v.play();
        } catch (err) {
          const name = err instanceof DOMException ? err.name : "";
          if (name === "AbortError") return;
          scheduleMediaError();
        }
      }
      return;
    }
    await showAdAt(0);
    return;
  }
  await showAdAt(mediaIndex.value + 1);
}

function scheduleMediaError() {
  errorStreak += 1;
  if (errorStreak >= 5) {
    adsUnavailable.value = true;
    unloadMedia();
    clearRetryAdsTimer();
    // ลองใหม่หลังพัก — อย่าปิดโฆษณาถาวร
    retryAdsTimer = setTimeout(() => {
      adsUnavailable.value = false;
      errorStreak = 0;
      if (playlistKey.value && !showPromptPayQr.value) void showAdAt(0);
    }, 8000);
    return;
  }
  clearErrorTimer();
  errorTimer = setTimeout(() => {
    void advanceAd();
  }, 800);
}

function onVideoEnded() {
  if (mediaLoop.value) return;
  void advanceAd();
}

function onVideoError() {
  scheduleMediaError();
}

function onImageError() {
  scheduleMediaError();
}

function applySnapshot(snapshot: CartSnapshot | null | undefined) {
  if (!snapshot || typeof snapshot !== "object") return;
  const memberPts = Math.max(
    0,
    Math.floor(Number(snapshot.memberPoints) || 0),
  );
  const usableRaw = snapshot.pointsUsable;
  const earnRaw = snapshot.pointsToEarn;
  const pointsUsable =
    usableRaw != null && Number.isFinite(Number(usableRaw))
      ? Math.max(0, Math.floor(Number(usableRaw)))
      : memberPts;
  const pointsToEarn =
    earnRaw != null && Number.isFinite(Number(earnRaw))
      ? Math.max(0, Math.floor(Number(earnRaw)))
      : 0;
  cart.value = {
    lines: Array.isArray(snapshot.lines)
      ? snapshot.lines.map((l) => ({ ...l }))
      : [],
    itemCount: Number(snapshot.itemCount) || 0,
    subtotal: Number(snapshot.subtotal) || 0,
    discount: Number(snapshot.discount) || 0,
    total: Number(snapshot.total) || 0,
    change: Number(snapshot.change) || 0,
    memberName: snapshot.memberName ?? "ลูกค้าทั่วไป",
    memberPoints: memberPts,
    pointsUsable,
    pointsToEarn,
    pointsDiscount: Math.max(0, Number(snapshot.pointsDiscount) || 0),
    paying: Boolean(snapshot.paying),
    paid: Number(snapshot.paid) || 0,
    remaining: Number(snapshot.remaining) || 0,
    paymentLines: Array.isArray(snapshot.paymentLines)
      ? snapshot.paymentLines.map((l) => ({ ...l }))
      : [],
    postPaid: Boolean(snapshot.postPaid),
    promptPayPayload: snapshot.promptPayPayload
      ? String(snapshot.promptPayPayload)
      : null,
    promptPayQrDataUrl: snapshot.promptPayQrDataUrl
      ? String(snapshot.promptPayQrDataUrl)
      : null,
    promptPayAmount:
      snapshot.promptPayAmount != null &&
      Number.isFinite(Number(snapshot.promptPayAmount))
        ? Number(snapshot.promptPayAmount)
        : null,
    promptPayName: snapshot.promptPayName
      ? String(snapshot.promptPayName).trim()
      : null,
    promptPayId: snapshot.promptPayId
      ? String(snapshot.promptPayId).replace(/\D/g, "")
      : null,
  };
}

watch(
  () => cart.value.lines.length,
  async () => {
    await nextTick();
    if (listEl.value) {
      listEl.value.scrollTop = listEl.value.scrollHeight;
    }
  },
);

watch(playlistKey, (key) => {
  adsUnavailable.value = false;
  errorStreak = 0;
  clearRetryAdsTimer();
  if (!key || showPromptPayQr.value) {
    unloadMedia();
    return;
  }
  void showAdAt(0);
});

watch(showPromptPayQr, (on) => {
  if (on) {
    unloadMedia();
    return;
  }
  if (playlistKey.value && !adsUnavailable.value) {
    void showAdAt(mediaIndex.value || 0);
  }
});

/** เมื่อ DOM ของโฆษณาพร้อม (เช่น หลังปิด QR โอน) ให้เล่นต่อ */
watch(showAds, (on) => {
  if (!on) return;
  if (!mediaSrc.value && playlistKey.value && !adsUnavailable.value) {
    void showAdAt(mediaIndex.value || 0);
  } else if (mediaType.value === "video" && mediaSrc.value) {
    void playCurrentVideo();
  }
});

let unsubscribe: (() => void) | undefined;
let unsubSettings: (() => void) | undefined;

function applySettingsPayload(payload: unknown) {
  if (!payload || typeof payload !== "object") return;
  const p = payload as {
    display?: {
      customerScreenEnabled?: boolean;
      bannerUrl?: string | null;
      midBannerUrl?: string | null;
      panelUrl?: string | null;
    };
    branding?: {
      storeName?: string;
      storeTagline?: string;
      logoUrl?: string | null;
    };
    customerAds?: unknown;
    points?: {
      bahtPerPoint?: number;
      bahtPerRedeemPoint?: number;
    };
  };
  settings.applyFromBackend({
    display: p.display,
    branding: p.branding,
    customerAds: p.customerAds as never,
    points: p.points,
  });
}

async function hydrateSettings() {
  await loadMediaIndex();
  const [ipcSettings, cached, remote] = await Promise.all([
    window.apPos?.getSettings?.() ?? Promise.resolve(null),
    loadCachedSettings(),
    fetchSettingsFromApi(),
  ]);
  // ลำดับ: IPC → cache → API (ทับด้วยแหล่งล่าสุดที่มีสื่อ)
  if (ipcSettings) applySettingsPayload(ipcSettings);
  if (cached?.branding || cached?.customerAds || cached?.display || cached?.points) {
    settings.applyFromBackend({
      branding: cached.branding,
      customerAds: cached.customerAds,
      display: cached.display,
      points: cached.points,
    });
  }
  if (remote?.branding || remote?.customerAds || remote?.display || remote?.points) {
    settings.applyFromBackend({
      branding: remote.branding,
      customerAds: remote.customerAds,
      display: remote.display,
      points: remote.points,
    });
  }
  const mediaSource = remote ?? cached;
  await ensureSettingsMediaCached(mediaSource);
  if (playlistKey.value && !showPromptPayQr.value) void showAdAt(0);
}

onMounted(() => {
  stopped = false;
  unsubscribe = window.apPos?.onCartUpdate((snapshot) => {
    applySnapshot(snapshot);
  });
  unsubSettings = window.apPos?.onSettingsUpdate?.((snapshot) => {
    applySettingsPayload(snapshot);
    const p =
      snapshot && typeof snapshot === "object"
        ? (snapshot as {
            branding?: {
              logoUrl?: string | null;
            };
            display?: {
              bannerUrl?: string | null;
              panelUrl?: string | null;
            };
            customerAds?: {
              items?: Array<{ url?: string }>;
            };
          })
        : null;
    // แคชเฉพาะเมื่อ URL สื่อจอ 2 เปลี่ยน / ยังไม่มีในเครื่อง
    void ensureSettingsMediaCached({
      branding: p?.branding,
      display: p?.display,
      customerAds: p?.customerAds as never,
    }).then(() => {
      if (playlistKey.value && !showPromptPayQr.value) {
        void showAdAt(mediaIndex.value || 0);
      }
    });
  });
  void window.apPos?.getCart?.().then((snapshot) => applySnapshot(snapshot));
  void hydrateSettings();
  // สำรอง: อัปเดต settings ข้อความทุก 30 วิ — ไม่ดึงไฟล์สื่อซ้ำ
  settingsPollTimer = window.setInterval(() => {
    void (async () => {
      const cached = await loadCachedSettings();
      const remote = await fetchSettingsFromApi();
      const src = remote ?? cached;
      if (!src?.customerAds && !src?.display && !src?.branding) return;
      settings.applyFromBackend({
        branding: src.branding,
        customerAds: src.customerAds,
        display: src.display,
      });
      await ensureSettingsMediaCached(src);
    })();
  }, 30_000);
});

onUnmounted(() => {
  stopped = true;
  playGen += 1;
  clearErrorTimer();
  clearRetryAdsTimer();
  if (settingsPollTimer != null) {
    window.clearInterval(settingsPollTimer);
    settingsPollTimer = null;
  }
  unloadMedia();
  unsubscribe?.();
  unsubSettings?.();
});
</script>

<template>
  <div
    class="cust"
    :class="{
      'has-items': hasItems,
      'has-change': showChange,
      'has-thanks': showThanks,
      'has-ads': showAds,
      'has-panel': showPanelMedia,
      'has-banner': hasBanner && !showPromptPayQr,
      'has-mid-banner': hasMidBanner,
      'is-paying': isPaying,
      'has-pp-qr': showPromptPayQr,
      'is-post-paid': isPostPaid,
    }"
  >
    <aside class="cust-brand">
      <!-- โอน PromptPay: เอาแบนเนอร์บนออก เหลือพื้นที่ให้ QR -->
      <template v-if="!showPromptPayQr">
        <div v-if="hasBanner" class="cust-top-banner">
          <img
            class="cust-top-banner__img"
            :key="bannerSrc"
            :src="bannerSrc"
            alt=""
          />
        </div>
        <div v-else class="cust-brand__top">
          <img
            class="cust-brand__logo"
            :src="brandLogoSrc"
            alt=""
            width="96"
            height="96"
          />
          <div>
            <p class="cust-brand__name">{{ storeName }}</p>
            <p class="cust-brand__tag">
              {{ storeTagline || "ยินดีต้อนรับ" }}
            </p>
          </div>
        </div>
      </template>

      <div class="cust-brand__body">
        <!-- โอน PromptPay: QR แทนโฆษณา -->
        <template v-if="showPromptPayQr">
          <div
            class="cust-ads cust-pay-qr"
            aria-label="PromptPay QR"
          >
            <div class="cust-pay-qr__card">
              <header class="cust-pay-qr__head">
                <span class="cust-pay-qr__badge" aria-hidden="true">PP</span>
                <div class="cust-pay-qr__head-text">
                  <strong>PromptPay</strong>
                  <span>สแกนเพื่อชำระเงิน</span>
                </div>
              </header>

              <div class="cust-pay-qr__meta cust-pay-qr__meta--top">
                <span class="cust-pay-qr__amount-label">ยอดที่ต้องโอน</span>
                <strong class="cust-pay-qr__amount">
                  {{ formatMoney(promptPayAmount) }}
                  <small>บาท</small>
                </strong>
                <div class="cust-pay-qr__account">
                  <span>ชื่อบัญชี</span>
                  <em>{{ promptPayAccountName || "—" }}</em>
                </div>
                <p v-if="promptPayIdMasked" class="cust-pay-qr__id">
                  PromptPay {{ promptPayIdMasked }}
                </p>
              </div>

              <div class="cust-pay-qr__frame">
                <img
                  class="cust-pay-qr__img"
                  :src="qrDataUrl"
                  alt="PromptPay QR"
                  width="360"
                  height="360"
                />
              </div>

              <p class="cust-pay-qr__hint">
                กรุณาตรวจสอบชื่อบัญชีให้ตรงก่อนยืนยันการโอน
              </p>
            </div>
          </div>

          <div class="cust-pay cust-pay--with-qr">
            <p class="cust-pay__title">กำลังชำระเงิน</p>
            <div class="cust-pay__row">
              <span>ชำระแล้ว</span>
              <strong>{{ formatMoney(paidAmount) }}</strong>
            </div>
            <ul v-if="paymentLines.length" class="cust-pay__methods">
              <li v-for="(p, i) in paymentLines" :key="`${p.method}-${i}`">
                <span>{{ p.label }}</span>
                <em>{{ formatMoney(p.amount) }}</em>
              </li>
            </ul>
            <div
              class="cust-pay__row cust-pay__remain"
              :class="{ 'is-done': remainingAmount <= 0 }"
            >
              <span>{{ remainingAmount <= 0 ? "ครบยอดแล้ว" : "เหลือ" }}</span>
              <strong>{{ formatMoney(remainingAmount) }}</strong>
            </div>
            <div v-if="payChangeAmount > 0" class="cust-pay__change">
              <span>เงินทอน</span>
              <strong>{{ formatMoney(payChangeAmount) }}</strong>
            </div>
          </div>
        </template>

        <!-- ปกติ / ชำระเงินสดฯ — โฆษณายังเล่นได้ -->
        <template v-else>
          <div v-if="showAds" class="cust-ads" aria-hidden="true">
            <img
              v-show="mediaType === 'image' && mediaSrc"
              class="cust-ads__media"
              :src="mediaSrc || undefined"
              alt=""
              decoding="async"
              @error="onImageError"
            />
            <video
              v-show="mediaType === 'video' && mediaSrc"
              ref="videoEl"
              class="cust-ads__media"
              :src="mediaSrc || undefined"
              :loop="mediaLoop"
              muted
              playsinline
              preload="auto"
              @ended="onVideoEnded"
              @error="onVideoError"
              @loadeddata="() => playCurrentVideo()"
            ></video>
            <div v-if="dots > 1" class="cust-ads__dots">
              <span
                v-for="(_, i) in dots"
                :key="i"
                class="cust-ads__dot"
                :class="{ 'is-on': i === mediaIndex }"
              ></span>
            </div>
          </div>

          <div
            v-else-if="!hasMidBanner && !showPanelMedia && !showChange && !showThanks && !isPaying"
            class="cust-welcome"
          >
            <p v-if="hasItems">กำลังคิดเงิน</p>
            <p v-else>ยินดีต้อนรับ</p>
            <span>{{ hasItems ? "โปรดตรวจสอบรายการด้านขวา" : "รอสแกนสินค้า" }}</span>
          </div>

          <div v-if="hasMidBanner" class="cust-mid-banner" aria-hidden="true">
            <img
              class="cust-mid-banner__img"
              :key="midBannerSrc"
              :src="midBannerSrc"
              alt=""
              decoding="async"
            />
          </div>

          <div v-if="showChange" class="cust-change cust-change--panel">
            <span>เงินทอน</span>
            <strong>{{ formatMoney(cart.change) }}</strong>
            <em>บ.</em>
          </div>
          <div
            v-else-if="showThanks"
            class="cust-change cust-change--panel cust-change--thanks"
          >
            <span>ชำระเรียบร้อย</span>
            <strong>ขอบคุณครับ</strong>
          </div>
          <div v-else-if="showPanelMedia" class="cust-panel" aria-hidden="true">
            <img
              class="cust-panel__img"
              :key="panelSrc"
              :src="panelSrc"
              alt=""
              decoding="async"
            />
          </div>

          <div v-if="isPaying" class="cust-pay">
            <p class="cust-pay__title">กำลังชำระเงิน</p>
            <div class="cust-pay__row">
              <span>ชำระแล้ว</span>
              <strong>{{ formatMoney(paidAmount) }}</strong>
            </div>
            <ul v-if="paymentLines.length" class="cust-pay__methods">
              <li v-for="(p, i) in paymentLines" :key="`${p.method}-${i}`">
                <span>{{ p.label }}</span>
                <em>{{ formatMoney(p.amount) }}</em>
              </li>
            </ul>
            <div
              class="cust-pay__row cust-pay__remain"
              :class="{ 'is-done': remainingAmount <= 0 }"
            >
              <span>{{ remainingAmount <= 0 ? "ครบยอดแล้ว" : "เหลือ" }}</span>
              <strong>{{ formatMoney(remainingAmount) }}</strong>
            </div>
            <div v-if="payChangeAmount > 0" class="cust-pay__change">
              <span>เงินทอน</span>
              <strong>{{ formatMoney(payChangeAmount) }}</strong>
            </div>
          </div>
        </template>
      </div>
    </aside>

    <section class="cust-ticket">
      <header class="cust-ticket__head">
        <div>
          <span>{{ isPostPaid ? "บิลล่าสุด" : "รายการสินค้า" }}</span>
          <strong>{{ cart.itemCount }} ชิ้น</strong>
        </div>
        <div class="cust-member" :class="{ 'is-member': isNamedMember }">
          <span class="cust-member__label">สมาชิก</span>
          <strong class="cust-member__name">{{ memberLabel }}</strong>
          <template v-if="isNamedMember">
            <div class="cust-member__usable">
              <em>{{ isPostPaid ? "แต้มคงเหลือ" : "ส่วนลดที่ใช้ได้" }}</em>
              <strong>{{
                isPostPaid
                  ? formatInt(displayPointsUsable)
                  : formatMoney(displayUsableDiscount)
              }}</strong>
            </div>
            <span class="cust-member__earn">
              {{ isPostPaid ? "ได้บิลนี้" : "แต้มบิลนี้" }}
              <b>+{{ formatInt(displayPointsToEarn) }}</b>
            </span>
          </template>
        </div>
      </header>

      <div ref="listEl" class="cust-lines">
        <div v-if="!hasItems" class="cust-empty">
          <p>ยังไม่มีรายการ</p>
          <span>เมื่อแคชเชียร์สแกนสินค้า จะแสดงที่นี่</span>
        </div>
        <div
          v-for="(line, i) in cart.lines"
          :key="line.id"
          class="cust-line"
        >
          <span class="cust-line__no">{{ i + 1 }}</span>
          <div class="cust-line__body">
            <strong>{{ line.name }}</strong>
            <span class="cust-line__meta">
              <em>{{ line.qty }} {{ line.unit }}</em>
              <span>{{ formatMoney(line.unitPrice) }}</span>
            </span>
            <span v-if="line.discount > 0" class="cust-line__disc">
              ลดรายการ -{{ formatMoney(line.discount) }}
            </span>
          </div>
          <em class="cust-line__amt">{{ formatMoney(line.lineTotal) }}</em>
        </div>
      </div>

      <footer class="cust-foot">
        <div v-if="cart.discount > 0" class="cust-disc">
          <div class="cust-disc__label">
            <span>มีส่วนลด</span>
            <small>ก่อนลด {{ formatMoney(cart.subtotal) }} บ.</small>
          </div>
          <strong>-{{ formatMoney(cart.discount) }}</strong>
        </div>
        <div class="cust-total" :class="{ 'has-disc': cart.discount > 0 }">
          <div class="cust-total__label">
            <span>รวมทั้งสิ้น</span>
            <small v-if="cart.discount > 0" class="cust-total__was">
              {{ formatMoney(cart.subtotal) }}
            </small>
          </div>
          <div>
            <strong>{{ formatMoney(cart.total) }}</strong>
            <small>บ.</small>
          </div>
        </div>
      </footer>
    </section>
  </div>
</template>
