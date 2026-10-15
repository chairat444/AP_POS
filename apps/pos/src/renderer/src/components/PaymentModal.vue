<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { storeToRefs } from "pinia";
import {
  buildPromptPayQrPayload,
  earnPoints,
  validateCashTender,
  validateExactOrPartialPay,
} from "@ap-pos/shared";
import {
  useCartStore,
  type PaymentEntry,
  type PaymentMethod,
} from "../stores/cart";
import { useSettingsStore } from "../stores/settings";
import { useSessionStore } from "../stores/session";
import {
  getBranchPromptPayId,
  getBranchPromptPayName,
  loadBranches,
} from "../services/sync";
import { formatInt, formatMoney } from "../utils/format";
import { toDataURL as qrToDataUrl } from "qrcode";

const open = defineModel<boolean>("open", { default: false });
const emit = defineEmits<{ paid: [] }>();

const cart = useCartStore();
const settings = useSettingsStore();
const session = useSessionStore();
const isMac = /Mac|iPhone|iPod|iPad/i.test(navigator.platform || navigator.userAgent);
const {
  summary,
  appliedPromos,
  manualDiscount,
  pointsDiscount,
  pointsRedeemedPts,
  lines,
  memberId,
  memberName,
  memberPoints,
} = storeToRefs(cart);

const amountEl = ref<HTMLInputElement | null>(null);
const amountText = ref("");
const extraDiscountText = ref("0");
const payments = ref<PaymentEntry[]>([]);
const errorText = ref("");
const typingFresh = ref(true);
/** อนุญาตโฟกัสช่องส่วนลดชั่วคราว — ออกแล้วดึงกลับช่องเงิน */
const allowOtherFocus = ref(false);

const extraDiscount = computed(() =>
  Math.max(0, Number(extraDiscountText.value) || 0),
);

const paidToward = computed(() =>
  round2(
    payments.value
      .filter((p) => p.method !== "points")
      .reduce((s, p) => s + p.amount, 0),
  ),
);

const remaining = computed(() =>
  round2(Math.max(0, summary.value.total - paidToward.value)),
);

const cashTendered = computed(() =>
  round2(
    payments.value
      .filter((p) => p.method === "cash")
      .reduce((s, p) => s + (p.tendered ?? p.amount), 0),
  ),
);

const change = computed(() =>
  round2(
    Math.max(
      0,
      cashTendered.value -
        payments.value
          .filter((p) => p.method === "cash")
          .reduce((s, p) => s + p.amount, 0),
    ),
  ),
);

const previewCashChange = computed(() => {
  const t = amountInput.value;
  const rem = remaining.value;
  if (t <= 0 || rem <= 0 || t + 1e-9 < rem) return 0;
  return round2(t - rem);
});

const displayedChange = computed(() =>
  change.value > 0 ? change.value : previewCashChange.value,
);

const { pointsConfig } = storeToRefs(settings);

const pointsUsed = computed(() => pointsRedeemedPts.value);

const pointsRemaining = computed(() =>
  Math.max(0, memberPoints.value - pointsUsed.value),
);

const pointsEarnThisBill = computed(() => {
  const earnBase = round2(
    summary.value.total + Math.max(0, pointsDiscount.value),
  );
  return earnPoints(earnBase, pointsConfig.value);
});

const amountInput = computed(() => Number(amountText.value) || 0);

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

/** กัน confirm ซ้ำตอนจบอัตโนมัติ */
let finishing = false;

function focusAmount(select = true) {
  if (!open.value || finishing) return;
  void nextTick(() => {
    const el = amountEl.value;
    if (!el || !open.value) return;
    el.focus({ preventScroll: true });
    if (select) el.select();
  });
}

