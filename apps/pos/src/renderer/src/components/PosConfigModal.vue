<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import {
  buildReceiptPrintPayload,
  buildReceiptText,
  loadPrinterConfig,
  savePrinterConfig,
  type PaperWidth,
  type PrinterConfig,
} from "../services/receipt";
import {
  getAdminUrl,
  getApiBase,
  getDefaultApiBase,
  refreshApiOnline,
  savePosNetworkConfig,
} from "../services/sync";

const open = defineModel<boolean>("open", { default: false });
const emit = defineEmits<{ saved: [] }>();

type TabId = "network" | "printer" | "slip";

const tab = ref<TabId>("network");
const apiBase = ref("");
const adminUrl = ref("");
const saving = ref(false);
const testing = ref(false);
const testingPrint = ref(false);
const error = ref("");
const message = ref("");
const apiInput = ref<HTMLInputElement | null>(null);

const paperWidth = ref<PaperWidth>("58mm");
const autoPrint = ref(true);
const silent = ref(true);
const printerName = ref("");
const openDrawer = ref(true);
const headerText = ref("เอพี หมูสด ({สาขา})\nมาตรฐาน สะอาด ปลอดภัย");
const footerHours = ref("เปิดบริการทุกวัน 09.00 - 20.00 น.");
const footerPhones = ref("ติดต่อ 084 912 3509, 092 494 5442");
const printers = ref<Array<{ name: string; isDefault: boolean }>>([]);

async function loadPrinters() {
  try {
    const res = await window.apPos?.print?.listPrinters?.();
    printers.value = res?.printers ?? [];
  } catch {
    printers.value = [];
  }
}

async function hydrate() {
  apiBase.value = getApiBase();
  adminUrl.value = getAdminUrl();
  error.value = "";
  message.value = "";
  tab.value = "network";
  const printer = await loadPrinterConfig();
  paperWidth.value = printer.paperWidth;
  autoPrint.value = printer.autoPrint;
  silent.value = printer.silent;
  printerName.value = printer.printerName;
  openDrawer.value = printer.openDrawer;
  headerText.value = printer.headerText;
  footerHours.value = printer.footerHours;
  footerPhones.value = printer.footerPhones;
  await loadPrinters();
  if (!printerName.value.trim()) {
    const hit =
      printers.value.find((p) => /xp-?58/i.test(p.name)) ??
      printers.value.find((p) => /xprinter/i.test(p.name) && !/pdf/i.test(p.name));
    if (hit) printerName.value = hit.name;
  }
}

watch(open, (v) => {
  if (!v) return;
  void hydrate().then(() => nextTick(() => apiInput.value?.focus()));
});

function printerPatch(): Partial<PrinterConfig> {
  return {
    paperWidth: paperWidth.value,
    autoPrint: autoPrint.value,
    silent: silent.value,
    printerName: printerName.value.trim(),
    openDrawer: openDrawer.value,
    headerText: headerText.value,
    footerHours: footerHours.value,
    footerPhones: footerPhones.value,
  };
}

async function save() {
  if (saving.value) return;
  saving.value = true;
  error.value = "";
  message.value = "";
  try {
    await savePosNetworkConfig({
      apiBase: apiBase.value,
      adminUrl: adminUrl.value,
    });
    await savePrinterConfig(printerPatch());
    message.value = "บันทึกแล้ว · ใช้ค่าใหม่ทันที";
    emit("saved");
  } catch (e) {
    error.value = e instanceof Error ? e.message : "บันทึกไม่สำเร็จ";
  } finally {
    saving.value = false;
  }
}

async function testApi() {
  if (testing.value) return;
  testing.value = true;
  error.value = "";
  message.value = "";
  tab.value = "network";
  try {
    await savePosNetworkConfig({
      apiBase: apiBase.value,
      adminUrl: adminUrl.value,
    });
    const ok = await refreshApiOnline({ attempts: 2, timeoutMs: 800 });
    message.value = ok
      ? "ติดต่อ API ได้"
      : "ติดต่อ API ไม่ได้ — ตรวจ URL / เน็ต / เซิร์ฟเวอร์";
    if (!ok) error.value = message.value;
  } catch (e) {
    error.value = e instanceof Error ? e.message : "ทดสอบไม่สำเร็จ";
  } finally {
    testing.value = false;
  }
}

