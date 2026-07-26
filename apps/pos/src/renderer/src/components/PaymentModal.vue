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

const open = defineModel<boolean>("open", { default: false });

const cart = useCartStore();
const settings = useSettingsStore();
const {
  summary,
  appliedPromos,
  manualDiscount,
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
  round2(payments.value.reduce((s, p) => s + p.amount, 0)),
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

const pointsUsed = computed(() =>
  Math.floor(
    payments.value
      .filter((p) => p.method === "points")
      .reduce((s, p) => s + p.amount, 0),
  ),
);

const pointsRemaining = computed(() =>
  Math.max(0, memberPoints.value - pointsUsed.value),
);

const pointsEarnThisBill = computed(() =>
  earnPoints(Math.max(0, summary.value.total - pointsUsed.value)),
);

const amountInput = computed(() => Number(amountText.value) || 0);

const canConfirm = computed(
  () =>
    lines.value.length > 0 &&
    remaining.value <= 1e-9 &&
    payments.value.length > 0,
);

const isPaid = computed(() => remaining.value <= 1e-9 && payments.value.length > 0);

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
    finishing = false;
    return;
  }
  finishing = false;
  // ดึงคีย์ลัดล่าสุด (กัน HMR ค้าง F5–F8 เก่า)
  settings.resetKeybindings();
  resetForm();
  focusAmount(true);
  requestAnimationFrame(() => focusAmount(true));
  setTimeout(() => focusAmount(true), 50);
});

watch(extraDiscount, (v) => {
  if (open.value) cart.setManualDiscount(v);
});

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
  // บล็อกตัวอักษร/สัญลักษณ์ — อนุญาต control keys
  if (
    e.ctrlKey ||
    e.metaKey ||
    e.altKey ||
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
    if (pts > pointsRemaining.value) {
      errorText.value = `แต้มไม่พอ (มี ${pointsRemaining.value} แต้ม)`;
      focusAmount(true);
      return;
    }
    const check = validateExactOrPartialPay(pts, remaining.value, "แต้ม");
    if (!check.ok) {
      errorText.value = check.reason;
      focusAmount(true);
      return;
    }
    payments.value = [...payments.value, { method: "points", amount: check.amount }];
  } else {
    const label = method === "transfer" ? "เงินโอน" : "โครงการรัฐ";
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

function confirm() {
  if (finishing) return;

  // บิลเคลียร์แล้วแต่หน้าชำระค้าง — ปิดอย่างเดียว
  if (!lines.value.length) {
    open.value = false;
    return;
  }

  if (remaining.value > 1e-9) {
    errorText.value = `ชำระยังไม่ครบ ขาด ${remaining.value.toFixed(2)} บาท — พิมพ์จำนวนแล้ว F12/F11/F10/F9`;
    focusAmount(true);
    return;
  }
  if (!payments.value.length) {
    errorText.value = "ยังไม่ได้ใส่การชำระ";
    focusAmount(true);
    return;
  }

  finishing = true;
  const payload = payments.value.map((p) => ({ ...p }));
  // ปิดก่อน แล้วค่อยบันทึก — ไม่ให้ UI ค้างหลังจบบิล
  open.value = false;

  const ok = cart.completePayment(payload);
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
    return;
  }

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
  }
}

onMounted(() => window.addEventListener("keydown", onKeydown, true));
onUnmounted(() => window.removeEventListener("keydown", onKeydown, true));

function methodLabel(m: PaymentMethod) {
  if (m === "cash") return "เงินสด";
  if (m === "transfer") return "เงินโอน";
  if (m === "government") return "โครงการรัฐ";
  return "แต้ม";
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}
</script>

<template>
  <div v-if="open" class="pay-overlay">
    <div class="pay-screen" @click.stop="focusAmount(false)">
      <header class="pay-screen-head">
        <h2>ชำระเงิน</h2>
        <div class="pay-screen-head-meta">
          <span>{{ memberName }}</span>
          <span v-if="memberId">· {{ pointsRemaining }} แต้มใช้ได้</span>
          <span v-if="memberId">· ได้บิลนี้ {{ pointsEarnThisBill }} แต้ม</span>
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
        <div class="pay-main">
          <aside class="pay-side-col">
            <div
              class="pay-change-hero"
              :class="{
                active: displayedChange > 0,
                draft: previewCashChange > 0 && change <= 0,
              }"
            >
              <div class="pay-change-hero-label">
                <span>เงินทอน</span>
                <small v-if="previewCashChange > 0 && change <= 0">
                  จากจำนวนที่พิมพ์ — กด F12 รับเงินสด
                </small>
                <small v-else-if="change > 0">ต้องทอนให้ลูกค้า</small>
                <small v-else>พิมพ์เงินสดเกินยอด แล้วโชว์ตรงนี้</small>
              </div>
              <strong>{{ displayedChange.toFixed(2) }}</strong>
            </div>

            <div class="pay-side-meta">
              <div class="pay-side-row">
                <span>ก่อนลด</span>
                <strong>{{ summary.subtotal.toFixed(2) }}</strong>
              </div>
              <div class="pay-side-row">
                <span>ส่วนลด</span>
                <strong :class="{ disc: summary.discount > 0 }">
                  {{
                    summary.discount > 0
                      ? `-${summary.discount.toFixed(2)}`
                      : "0.00"
                  }}
                </strong>
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
                  {{ p.label }} -{{ p.discount.toFixed(0) }}
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
                      รับ {{ (p.tendered ?? 0).toFixed(0) }}
                    </template>
                  </span>
                  <strong>{{ p.amount.toFixed(2) }}</strong>
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
            <div class="pay-left-sums">
              <div class="pay-stat pay-stat-due">
                <span class="pay-stat-label">ยอดชำระ</span>
                <strong class="pay-stat-value">{{ summary.total.toFixed(2) }}</strong>
              </div>
              <div class="pay-stat">
                <span class="pay-stat-label">ชำระแล้ว</span>
                <strong class="pay-stat-value">{{ paidToward.toFixed(2) }}</strong>
              </div>
              <div
                class="pay-stat pay-stat-remain"
                :class="{ done: remaining <= 0 }"
              >
                <span class="pay-stat-label">คงเหลือ</span>
                <strong class="pay-stat-value">{{ remaining.toFixed(2) }}</strong>
              </div>
            </div>

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
                <span class="pay-type-name">โครงการรัฐ</span>
                <kbd>{{ settings.label("pay_government") }}</kbd>
              </button>
              <button
                type="button"
                class="pay-action-btn pay-type pay-type-points"
                :disabled="!memberId || pointsRemaining <= 0"
                @mousedown="keepAmountFocus"
                @click="payWith('points')"
              >
                <span class="pay-type-name">ใช้แต้ม</span>
                <kbd>{{ settings.label("pay_points") }}</kbd>
              </button>
            </div>

            <div v-if="errorText" class="pay-warn-inline">{{ errorText }}</div>
            <p v-else class="pay-keys-hint">
              พิมพ์จำนวน → F12 เงินสด · F11 โอน · F10 รัฐ · F9 แต้ม · ครบยอดจบบิลอัตโนมัติ
            </p>
          </section>
        </div>
      </div>
    </div>
  </div>
</template>