watch(open, (v) => {
  if (!v) {
    allowOtherFocus.value = false;
    // จบชำระ: completePayment เป็นคนเคลียร์ progress + ส่งเงินทอน
    // ออกจากหน้าชำระโดยไม่จบบิล → เคลียร์ส่วนลดแต้ม ให้กรอกใหม่
    // อย่า reset finishing ตรงนี้ — confirm() ต้องถือธงจนกว่า completePayment จบ
    if (!finishing) {
      cart.clearPayProgress();
      cart.clearPointsDiscount();
    }
    return;
  }
  finishing = false;
  resetForm();
  void (async () => {
    await ensureBranchPromptPay();
    await syncPayToCustomer();
  })();
  focusAmount(true);
  requestAnimationFrame(() => focusAmount(true));
  setTimeout(() => focusAmount(true), 50);
});

watch(extraDiscount, (v) => {
  if (open.value) cart.setManualDiscount(v);
});

/** ยอด QR หลังกดเงินโอน — ตามจำนวนที่พิมพ์ ไม่ผูกยอดคงเหลือ */
const transferQrAmount = ref<number | null>(null);
const transferConfirmBtn = ref<HTMLButtonElement | null>(null);

/** โอนครบยอดแล้ว — รอตรวจสลิปแล้วกดยืนยัน */
const awaitTransferConfirm = computed(
  () =>
    remaining.value <= 1e-9 &&
    transferQrAmount.value != null &&
    transferQrAmount.value > 0 &&
    payments.value.some((p) => p.method === "transfer"),
);

watch(awaitTransferConfirm, (v) => {
  if (!v) {
    allowOtherFocus.value = false;
    return;
  }
  allowOtherFocus.value = true;
  void nextTick(() => {
    transferConfirmBtn.value?.focus();
    requestAnimationFrame(() => transferConfirmBtn.value?.focus());
  });
});
/** กัน sync เก่าทับชื่อ/QR หลังโหลดสาขาเสร็จ */
let paySyncGen = 0;

watch(
  [open, payments, paidToward, remaining, change, displayedChange, summary, transferQrAmount],
  () => {
    if (open.value) void syncPayToCustomer();
  },
  { deep: true },
);

async function ensureBranchPromptPay(): Promise<{
  id: string | null;
  name: string | null;
}> {
  try {
    const list = await loadBranches();
    const branchId = session.device.branchId;
    const hit = list.find((b) => b.id === branchId);
    const id = String(hit?.promptPayId || getBranchPromptPayId(branchId) || "").replace(
      /\D/g,
      "",
    );
    const name = String(
      hit?.promptPayName || getBranchPromptPayName(branchId) || "",
    )
      .replace(/\s+/g, " ")
      .trim();
    settings.setPromptPayId(id || null);
    settings.setPromptPayName(name || null);
    console.info("[promptpay] branch", branchId, "id", id || "(empty)", "name", name || "(empty)");
    return { id: id || null, name: name || null };
  } catch (err) {
    console.warn("[promptpay] loadBranches failed", err);
    return {
      id: resolvePromptPayTarget() || null,
      name: resolvePromptPayName() || null,
    };
  }
}

function resolvePromptPayTarget(): string {
  const fromBranch = getBranchPromptPayId(session.device.branchId);
  return (fromBranch || settings.promptPayId || "").replace(/\D/g, "");
}

function resolvePromptPayName(): string {
  const fromBranch = getBranchPromptPayName(session.device.branchId);
  const fromSettings = String(settings.promptPayName || "")
    .replace(/\s+/g, " ")
    .trim();
  return (fromBranch || fromSettings || "").replace(/\s+/g, " ").trim();
}

function asciiMerchantName(): string {
  const raw = String(settings.storeName || "")
    .replace(/[^\x20-\x7E]/g, "")
    .trim();
  return raw.slice(0, 25) || "AP POS";
}

