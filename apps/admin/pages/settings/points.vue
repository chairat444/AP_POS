<script setup lang="ts">
type PointsConfig = {
  bahtPerPoint: number;
  bahtPerRedeemPoint: number;
};

const { get, post } = useAdminApi();
const pending = ref(false);
const saving = ref(false);
const error = ref("");
const ok = ref("");
const form = reactive({
  bahtPerPoint: "100",
  bahtPerRedeemPoint: "1",
});

const previewEarn = computed(() => {
  const n = Number(form.bahtPerPoint);
  if (!Number.isFinite(n) || n <= 0) return "-";
  return `ซื้อครบ ${n.toLocaleString("th-TH")} บาท → ได้ 1 แต้ม`;
});

const previewRedeem = computed(() => {
  const n = Number(form.bahtPerRedeemPoint);
  if (!Number.isFinite(n) || n <= 0) return "-";
  return `ใช้ 1 แต้ม = ส่วนลด ${n.toLocaleString("th-TH", {
    minimumFractionDigits: n % 1 ? 2 : 0,
    maximumFractionDigits: 2,
  })} บาท`;
});

async function load() {
  pending.value = true;
  error.value = "";
  ok.value = "";
  try {
    const data = await get<{ points: PointsConfig }>("/settings");
    form.bahtPerPoint = String(data.points?.bahtPerPoint ?? 100);
    form.bahtPerRedeemPoint = String(data.points?.bahtPerRedeemPoint ?? 1);
  } catch (e) {
    error.value = e instanceof Error ? e.message : "โหลดตั้งค่าไม่สำเร็จ";
  } finally {
    pending.value = false;
  }
}

async function save() {
  saving.value = true;
  error.value = "";
  ok.value = "";
  try {
    await post("/settings/points", {
      bahtPerPoint: Number(form.bahtPerPoint),
      bahtPerRedeemPoint: Number(form.bahtPerRedeemPoint),
    });
    ok.value = "บันทึกแล้ว — POS จะได้รับตอน sync";
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
        <h1 class="ui-page-title">ตั้งค่าแต้ม</h1>
        <p class="ui-page-sub">อัตราได้แต้ม / ใช้แต้มทั้งระบบ · sync ไป POS</p>
      </div>
      <div class="ui-page-head__actions">
        <button type="button" class="ui-btn ui-btn--ghost" :disabled="pending" @click="load">
          {{ pending ? "กำลังโหลด..." : "รีเฟรช" }}
        </button>
      </div>
    </div>

    <div v-if="error" class="ui-empty">{{ error }}</div>
    <div v-if="ok" class="ui-empty" style="color: #0f5a3d">{{ ok }}</div>

    <div class="ui-card ui-points-card" style="max-width: 40rem">
      <div class="ui-card__toolbar">
        <span class="ui-toolbar-meta ui-toolbar-meta--alone">ได้แต้มจากการซื้อ</span>
      </div>
      <div style="padding: 1.15rem 1.25rem 1.35rem">
        <label class="ui-field">
          <span>ยอดซื้อกี่บาท ได้ 1 แต้ม</span>
          <input
            v-model="form.bahtPerPoint"
            class="ui-input"
            type="number"
            min="1"
            step="1"
          />
        </label>
        <p class="ui-field-hint">เช่น 100 = ซื้อครบ 100 บาท ได้ 1 แต้ม</p>
      </div>
    </div>

    <div class="ui-card ui-points-card" style="max-width: 40rem">
      <div class="ui-card__toolbar">
        <span class="ui-toolbar-meta ui-toolbar-meta--alone">ใช้แต้มชำระ / ส่วนลด</span>
      </div>
      <div style="padding: 1.15rem 1.25rem 1.35rem">
        <label class="ui-field">
          <span>1 แต้ม เท่ากับกี่บาท</span>
          <input
            v-model="form.bahtPerRedeemPoint"
            class="ui-input"
            type="number"
            min="0.01"
            step="0.01"
          />
        </label>
        <p class="ui-field-hint">
          ค่านี้ใช้ตอนลูกค้าใช้แต้มที่ POS เช่น 1 = ใช้ 1 แต้มลดได้ 1 บาท
        </p>
      </div>
    </div>

    <div class="ui-points-preview" style="max-width: 40rem">
      <div>{{ previewEarn }}</div>
      <div>{{ previewRedeem }}</div>
    </div>

    <div style="margin-top: 1.15rem">
      <button
        type="button"
        class="ui-btn ui-btn--primary"
        :disabled="saving"
        @click="save"
      >
        {{ saving ? "กำลังบันทึก..." : "บันทึก" }}
      </button>
    </div>
  </div>
</template>
