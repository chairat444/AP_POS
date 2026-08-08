<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { storeToRefs } from "pinia";
import {
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
import { formatInt, formatMoney } from "../utils/format";

const open = defineModel<boolean>("open", { default: false });

const cart = useCartStore();
const settings = useSettingsStore();
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
    if (!finishing) {
      cart.clearPayProgress();
      cart.clearPointsDiscount();
    }
    finishing = false;
    return;
  }
  finishing = false;
  resetForm();
  syncPayToCustomer();
  focusAmount(true);
  requestAnimationFrame(() => focusAmount(true));
  setTimeout(() => focusAmount(true), 50);
});

watch(extraDiscount, (v) => {
  if (open.value) cart.setManualDiscount(v);
});

watch(
  [open, payments, paidToward, remaining, change, displayedChange, summary],
  () => {
    if (open.value) syncPayToCustomer();
  },
  { deep: true },
);

function syncPayToCustomer() {
  if (!open.value) return;
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
  });
}

function resetForm() {
  payments.value = [];
  errorText.value = "";
  extraDiscountText.value = String(manualDiscount.value || 0);
  amountText.value = "";
  typingFresh.value = true;
  allowOtherFocus.value = false;
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
      "Enter",
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

function payWith(method: PaymentMethod) {
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
  }

  amountText.value = "";
  typingFresh.value = true;

  // ครบยอดแล้วจบบิลทันที — nextTick ให้ computed ยอดคงเหลือตามให้ทัน
  void nextTick(() => {
    if (!open.value) return;
    if (remaining.value <= 1e-9) confirm();
    else focusAmount(true);
  });
}

function removePayment(index: number) {
  payments.value = payments.value.filter((_, i) => i !== index);
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

  const ok = await cart.completePayment(payload);
  finishing = false;
  if (!ok) {
    open.value = true;
    errorText.value = cart.statusMessage || "ชำระไม่สำเร็จ";
    void nextTick(() => focusAmount(true));
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
        <h2>ชำระเงิน</h2>
        <div class="pay-screen-head-meta">
          <span class="pay-member-name">{{ memberName }}</span>
          <template v-if="memberId">
            <span class="pay-mp">
              <em>แต้มใช้ได้</em>
              <strong>{{ formatInt(pointsRemaining) }}</strong>
            </span>
            <span class="pay-mp pay-mp--earn">
              <em>แต้มบิลนี้</em>
              <strong>+{{ formatInt(pointsEarnThisBill) }}</strong>
            </span>
          </template>
        </div>
        <button
          type="button"
          class="pay-cancel-sm"
          @mousedown="keepAmountFocus"
          @click="close"
        >
          ยกเลิก Esc
        </button>
      </header>

      <div class="pay-screen-body">
        <div class="pay-hero-bar">
          <div class="pay-stat pay-stat-due">
            <span class="pay-stat-label">ยอดที่ต้องชำระ</span>
            <strong class="pay-stat-value">{{ formatMoney(summary.total) }}</strong>
          </div>
          <div class="pay-stat">
            <span class="pay-stat-label">ชำระแล้ว</span>
            <strong class="pay-stat-value">{{ formatMoney(paidToward) }}</strong>
          </div>
          <div
            class="pay-stat pay-stat-remain"
            :class="{ done: remaining <= 0 }"
          >
            <span class="pay-stat-label">คงเหลือ</span>
            <strong class="pay-stat-value">{{ formatMoney(remaining) }}</strong>
          </div>
        </div>

        <div class="pay-main">
          <aside class="pay-side-col">
            <div
              class="pay-change-chip"
              :class="{
                active: displayedChange > 0,
                draft: previewCashChange > 0 && change <= 0,
              }"
            >
              <div class="pay-change-chip-label">
                <span>เงินทอน</span>
                <small v-if="previewCashChange > 0 && change <= 0">
                  พรีวิวจากจำนวนที่พิมพ์
                </small>
                <small v-else-if="change > 0">หลังรับเงินสด</small>
                <small v-else>ดูหลักที่หน้ารายการหลังจบบิล</small>
              </div>
              <strong>{{ formatMoney(displayedChange) }}</strong>
            </div>

            <div class="pay-side-meta">
              <div class="pay-side-row">
                <span>ก่อนลด</span>
                <strong>{{ formatMoney(summary.subtotal) }}</strong>
              </div>
              <div
                v-if="summary.discount - pointsDiscount > 0"
                class="pay-side-row"
              >
                <span>โปร / ส่วนลดอื่น</span>
                <strong class="disc">
                  -{{ formatMoney(summary.discount - pointsDiscount) }}
                </strong>
              </div>
              <div
                class="pay-side-row pay-side-row--points"
                :class="{ 'is-on': pointsDiscount > 0 }"
              >
                <span>
                  ส่วนลดแต้ม
                  <small v-if="pointsUsed > 0">
                    (ใช้ {{ formatInt(pointsUsed) }} แต้ม)
                  </small>
                </span>
                <strong :class="{ disc: pointsDiscount > 0 }">
                  {{
                    pointsDiscount > 0
                      ? `-${formatMoney(pointsDiscount)}`
                      : "0.00"
                  }}
                </strong>
                <button
                  v-if="pointsDiscount > 0"
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

            <div class="pay-entries">
              <div class="pay-entries-head">รายการชำระ</div>
              <ul v-if="payments.length" class="pay-entry-list">
                <li v-for="(p, i) in payments" :key="i" :data-method="p.method">
                  <span>
                    {{ methodLabel(p.method) }}
                    <template
                      v-if="p.method === 'cash' && (p.tendered ?? 0) > p.amount"
                    >
                      รับ {{ formatInt(p.tendered ?? 0) }}
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
              <div v-else class="pay-entries-empty">
                ยังไม่มีรายการ · พิมพ์จำนวนแล้วกดวิธีจ่าย
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

            <div class="pay-quick-row">
              <button type="button" class="pay-action-btn" @mousedown="keepAmountFocus" @click="fillExact">
                พอดี <kbd>Insert</kbd>
              </button>
              <button
                type="button"
                class="pay-action-btn"
                @mousedown="keepAmountFocus"
                @click="fillRound100"
              >
                ปัด 100 <kbd>-</kbd>
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

            <div class="pay-type-row">
              <button
                type="button"
                class="pay-action-btn pay-type pay-type-cash"
                @mousedown="keepAmountFocus"
                @click="payWith('cash')"
              >
                <span class="pay-type-name">เงินสด</span>
                <kbd>{{ settings.label("pay_cash") }}</kbd>
              </button>
              <button
                type="button"
                class="pay-action-btn pay-type pay-type-transfer"
                @mousedown="keepAmountFocus"
                @click="payWith('transfer')"
              >
                <span class="pay-type-name">เงินโอน</span>
                <kbd>{{ settings.label("pay_transfer") }}</kbd>
              </button>
              <button
                type="button"
                class="pay-action-btn pay-type pay-type-gov"
                @mousedown="keepAmountFocus"
                @click="payWith('government')"
              >
                <span class="pay-type-name">เงินสวัสดิการ</span>
                <kbd>{{ settings.label("pay_government") }}</kbd>
              </button>
              <button
                type="button"
                class="pay-action-btn pay-type pay-type-points"
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
              พิมพ์จำนวน → F12 เงินสด · F11 โอน
              <template v-if="isMac"> (หรือ Ctrl+F11)</template>
              · F10 สวัสดิการ · F9 ส่วนลดแต้ม · ครบยอดจบบิลอัตโนมัติ
            </p>
          </section>
        </div>
      </div>
    </div>
  </div>
</template>