async function syncPayToCustomer() {
  if (!open.value) return;
  const gen = ++paySyncGen;
  const qrAmount =
    transferQrAmount.value != null && transferQrAmount.value > 0
      ? round2(transferQrAmount.value)
      : 0;
  let promptPayPayload: string | null = null;
  let promptPayQrDataUrl: string | null = null;
  let promptPayAmount: number | null = null;
  let promptPayName: string | null = null;
  let promptPayId: string | null = null;

  // โหลดชื่อ/เบอร์สาขาทุกครั้งก่อนสร้าง QR
  let pp = { id: resolvePromptPayTarget(), name: resolvePromptPayName() };
  if (qrAmount > 0) {
    pp = await ensureBranchPromptPay();
    if (gen !== paySyncGen) return;
  }
  const target = pp.id || resolvePromptPayTarget();
  if (qrAmount > 0 && !target) {
    errorText.value =
      "สาขานี้ยังไม่ตั้ง PromptPay — Admin → สาขา แล้วเปิดรอบใหม่";
  }
  if (qrAmount > 0 && target) {
    try {
      promptPayPayload = buildPromptPayQrPayload({
        target,
        amount: qrAmount,
        merchantName: asciiMerchantName(),
      });
      promptPayAmount = qrAmount;
      promptPayName =
        pp.name || resolvePromptPayName() || null;
      promptPayId = target;
      promptPayQrDataUrl = await qrToDataUrl(promptPayPayload, {
        errorCorrectionLevel: "M",
        margin: 2,
        width: 400,
        color: { dark: "#000000", light: "#ffffff" },
      });
      if (gen !== paySyncGen) return;
      console.info(
        "[promptpay] QR ok amount=",
        qrAmount,
        "name=",
        promptPayName || "(empty)",
        "payloadLen=",
        promptPayPayload.length,
        "imgLen=",
        promptPayQrDataUrl.length,
      );
    } catch (err) {
      if (gen !== paySyncGen) return;
      console.error("[promptpay] QR failed", err);
      errorText.value = "สร้าง QR ไม่สำเร็จ — ดู console";
      promptPayPayload = null;
      promptPayQrDataUrl = null;
      promptPayAmount = null;
      promptPayName = null;
      promptPayId = null;
    }
  }
  if (gen !== paySyncGen) return;
  cart.setPayProgress({
    paid: paidToward.value,
    remaining: remaining.value,
    change: displayedChange.value,
    lines: payments.value
      .filter((p) => p.method !== "points")
      .map((p) => ({
        method: p.method,
        label: methodLabel(p.method),
        amount: p.amount,
      })),
    promptPayPayload,
    promptPayQrDataUrl,
    promptPayAmount,
    promptPayName,
    promptPayId,
  });
}

function resetForm() {
  payments.value = [];
  errorText.value = "";
  extraDiscountText.value = String(manualDiscount.value || 0);
  amountText.value = "";
  typingFresh.value = true;
  allowOtherFocus.value = false;
  transferQrAmount.value = null;
}

function setAmount(n: number) {
  amountText.value = String(n);
  typingFresh.value = true;
  errorText.value = "";
  focusAmount(true);
}

function clearAmount() {
  amountText.value = "";
  typingFresh.value = true;
  errorText.value = "";
  focusAmount(true);
}

function onAmountInput(e: Event) {
  const raw = (e.target as HTMLInputElement).value;
  // รับเฉพาะตัวเลข 0-9 เท่านั้น
  amountText.value = raw.replace(/\D/g, "").slice(0, 8);
  typingFresh.value = false;
  errorText.value = "";
}

function onAmountKeydown(e: KeyboardEvent) {
  if (e.key === "Enter") {
    e.preventDefault();
    if (remaining.value <= 1e-9 && payments.value.length > 0) {
      // โอนรอสลิป — ต้องกดปุ่มยืนยันใน popup
      if (awaitTransferConfirm.value) return;
      confirm();
    }
    return;
  }
  // บล็อกตัวอักษร/สัญลักษณ์ — อนุญาต control keys + F-keys ชำระเงิน
  if (
    e.ctrlKey ||
    e.metaKey ||
    e.altKey ||
    /^F\d{1,2}$/.test(e.key) ||
    [
      "Backspace",
      "Delete",
      "Tab",
      "Escape",
      "ArrowLeft",
      "ArrowRight",
      "Home",
      "End",
      "Insert",
    ].includes(e.key)
  ) {
    return;
  }
  if (!/^\d$/.test(e.key)) {
    e.preventDefault();
  }
}