async function testPrint() {
  if (testingPrint.value) return;
  testingPrint.value = true;
  error.value = "";
  message.value = "";
  tab.value = "printer";
  try {
    await savePrinterConfig(printerPatch());
    const sample = {
      storeName: "เอพี หมูสด",
      branchName: "ทดสอบ",
      tagline: "มาตรฐาน สะอาด ปลอดภัย",
      headerText: headerText.value,
      billNo: "TEST-001",
      at: new Date().toISOString(),
      lines: [
        {
          name: "ทดสอบรายการชื่อยาวหน่อย",
          qty: 1,
          unit: "ชิ้น",
          unitPrice: 10,
          lineTotal: 10,
        },
      ],
      itemCount: 1,
      subtotal: 10,
      promoDiscount: 0,
      promos: [],
      pointsDiscount: 0,
      total: 10,
      payments: [{ method: "cash", label: "เงินสด", amount: 10 }],
      change: 0,
      paperWidth: paperWidth.value,
      footerHours: footerHours.value,
      footerPhones: footerPhones.value,
      appVersion: "AP Version 0.1.0",
    };
    const text = buildReceiptPrintPayload(sample);
    const preview = buildReceiptText(sample);
    const html = `<pre style="font:11px/1.3 monospace;white-space:pre-wrap;margin:8px">${preview
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")}</pre>`;
    const res = await window.apPos?.print?.receipt?.({
      html,
      text,
      paperWidth: paperWidth.value,
      silent: silent.value,
      deviceName: printerName.value.trim() || undefined,
      openDrawer: openDrawer.value,
    });
    if (res?.ok) {
      message.value = res.message
        ? `สั่งพิมพ์แล้ว · ${res.message}`
        : "สั่งพิมพ์แล้ว — ดูที่เครื่องพิมพ์";
    } else {
      error.value = res?.message || "พิมพ์ทดสอบไม่สำเร็จ";
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : "พิมพ์ทดสอบไม่สำเร็จ";
  } finally {
    testingPrint.value = false;
  }
}

async function openAdmin() {
  error.value = "";
  const url = (adminUrl.value.trim() || getAdminUrl()).replace(/\/$/, "");
  if (!url) {
    error.value = "ยังไม่มี URL Admin";
    return;
  }
  try {
    await savePosNetworkConfig({
      apiBase: apiBase.value || getApiBase(),
      adminUrl: url,
    });
  } catch {
    /* เปิดลิงก์ได้แม้ยังไม่บันทึกสำเร็จ */
  }
  const res = await window.apPos?.openExternal?.(url);
  if (res && !res.ok) {
    error.value = res.message || "เปิด Admin ไม่สำเร็จ";
  }
}

function resetDefault() {
  apiBase.value = getDefaultApiBase();
  adminUrl.value = "";
  paperWidth.value = "58mm";
  autoPrint.value = true;
  silent.value = true;
  openDrawer.value = true;
  headerText.value = "เอพี หมูสด ({สาขา})\nมาตรฐาน สะอาด ปลอดภัย";
  footerHours.value = "เปิดบริการทุกวัน 09.00 - 20.00 น.";
  footerPhones.value = "ติดต่อ 084 912 3509, 092 494 5442";
  const hit = printers.value.find((p) => /xp-?58/i.test(p.name));
  printerName.value = hit?.name ?? "XP-58C";
  message.value = "โหลดค่าเริ่มต้นแล้ว — กดบันทึกเพื่อใช้";
}

function close() {
  open.value = false;
}

function onKey(e: KeyboardEvent) {
  if (!open.value) return;
  if (e.key === "Escape") {
    e.preventDefault();
    e.stopPropagation();
    close();
  }
}

onMounted(() => window.addEventListener("keydown", onKey, true));
onUnmounted(() => window.removeEventListener("keydown", onKey, true));
</script>

<template>
  <div v-if="open" class="pay-overlay" @click.self="close">
    <div
      class="pay-modal pos-config-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pos-config-title"
    >
      <header class="pay-head">
        <div>
          <h2 id="pos-config-title">ตั้งค่าเครื่อง POS</h2>
          <p class="pos-config-note">เครือข่าย · เครื่องพิมพ์ · ข้อความสลิป</p>
        </div>
        <button type="button" class="pay-x" aria-label="ปิด" @click="close">
          ×
        </button>
      </header>

      <nav class="pos-config-tabs" aria-label="หมวดตั้งค่า">
        <button
          type="button"
          class="pos-config-tab"
          :class="{ active: tab === 'network' }"
          @click="tab = 'network'"
        >
          เครือข่าย
        </button>
        <button
          type="button"
          class="pos-config-tab"
          :class="{ active: tab === 'printer' }"
          @click="tab = 'printer'"
        >
          เครื่องพิมพ์
        </button>
        <button
          type="button"
          class="pos-config-tab"
          :class="{ active: tab === 'slip' }"
          @click="tab = 'slip'"
        >
          ข้อความสลิป
        </button>
      </nav>

      <div class="pos-config-panel">
        <section v-show="tab === 'network'" class="pos-config-section">
          <label class="pos-config-field">
            <span>API Base</span>
            <input
              ref="apiInput"
              v-model="apiBase"
              class="ui-input"
              type="url"
              placeholder="http://pos.chinthurakij.com:8123"
              autocomplete="off"
              spellcheck="false"
            />
          </label>
          <label class="pos-config-field">
            <span>Admin URL</span>
            <input
              v-model="adminUrl"
              class="ui-input"
              type="url"
              placeholder="ว่างไว้ = เดาจาก API (พอร์ต 3100)"
              autocomplete="off"
              spellcheck="false"
            />
          </label>
          <div class="pos-config-inline-actions">
            <button
              type="button"
              class="pay-cancel"
              :disabled="testing"
              @click="testApi"
            >
              {{ testing ? "กำลังทดสอบ…" : "ทดสอบ API" }}
            </button>
            <button type="button" class="pay-cancel" @click="openAdmin">
              เปิด Admin
            </button>
          </div>
        </section>

        <section v-show="tab === 'printer'" class="pos-config-section">
          <label class="pos-config-field">
            <span>ชื่อเครื่องพิมพ์ใน Windows</span>
            <select v-model="printerName" class="ui-input">
              <option value="">อัตโนมัติ (ชอบ XP-58 / ไม่ใช้ PDF)</option>
              <option
                v-for="p in printers"
                :key="p.name"
                :value="p.name"
              >
                {{ p.name }}{{ p.isDefault ? " (default)" : "" }}
              </option>
            </select>
          </label>

          <div class="pos-config-chips">
            <span class="pos-config-chip-label">ความกว้าง</span>
            <label class="pos-config-chip">
              <input v-model="paperWidth" type="radio" value="58mm" />
              58mm
            </label>
            <label class="pos-config-chip">
              <input v-model="paperWidth" type="radio" value="80mm" />
              80mm
            </label>
          </div>

          <div class="pos-config-toggles">
            <label class="pos-config-check">
              <input v-model="autoPrint" type="checkbox" />
              พิมพ์อัตโนมัติหลังชำระ
            </label>
            <label class="pos-config-check">
              <input v-model="openDrawer" type="checkbox" />
              เตะลิ้นชักก่อนพิมพ์ (ครั้งเดียว)
            </label>
          </div>

          <div class="pos-config-inline-actions">
            <button
              type="button"
              class="pay-cancel"
              :disabled="testingPrint"
              @click="testPrint"
            >
              {{ testingPrint ? "กำลังพิมพ์…" : "ทดสอบพิมพ์" }}
            </button>
          </div>
          <p class="pos-config-hint">
            ลำดับงาน: เตะลิ้นชัก 1 ครั้ง → พิมพ์สลิป · จัดซ้าย/กลาง/ขวาเต็มความกว้าง
          </p>
        </section>

        <section v-show="tab === 'slip'" class="pos-config-section">
          <label class="pos-config-field">
            <span>หัวกระดาษ (หลายบรรทัด · ใช้ {"{สาขา}"} แทนชื่อสาขา)</span>
            <textarea
              v-model="headerText"
              class="ui-input pos-config-textarea"
              rows="4"
              placeholder="เอพี หมูสด ({สาขา})&#10;มาตรฐาน สะอาด ปลอดภัย"
              spellcheck="false"
            />
          </label>
          <label class="pos-config-field">
            <span>ท้ายสลิป — เวลาเปิดบริการ</span>
            <input
              v-model="footerHours"
              class="ui-input"
              type="text"
              autocomplete="off"
              spellcheck="false"
            />
          </label>
          <label class="pos-config-field">
            <span>ท้ายสลิป — เบอร์ติดต่อ</span>
            <input
              v-model="footerPhones"
              class="ui-input"
              type="text"
              autocomplete="off"
              spellcheck="false"
            />
          </label>
        </section>
      </div>

      <div v-if="error" class="pay-warn">{{ error }}</div>
      <div v-else-if="message" class="pos-config-ok">{{ message }}</div>

      <footer class="pos-config-actions">
        <button type="button" class="pay-cancel" @click="resetDefault">
          ค่าเริ่มต้น
        </button>
        <div class="pos-config-actions-right">
          <button type="button" class="pay-cancel" @click="close">ปิด</button>
          <button
            type="button"
            class="pay-confirm"
            :disabled="saving"
            @click="save"
          >
            {{ saving ? "กำลังบันทึก…" : "บันทึก" }}
          </button>
        </div>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.pos-config-modal {
  width: min(560px, 100%);
  max-height: min(92vh, 920px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.pos-config-note {
  margin: 0;
  font-size: 13px;
  opacity: 0.85;
}

.pos-config-tabs {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
  padding: 0 4px;
  margin-top: 4px;
}

.pos-config-tab {
  border: 1px solid #d6d3d1;
  background: #f5f5f4;
  color: #44403c;
  border-radius: 10px;
  padding: 10px 8px;
  font-weight: 700;
  font-size: 13px;
  cursor: pointer;
}

.pos-config-tab.active {
  background: #134e4a;
  border-color: #0f766e;
  color: #fff;
}

.pos-config-panel {
  flex: 1;
  min-height: 0;
  overflow: auto;
  margin-top: 12px;
  padding-right: 2px;
}

.pos-config-section {
  display: grid;
  gap: 4px;
}

.pos-config-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 10px;
  font-size: 13px;
}

.pos-config-textarea {
  resize: vertical;
  min-height: 5rem;
  font-family: inherit;
  line-height: 1.4;
}

.pos-config-chips,
.pos-config-toggles {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 14px;
  align-items: center;
  margin-top: 12px;
}

.pos-config-chip-label {
  font-size: 13px;
  font-weight: 700;
  margin-right: 4px;
}

.pos-config-chip,
.pos-config-check {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  cursor: pointer;
}

.pos-config-inline-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 14px;
}

.pos-config-hint {
  margin: 12px 0 0;
  font-size: 12px;
  opacity: 0.75;
  line-height: 1.45;
}

.pos-config-ok {
  margin-top: 12px;
  color: #166534;
  font-size: 13px;
}

.pos-config-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: space-between;
  align-items: center;
  margin-top: 14px;
  padding-top: 10px;
  border-top: 1px solid #e7e5e4;
}

.pos-config-actions-right {
  display: flex;
  gap: 8px;
}
</style>
