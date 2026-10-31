<script setup lang="ts">
type PointsConfig = {
  bahtPerPoint: number;
  bahtPerRedeemPoint: number;
};

type LineSignup = {
  enabled: boolean;
  bonusPoints: number;
  startDate: string;
  endDate: string;
  headline: string;
  active?: boolean;
  headlinePreview?: string;
  joinUrl?: string | null;
};

const { get, post } = useAdminApi();
const pending = ref(false);
const saving = ref(false);
const error = ref("");
const ok = ref("");
const copied = ref(false);
const form = reactive({
  bahtPerPoint: "100",
  bahtPerRedeemPoint: "1",
});
const lineForm = reactive({
  enabled: true,
  bonusPoints: "10",
  startDate: "",
  endDate: "",
  headline: "สมัครผ่านไลน์วันนี้รับ {n} แต้ม",
});
const joinUrl = ref("");
const lineActive = ref(false);

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

const previewLine = computed(() => {
  const n = Number(lineForm.bonusPoints);
  const pts = Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
  const t = lineForm.headline.trim() || "สมัครผ่านไลน์วันนี้รับ {n} แต้ม";
  return t.includes("{n}") ? t.split("{n}").join(String(pts)) : t;
});

async function load() {
  pending.value = true;
  error.value = "";
  ok.value = "";
  try {
    const [data, line] = await Promise.all([
      get<{ points: PointsConfig }>("/settings"),
      get<LineSignup>("/settings/line-signup"),
    ]);
    form.bahtPerPoint = String(data.points?.bahtPerPoint ?? 100);
    form.bahtPerRedeemPoint = String(data.points?.bahtPerRedeemPoint ?? 1);
    lineForm.enabled = line.enabled !== false;
    lineForm.bonusPoints = String(line.bonusPoints ?? 10);
    lineForm.startDate = line.startDate || "";
    lineForm.endDate = line.endDate || "";
    lineForm.headline =
      line.headline || "สมัครผ่านไลน์วันนี้รับ {n} แต้ม";
    joinUrl.value = line.joinUrl || "";
    lineActive.value = Boolean(line.active);
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
    await post("/settings/line-signup", {
      enabled: lineForm.enabled,
      bonusPoints: Number(lineForm.bonusPoints),
      startDate: lineForm.startDate,
      endDate: lineForm.endDate,
      headline: lineForm.headline,
    });
    ok.value = "บันทึกแล้ว — POS จะได้รับอัตราแต้มตอน sync · แคมเปญไลน์ใช้ทันที";
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

async function copyJoinUrl() {
  if (!joinUrl.value) return;
  try {
    await navigator.clipboard.writeText(joinUrl.value);
    copied.value = true;
    window.setTimeout(() => {
      copied.value = false;
    }, 2000);
  } catch {
    error.value = "คัดลอกลิงก์ไม่สำเร็จ · คัดลอกจากช่องด้านล่างเอง";
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

    <div class="ui-card ui-points-card" style="max-width: 40rem">
      <div class="ui-card__toolbar">
        <span class="ui-toolbar-meta ui-toolbar-meta--alone">สมัครผ่าน LINE OA</span>
      </div>
      <div style="padding: 1.15rem 1.25rem 1.35rem">
        <label class="ui-check" style="display: flex; gap: 0.5rem; align-items: center; margin-bottom: 1rem">
          <input v-model="lineForm.enabled" type="checkbox" />
          <span>ให้แต้มของขวัญตอนสมัครจากลิงก์ไลน์</span>
        </label>
        <label class="ui-field">
          <span>ได้กี่แต้ม</span>
          <input
            v-model="lineForm.bonusPoints"
            class="ui-input"
            type="number"
            min="0"
            max="10000"
            step="1"
          />
        </label>
        <label class="ui-field">
          <span>ข้อความบนหน้าสมัคร · ใช้ {"{n}"} แทนจำนวนแต้ม</span>
          <input
            v-model="lineForm.headline"
            class="ui-input"
            type="text"
            maxlength="80"
            placeholder="สมัครผ่านไลน์วันนี้รับ {n} แต้ม"
          />
        </label>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem">
          <label class="ui-field">
            <span>เริ่ม (ว่าง = ทันที)</span>
            <input v-model="lineForm.startDate" class="ui-input" type="date" />
          </label>
          <label class="ui-field">
            <span>ถึง (ว่าง = ไม่หมดอายุ)</span>
            <input v-model="lineForm.endDate" class="ui-input" type="date" />
          </label>
        </div>
        <p class="ui-field-hint">
          {{ previewLine }}
          <template v-if="lineForm.enabled">
            · ตอนนี้{{ lineActive ? "กำลังให้แต้ม" : "ยังไม่ถึงช่วงแคมเปญ" }}
          </template>
          <template v-else> · ปิดอยู่</template>
        </p>
        <p class="ui-field-hint">
          ใส่ลิงก์ LIFF นี้ในเมนูลัด / ข้อความต้อนรับของ LINE OA
          (`https://liff.line.me/…`) ระบบจะผูก LINE user ID ให้
        </p>
        <div v-if="joinUrl" style="display: flex; gap: 0.5rem; align-items: stretch">
          <input class="ui-input" type="text" readonly :value="joinUrl" />
          <button type="button" class="ui-btn ui-btn--ghost" @click="copyJoinUrl">
            {{ copied ? "คัดลอกแล้ว" : "คัดลอก" }}
          </button>
        </div>
        <p v-else class="ui-field-hint">
          ยังไม่มีรหัส kiosk ในเซิร์ฟเวอร์ · เอาลิงก์ QR สมัครสมาชิกมาต่อท้าย
          <code>&src=line</code>
        </p>
      </div>
    </div>

    <div class="ui-points-preview" style="max-width: 40rem">
      <div>{{ previewEarn }}</div>
      <div>{{ previewRedeem }}</div>
      <div>{{ previewLine }}</div>
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