function onAmountFocus() {
  if (typingFresh.value) {
    void nextTick(() => amountEl.value?.select());
  }
}

function onAmountBlur() {
  if (!open.value || allowOtherFocus.value) return;
  focusAmount(typingFresh.value);
}

function onDiscFocus() {
  allowOtherFocus.value = true;
}

function onDiscBlur() {
  allowOtherFocus.value = false;
  focusAmount(true);
}

/** ปุ่มในหน้าชำระ: ไม่แย่งโฟกัสจากช่องเงิน */
function keepAmountFocus(e: MouseEvent) {
  e.preventDefault();
}

async function payWith(method: PaymentMethod) {
  errorText.value = "";
  if (remaining.value <= 1e-9) {
    if (payments.value.length > 0) {
      confirm();
      return;
    }
    errorText.value = "ชำระครบแล้ว";
    focusAmount(true);
    return;
  }

  const raw = amountInput.value;

  if (method === "cash") {
    const check = validateCashTender(raw, remaining.value);
    if (!check.ok) {
      errorText.value = check.reason;
      focusAmount(true);
      return;
    }
    payments.value = [
      ...payments.value,
      { method: "cash", amount: check.applied, tendered: check.tendered },
    ];
  } else if (method === "points") {
    if (!memberId.value) {
      errorText.value = "เลือกสมาชิกก่อนใช้แต้ม";
      focusAmount(true);
      return;
    }
    const pts = Math.floor(raw);
    if (pts <= 0) {
      errorText.value = "ระบุจำนวนแต้ม";
      focusAmount(true);
      return;
    }
    const result = cart.setPointsRedeem(pts);
    if (!result.ok) {
      errorText.value = result.reason;
      focusAmount(true);
      return;
    }
  } else {
    const label = method === "transfer" ? "เงินโอน" : "เงินสวัสดิการ";
    const check = validateExactOrPartialPay(raw, remaining.value, label);
    if (!check.ok) {
      errorText.value = check.reason;
      focusAmount(true);
      return;
    }
    payments.value = [...payments.value, { method, amount: check.amount }];
    // กดเงินโอน → โหลดชื่อบัญชีก่อน แล้วค่อยโชว์ QR (กัน race ทับชื่อหาย)
    if (method === "transfer") {
      await ensureBranchPromptPay();
      if (!resolvePromptPayTarget()) {
        errorText.value =
          "สาขานี้ยังไม่ตั้ง PromptPay — ไปที่ Admin → สาขา";
      }
      transferQrAmount.value = check.amount;
      await syncPayToCustomer();
    }
  }

  amountText.value = "";
  typingFresh.value = true;

  void nextTick(() => {
    if (!open.value) return;
    if (remaining.value <= 1e-9) {
      // กดโอนครบยอดแล้ว — โชว์ popup ยืนยันสลิป
      if (method === "transfer") {
        allowOtherFocus.value = true;
        transferConfirmBtn.value?.focus();
        return;
      }
      confirm();
    } else focusAmount(true);
  });
}

function removePayment(index: number) {
  payments.value = payments.value.filter((_, i) => i !== index);
  const lastTransfer = [...payments.value]
    .reverse()
    .find((p) => p.method === "transfer");
  transferQrAmount.value = lastTransfer ? lastTransfer.amount : null;
  amountText.value = "";
  typingFresh.value = true;
  errorText.value = "";
  focusAmount(true);
}

function removeLastPayment() {
  if (!payments.value.length) {
    errorText.value = "ยังไม่มีรายการชำระให้ลบ";
    focusAmount(true);
    return;
  }
  removePayment(payments.value.length - 1);
}

function fillExact() {
  const rem = remaining.value;
  if (rem <= 0) {
    errorText.value = "ชำระครบแล้ว";
    focusAmount(true);
    return;
  }
  setAmount(Math.ceil(rem));
}

function fillRound100() {
  const rem = remaining.value || summary.value.total;
  if (rem <= 0) return;
  setAmount(Math.ceil(rem / 100) * 100);
}

async function confirm() {
  if (finishing) return;

  // บิลเคลียร์แล้วแต่หน้าชำระค้าง — ปิดอย่างเดียว
  if (!lines.value.length) {
    open.value = false;
    return;
  }

  if (remaining.value > 1e-9) {
    errorText.value = `ชำระยังไม่ครบ ขาด ${formatMoney(remaining.value)} บาท — พิมพ์จำนวนแล้ว F12/F11/F10/F9`;
    focusAmount(true);
    return;
  }

  finishing = true;
  const payload = payments.value
    .filter((p) => p.method !== "points")
    .map((p) => ({ ...p }));
  // ปิดก่อน แล้วค่อยบันทึก — ไม่ให้ UI ค้างหลังจบบิล
  open.value = false;

  try {
    const ok = await cart.completePayment(payload);
    if (!ok) {
      open.value = true;
      errorText.value = cart.statusMessage || "ชำระไม่สำเร็จ";
      void nextTick(() => focusAmount(true));
      return;
    }
    // แจ้งแคชเชียร์ให้เคลียร์บัฟเฟอร์สแกน — กัน Enter/บาร์โค้ดหลุดหลังจบ
    emit("paid");
  } finally {
    finishing = false;
  }
}

function close() {
  open.value = false;
}

function onKeydown(e: KeyboardEvent) {
  if (!open.value) return;

  if (settings.matches("cancel_payment", e)) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    close();
    return;
  }
  if (settings.matches("confirm_payment", e)) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    confirm();
    return;
  }

  // วิธีจ่ายต้องทำงานแม้โฟกัสช่องส่วนลด (F9–F12)
  if (settings.matches("pay_cash", e)) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    payWith("cash");
    return;
  }
  if (settings.matches("pay_transfer", e)) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    payWith("transfer");
    return;
  }
  if (settings.matches("pay_government", e)) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    payWith("government");
    return;
  }
  if (settings.matches("pay_points", e)) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    payWith("points");
    return;
  }

  if (allowOtherFocus.value) return;

  if (
    e.key === "Insert" ||
    e.code === "Insert" ||
    settings.matches("fill_exact", e)
  ) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    fillExact();
    return;
  }

  if (settings.matches("fill_round_100", e)) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    fillRound100();
    return;
  }

  if (settings.matches("clear_amount", e)) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    clearAmount();
    return;
  }

  if (settings.matches("remove_last_payment", e)) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    removeLastPayment();
  }
}

/**
 * คีย์จาก main ที่ Chromium/OS แย่ง (F10 เมนู, F11 Show Desktop บน macOS)
 * — แมปตรงๆ ไม่พึ่ง synthetic KeyboardEvent (กัน match พลาด)
 */
function onPosHotkey(payload: {
  key: string;
  code: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  meta?: boolean;
}) {
  if (!open.value) return;
  const key = payload.key || payload.code;
  if (key === "F12") {
    payWith("cash");
    return;
  }
  if (key === "F11") {
    payWith("transfer");
    return;
  }
  if (key === "F10") {
    payWith("government");
    return;
  }
  if (key === "F9") {
    payWith("points");
    return;
  }
  const e = new KeyboardEvent("keydown", {
    key: payload.key,
    code: payload.code,
    ctrlKey: Boolean(payload.ctrl),
    shiftKey: Boolean(payload.shift),
    altKey: Boolean(payload.alt),
    metaKey: Boolean(payload.meta),
    bubbles: true,
    cancelable: true,
  });
  onKeydown(e);
}

let unsubHotkey: (() => void) | undefined;

onMounted(() => {
  window.addEventListener("keydown", onKeydown, true);
  unsubHotkey = window.apPos?.onPosHotkey?.(onPosHotkey);
});
onUnmounted(() => {
  window.removeEventListener("keydown", onKeydown, true);
  unsubHotkey?.();
});

function methodLabel(m: PaymentMethod) {
  if (m === "cash") return "เงินสด";
  if (m === "transfer") return "เงินโอน";
  if (m === "government") return "เงินสวัสดิการ";
  return "แต้ม";
}

function clearPointsDiscount() {
  cart.clearPointsDiscount();
  errorText.value = "";
  focusAmount(true);
}
</script>

<template>
  <div v-if="open" class="pay-overlay">
    <div class="pay-screen" @click.stop="focusAmount(false)">
      <header class="pay-screen-head">
        <div class="pay-screen-head-left">
          <h2>ชำระเงิน</h2>
          <div class="pay-screen-head-meta">
            <span class="pay-member-name">{{ memberName }}</span>
            <template v-if="memberId">
              <span class="pay-mp">
                <em>ใช้ได้</em>
                <strong>{{ formatInt(pointsRemaining) }}</strong>
              </span>
              <span class="pay-mp pay-mp--earn">
                <em>ได้บิลนี้</em>
                <strong>+{{ formatInt(pointsEarnThisBill) }}</strong>
              </span>
            </template>
          </div>
        </div>
        <button
          type="button"
          class="pay-cancel-sm"
          @mousedown="keepAmountFocus"
          @click="close"
        >
          ยกเลิก <kbd>Esc</kbd>
        </button>
      </header>

      <div class="pay-screen-body">
        <aside class="pay-side-col">
          <div class="pay-remain-card" :class="{ done: remaining <= 0 }">
            <span class="pay-remain-label">คงเหลือ</span>
            <strong class="pay-remain-value">{{ formatMoney(remaining) }}</strong>
            <div class="pay-remain-meta">
              <span>ยอดบิล {{ formatMoney(summary.total) }}</span>
              <span v-if="paidToward > 0">ชำระแล้ว {{ formatMoney(paidToward) }}</span>
            </div>
          </div>

          <div
            class="pay-change-card"
            :class="{
              active: displayedChange > 0,
              draft: previewCashChange > 0 && change <= 0,
            }"
          >
            <span class="pay-change-label">เงินทอน</span>
            <strong class="pay-change-value">{{ formatMoney(displayedChange) }}</strong>
          </div>

          <div class="pay-entries">
            <div class="pay-entries-head">รายการชำระ</div>
            <ul v-if="payments.length" class="pay-entry-list">
              <li v-for="(p, i) in payments" :key="i" :data-method="p.method">
                <span>
                  {{ methodLabel(p.method) }}
                  <template
                    v-if="p.method === 'cash' && (p.tendered ?? 0) > p.amount"
                  >
                    · รับ {{ formatInt(p.tendered ?? 0) }}
                  </template>
                </span>
                <strong>{{ formatMoney(p.amount) }}</strong>
                <button
                  type="button"
                  @mousedown="keepAmountFocus"
                  @click="removePayment(i)"
                >
                  ×
                </button>
              </li>
            </ul>
            <div v-else class="pay-entries-empty">ยังไม่มีรายการ</div>
          </div>

          <div class="pay-side-tools">
            <div
              v-if="pointsDiscount > 0"
              class="pay-side-row pay-side-row--points is-on"
            >
              <span>
                ส่วนลดแต้ม
                <small v-if="pointsUsed > 0">
                  ({{ formatInt(pointsUsed) }} แต้ม)
                </small>
              </span>
              <strong class="disc">-{{ formatMoney(pointsDiscount) }}</strong>
              <button
                type="button"
                class="pay-points-clear"
                @mousedown="keepAmountFocus"
                @click="clearPointsDiscount"
              >
                ลบ
              </button>
            </div>
            <label class="pay-disc-inline" @click.stop>
              <span>ลดท้ายบิล</span>
              <input
                v-model="extraDiscountText"
                type="number"
                min="0"
                step="1"
                @focus="onDiscFocus"
                @blur="onDiscBlur"
              />
            </label>
            <div v-if="appliedPromos.length" class="pay-promo-mini">
              <span v-for="p in appliedPromos" :key="p.promoId">
                {{ p.label }} -{{ formatInt(p.discount) }}
              </span>
            </div>
          </div>
        </aside>

        <section class="pay-input-col">
          <label class="pay-amount-display">
            <span>จำนวนเงิน</span>
            <input
              ref="amountEl"
              class="pay-amount-input"
              type="text"
              inputmode="numeric"
              pattern="[0-9]*"
              autocomplete="off"
              :value="amountText"
              @input="onAmountInput"
              @keydown="onAmountKeydown"
              @focus="onAmountFocus"
              @blur="onAmountBlur"
            />
          </label>

          <p v-if="resolvePromptPayTarget()" class="pay-pp-hint">
            พิมพ์ยอด → กดเงินโอน = โชว์ QR บนจอลูกค้า
            <template v-if="transferQrAmount && !awaitTransferConfirm">
              · ตอนนี้ {{ formatMoney(transferQrAmount) }}
            </template>
          </p>
          <p v-else class="pay-pp-hint pay-pp-hint--warn">
            สาขานี้ยังไม่มี PromptPay — ตั้งที่ Admin → สาขา แล้วเปิดรอบใหม่
          </p>

          <div class="pay-quick-row">
            <button
              type="button"
              class="pay-action-btn"
              @mousedown="keepAmountFocus"
              @click="fillExact"
            >
              พอดี <kbd>Ins</kbd>
            </button>
            <button
              type="button"
              class="pay-action-btn"
              @mousedown="keepAmountFocus"
              @click="fillRound100"
            >
              ปัด 100
            </button>
            <button
              type="button"
              class="pay-action-btn"
              @mousedown="keepAmountFocus"
              @click="setAmount(500)"
            >
              500
            </button>
            <button
              type="button"
              class="pay-action-btn"
              @mousedown="keepAmountFocus"
              @click="setAmount(1000)"
            >
              1000
            </button>
          </div>

          <div class="pay-type-grid">
            <button
              type="button"
              class="pay-type-tile pay-type-cash"
              @mousedown="keepAmountFocus"
              @click="payWith('cash')"
            >
              <span class="pay-type-name">เงินสด</span>
              <kbd>{{ settings.label("pay_cash") }}</kbd>
            </button>
            <button
              type="button"
              class="pay-type-tile pay-type-transfer"
              @mousedown="keepAmountFocus"
              @click="payWith('transfer')"
            >
              <span class="pay-type-name">เงินโอน</span>
              <kbd>{{ settings.label("pay_transfer") }}</kbd>
            </button>
            <button
              type="button"
              class="pay-type-tile pay-type-gov"
              @mousedown="keepAmountFocus"
              @click="payWith('government')"
            >
              <span class="pay-type-name">สวัสดิการ</span>
              <kbd>{{ settings.label("pay_government") }}</kbd>
            </button>
            <button
              type="button"
              class="pay-type-tile pay-type-points"
              :disabled="!memberId || pointsRemaining <= 0"
              @mousedown="keepAmountFocus"
              @click="payWith('points')"
            >
              <span class="pay-type-name">ส่วนลดแต้ม</span>
              <kbd>{{ settings.label("pay_points") }}</kbd>
            </button>
          </div>

          <div v-if="errorText" class="pay-warn-inline">{{ errorText }}</div>
          <p v-else class="pay-keys-hint">
            พิมพ์จำนวน → กดวิธีจ่าย · ครบยอดจบบิลอัตโนมัติ
            <template v-if="isMac"> · macOS ใช้ Ctrl+F11 สำหรับโอน</template>
          </p>
        </section>
      </div>
    </div>

    <div
      v-if="awaitTransferConfirm"
      class="pay-transfer-popup-layer"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pay-transfer-popup-title"
    >
      <div class="pay-transfer-popup" @click.stop>
        <p id="pay-transfer-popup-title" class="pay-transfer-popup__msg">
          ตรวจสอบยอดเงิน/ถ่ายสลิปเรียบร้อยแล้ว
        </p>
        <div class="pay-transfer-popup__actions">
          <button
            type="button"
            class="pay-transfer-popup__btn pay-transfer-popup__btn--cancel"
            @click="close"
          >
            ยกเลิก
          </button>
          <button
            ref="transferConfirmBtn"
            type="button"
            class="pay-transfer-popup__btn pay-transfer-popup__btn--confirm"
            @click="confirm"
          >
            ยืนยัน
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
