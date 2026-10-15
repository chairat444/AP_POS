<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import {
  loadPrinterConfig,
  printReceipt,
  savePrinterConfig,
  type PaperWidth,
  type PrinterConfig,
} from "../services/receipt";
import {
  countPendingLocalSales,
  clearTestLocalData,
  envMode,
  fetchShiftFromServer,
  getAdminUrl,
  getApiBase,
  getDefaultApiBase,
  isTestMode,
  listLocalSaleSyncItems,
  listOutboxItems,
  pendingOutboxCount,
  pushAllPendingOutbox,
  pushPendingSales,
  refreshApiOnline,
  resyncShiftFull,
  savePosEnvMode,
  savePosNetworkConfig,
  type LocalSaleSyncItem,
  type OutboxItemSummary,
  type ShiftServerSnapshot,
  type SyncedShiftPayload,
} from "../services/sync";
import { useSessionStore } from "../stores/session";
import { useSettingsStore } from "../stores/settings";
import { getAppVersionLabel } from "../utils/format";

const open = defineModel<boolean>("open", { default: false });
const emit = defineEmits<{ saved: []; "test-reset": [] }>();

const session = useSessionStore();

type TabId = "network" | "printer" | "slip" | "sync";

const tab = ref<TabId>("network");
const apiBase = ref("");
const adminUrl = ref("");
const envModeDraft = ref<"prod" | "test">("prod");
const clearingTest = ref(false);
const saving = ref(false);
const testing = ref(false);
const testingPrint = ref(false);
const syncing = ref(false);
const resyncingShift = ref(false);
const error = ref("");
const message = ref("");
const apiInput = ref<HTMLInputElement | null>(null);
const outboxItems = ref<OutboxItemSummary[]>([]);
const outboxLoading = ref(false);
const apiReachable = ref<boolean | null>(null);
const serverShift = ref<ShiftServerSnapshot | null>(null);
const syncStep = ref("");
const localSales = ref<LocalSaleSyncItem[]>([]);
const pendingSalesCount = ref(0);
const pushingPendingSales = ref(false);

const shiftPreview = computed(() => session.getOpenShiftSyncPreview());

const outboxCounts = computed(() => {
  const c = { sale: 0, shift: 0, audit: 0, total: 0 };
  for (const item of outboxItems.value) {
    c[item.type] += 1;
    c.total += 1;
  }
  return c;
});

const hasShiftOutbox = computed(() =>
  outboxItems.value.some((i) => i.type === "shift"),
);

const canResyncShift = computed(
  () => Boolean(shiftPreview.value) || hasShiftOutbox.value,
);

/** สถานะรอบบนเซิร์ฟ vs เครื่อง */
const shiftSyncStatus = computed(() => {
  if (!shiftPreview.value) {
    if (hasShiftOutbox.value) {
      return {
        tone: "warn" as const,
        title: "รอบค้างส่ง",
        hint: "มีรอบใน outbox แต่ไม่มีรอบเปิดในแอป",
      };
    }
    return {
      tone: "muted" as const,
      title: "ไม่มีรอบเปิดอยู่",
      hint: "เปิดรอบก่อนจึงจะส่งได้",
    };
  }
  const local = shiftPreview.value;
  if (apiReachable.value === false) {
    return {
      tone: "bad" as const,
      title: "API ไม่ตอบ",
      hint: "ตรวจเครือข่าย / URL ในแท็บเครือข่าย",
    };
  }
  if (!serverShift.value?.found) {
    return {
      tone: "bad" as const,
      title: "รอบยังไม่ขึ้นเซิร์ฟ",
      hint: hasShiftOutbox.value
        ? "ค้างใน outbox — กดส่งรอบซ้ำ"
        : "outbox ว่าง — กดส่งรอบซ้ำเพื่ออัปเดตเซิร์ฟ",
    };
  }
  const cashOk =
    Math.abs((serverShift.value.openCash ?? 0) - local.openCash) < 0.01;
  const billsOk =
    (serverShift.value.billCount ?? 0) >= local.billCount;
  if (cashOk && billsOk) {
    return {
      tone: "ok" as const,
      title: "รอบตรงกับเซิร์ฟแล้ว",
      hint: `ทอน ${(serverShift.value.openCash ?? 0).toFixed(0)} · ${serverShift.value.billCount ?? 0} บิลบนเซิร์ฟ`,
    };
  }
  return {
    tone: "warn" as const,
    title: "รอบบนเซิร์ฟไม่ตรง",
    hint: `เซิร์ฟ: ทอน ${(serverShift.value.openCash ?? 0).toFixed(0)} · ${serverShift.value.billCount ?? 0} บิล — กดส่งซ้ำ`,
  };
});

async function loadSyncStatus() {
  outboxLoading.value = true;
  syncStep.value = "";
  try {
    apiReachable.value = await refreshApiOnline({
      attempts: 2,
      timeoutMs: 900,
    });
    await refreshOutbox();
    await refreshLocalSales();
    if (shiftPreview.value?.shiftId) {
      serverShift.value = await fetchShiftFromServer(
        shiftPreview.value.shiftId,
      );
    } else {
      serverShift.value = null;
    }
  } finally {
    outboxLoading.value = false;
  }
}

async function refreshOutbox() {
  try {
    outboxItems.value = await listOutboxItems();
  } catch {
    outboxItems.value = [];
  }
}

async function refreshLocalSales() {
  try {
    localSales.value = await listLocalSaleSyncItems({ limit: 60 });
    pendingSalesCount.value = await countPendingLocalSales();
  } catch {
    localSales.value = [];
    pendingSalesCount.value = 0;
  }
}

function formatOutboxTime(iso: string) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("th-TH", {
      hour: "2-digit",
      minute: "2-digit",
      day: "numeric",
      month: "short",
    });
  } catch {
    return iso;
  }
}

function outboxTypeLabel(type: OutboxItemSummary["type"]) {
  if (type === "sale") return "บิล";
  if (type === "shift") return "รอบ";
  return "ยกเลิก";
}

async function pushAllOutbox() {
  if (syncing.value) return;
  if (isTestMode()) {
    error.value = "โหมดทดสอบ — ไม่ส่งข้อมูลขึ้นเซิร์ฟเวอร์";
    return;
  }
  syncing.value = true;
  error.value = "";
  message.value = "";
  tab.value = "sync";
  try {
    const r = await pushAllPendingOutbox();
    await loadSyncStatus();
    message.value = r.ok
      ? `ส่งครบแล้ว (${r.accepted} รายการ)`
      : `ยังค้าง ${r.pending} รายการ — ตรวจ API / เน็ต`;
    if (!r.ok) error.value = message.value;
  } catch (e) {
    error.value = e instanceof Error ? e.message : "ส่งไม่สำเร็จ";
  } finally {
    syncing.value = false;
  }
}

async function pushPendingBills() {
  if (pushingPendingSales.value) return;
  if (isTestMode()) {
    error.value = "โหมดทดสอบ — ไม่ส่งบิลขึ้นเซิร์ฟเวอร์";
    return;
  }
  pushingPendingSales.value = true;
  error.value = "";
  message.value = "";
  tab.value = "sync";
  try {
    const r = await pushPendingSales({ timeoutMs: 45_000 });
    await loadSyncStatus();
    if (r.pending === 0) {
      message.value =
        r.accepted > 0
          ? `ส่งบิลค้างครบแล้ว (${r.accepted} รายการ)`
          : "ไม่มีบิลค้างส่ง";
    } else {
      message.value = `ส่งได้ ${r.accepted} · ยังค้าง ${r.pending} — ดูข้อความแดงใต้บิล`;
      error.value = message.value;
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : "ส่งบิลค้างไม่สำเร็จ";
  } finally {
    pushingPendingSales.value = false;
  }
}

async function resyncShift() {
  if (resyncingShift.value) return;
  if (isTestMode()) {
    error.value = "โหมดทดสอบ — ไม่ส่งรอบขึ้นเซิร์ฟเวอร์";
    return;
  }
  resyncingShift.value = true;
  error.value = "";
  message.value = "";
  tab.value = "sync";
  try {
    syncStep.value = "เช็ค API…";
    const online = await refreshApiOnline({
      attempts: 3,
      timeoutMs: 1200,
    });
    apiReachable.value = online;
    if (!online) {
      error.value = "API ไม่ตอบ — ตรวจ URL / เน็ต / เซิร์ฟ";
      return;
    }

    syncStep.value = "เตรียมข้อมูลรอบ…";
    // รอบเปิดอยู่ → snapshot ล่าสุดเสมอ (รวมทอนที่เพิ่งนับ)
    let payload: SyncedShiftPayload | null =
      session.buildOpenShiftPayload();
    if (!payload) {
      const raw = (await window.apPos?.db?.listOutbox?.()) as
        | Array<{ type: string; payload: SyncedShiftPayload }>
        | undefined;
      payload = raw?.find((e) => e.type === "shift")?.payload ?? null;
    }
    if (!payload) {
      error.value = "ไม่มีรอบเปิดอยู่ และไม่มีรอบใน outbox";
      return;
    }

    syncStep.value = "ส่งรอบ + เงินทอน…";
    const result = await resyncShiftFull(payload);

    syncStep.value = result.verifiedOnServer
      ? "ยืนยันบนเซิร์ฟแล้ว"
      : "ส่งแล้ว · รอตรวจเซิร์ฟ…";

    if (shiftPreview.value?.shiftId) {
      serverShift.value = await fetchShiftFromServer(
        shiftPreview.value.shiftId,
      );
    }
    await refreshOutbox();

    if (result.synced && result.verifiedOnServer) {
      const parts = [
        `ส่งรอบแล้ว · ทอน ${(result.serverOpenCash ?? payload.openCash).toFixed(0)}`,
        `${result.serverBillCount ?? payload.billCount ?? 0} บิลบนเซิร์ฟ`,
      ];
      if (result.billsPushed > 0) {
        parts.push(`+ บิลค้าง ${result.billsPushed} ใบ`);
      }
      message.value = parts.join(" · ");
    } else if (result.synced) {
      message.value =
        "ส่งรอบแล้ว — ถ้ายังขึ้นแดง กดรีเฟรช หรือเช็ค Admin ว่ามีรอบแล้ว";
      error.value = message.value;
    } else {
      message.value =
        result.error || `ส่งไม่สำเร็จ · ค้าง ${result.pending} รายการ`;
      error.value = message.value;
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : "ส่งรอบไม่สำเร็จ";
  } finally {
    syncStep.value = "";
    resyncingShift.value = false;
  }
}

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
  envModeDraft.value = envMode.value === "test" ? "test" : "prod";
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
  const names = new Set(printers.value.map((p) => p.name));
  if (printerName.value.trim() && !names.has(printerName.value.trim())) {
    printerName.value = "";
    message.value =
      "เครื่องพิมพ์ที่บันทึกไม่อยู่ใน Windows — เลือกจากรายการใหม่";
  }
  if (!printerName.value.trim()) {
    const hit =
      printers.value.find((p) => /xp-?80/i.test(p.name)) ??
      printers.value.find((p) => /xp-?58/i.test(p.name)) ??
      printers.value.find((p) => /xprinter/i.test(p.name) && !/pdf/i.test(p.name));
    if (hit) printerName.value = hit.name;
  }
  void refreshOutbox();
  if (open.value) void loadSyncStatus();
}

watch(open, (v) => {
  if (!v) return;
  void hydrate().then(() => nextTick(() => apiInput.value?.focus()));
});

watch(tab, (v) => {
  if (v === "sync" && open.value) void loadSyncStatus();
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
    if (envMode.value === "test" && envModeDraft.value === "prod") {
      const pendingSales = await countPendingLocalSales().catch(() => 0);
      const pendingOut = await pendingOutboxCount().catch(() => 0);
      if (pendingSales > 0 || pendingOut > 0 || session.isOpen) {
        const ok = confirm(
          "มีข้อมูลทดสอบในเครื่อง\nจะล้างบิล/กะก่อนเปลี่ยนเป็นใช้งานจริง\nข้อมูลนี้จะไม่ถูกส่งขึ้นเซิร์ฟเวอร์",
        );
        if (!ok) {
          envModeDraft.value = "test";
          message.value = "ยังเป็นโหมดทดสอบ";
          return;
        }
        await session.abandonShiftForTestReset();
        await clearTestLocalData();
        emit("test-reset");
      }
    }
    await savePosEnvMode(envModeDraft.value);
    await savePosNetworkConfig({
      apiBase: apiBase.value,
      adminUrl: adminUrl.value,
    });
    await savePrinterConfig(printerPatch());
    const { setDrawerPrinterName } = await import("../services/drawer");
    setDrawerPrinterName(printerName.value.trim() || undefined);
    message.value =
      envModeDraft.value === "test"
        ? "บันทึกแล้ว · โหมดทดสอบ ไม่ส่งขึ้นเซิร์ฟเวอร์"
        : "บันทึกแล้ว · ใช้ค่าใหม่ทันที";
    emit("saved");
  } catch (e) {
    error.value = e instanceof Error ? e.message : "บันทึกไม่สำเร็จ";
  } finally {
    saving.value = false;
  }
}

async function clearTestData() {
  if (clearingTest.value || !isTestMode()) return;
  const ok = confirm(
    "ล้างบิลขาย กะ และ outbox ในเครื่อง?\nแต้มสมาชิกจะถูกดึงจากเซิร์ฟเวอร์ใหม่\nใช้สำหรับเริ่มทดสอบรอบใหม่",
  );
  if (!ok) return;
  clearingTest.value = true;
  error.value = "";
  message.value = "";
  try {
    await session.abandonShiftForTestReset();
    const res = await clearTestLocalData();
    message.value = res.pulled
      ? `ล้างแล้ว ${res.sales} บิล · ดึงแต้มจากเซิร์ฟเวอร์แล้ว`
      : `ล้างแล้ว ${res.sales} บิล · ดึงแต้มไม่สำเร็จ (ออฟไลน์)`;
    emit("test-reset");
    await refreshOutbox();
  } catch (e) {
    error.value = e instanceof Error ? e.message : "ล้างข้อมูลไม่สำเร็จ";
  } finally {
    clearingTest.value = false;
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
    await loadPrinters();
    const picked = printerName.value.trim();
    if (picked && !printers.value.some((p) => p.name === picked)) {
      error.value =
        "ชื่อเครื่องพิมพ์ไม่อยู่ใน Windows — เลือกจากรายการหรือติดตั้งไดรเวอร์ใหม่";
      return;
    }
    await savePrinterConfig(printerPatch());
    const appVersion = await getAppVersionLabel();
    const brand = useSettingsStore();
    const sample = {
      storeName: brand.storeName || "เอพี หมูสด",
      branchName: "ทดสอบ",
      tagline: brand.storeTagline || "มาตรฐาน สะอาด ปลอดภัย",
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
      appVersion,
      logoUrl: brand.logoUrl,
    };
    const res = await printReceipt(sample, {
      silent: silent.value,
      preview: false,
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
          <p class="pos-config-note">เครือข่าย · เครื่องพิมพ์ · สลิป · ซิงค์</p>
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
        <button
          type="button"
          class="pos-config-tab pos-config-tab-sync"
          :class="{ active: tab === 'sync' }"
          @click="tab = 'sync'"
        >
          ซิงค์
          <span
            v-if="outboxCounts.total + pendingSalesCount > 0"
            class="pos-config-tab-badge"
          >{{ outboxCounts.total + pendingSalesCount }}</span>
        </button>
      </nav>

      <div class="pos-config-panel">
        <section v-show="tab === 'network'" class="pos-config-section">
          <div class="pos-config-chips">
            <span class="pos-config-chip-label">โหมด</span>
            <label class="pos-config-chip">
              <input v-model="envModeDraft" type="radio" value="prod" />
              ใช้งานจริง
            </label>
            <label class="pos-config-chip">
              <input v-model="envModeDraft" type="radio" value="test" />
              ทดสอบ
            </label>
          </div>
          <p class="pos-config-note" style="margin: 0 0 0.75rem">
            ทั้งสองโหมดดึงสินค้า/แต้มจากเซิร์ฟเวอร์ได้ ·
            โหมดทดสอบไม่ส่งบิล กะ หรือสมาชิกขึ้นไป
          </p>
          <button
            v-if="isTestMode()"
            type="button"
            class="pay-cancel"
            :disabled="clearingTest"
            @click="clearTestData"
          >
            {{ clearingTest ? "กำลังล้าง…" : "ล้างข้อมูลทดสอบ" }}
          </button>
          <label class="pos-config-field">
            <span>API Base</span>
            <input
              ref="apiInput"
              v-model="apiBase"
              class="ui-input"
              type="url"
              placeholder="https://pos.chinthurakij.com/api"
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
              เตะลิ้นชักตอนพิมพ์สลิป (ถ้ายังไม่ได้เตะจากจบบิล)
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

        <section v-show="tab === 'sync'" class="pos-config-section">
          <div class="pos-config-sync-summary">
            <span v-if="outboxLoading">กำลังโหลด…</span>
            <span v-else-if="outboxCounts.total === 0 && pendingSalesCount === 0"
              >ไม่มีรายการค้างส่ง</span
            >
            <span v-else>
              ค้างส่ง
              <template v-if="outboxCounts.total">
                outbox {{ outboxCounts.total }}
              </template>
              <template v-if="pendingSalesCount">
                <template v-if="outboxCounts.total"> · </template>
                บิลยังไม่ส่ง {{ pendingSalesCount }}
              </template>
            </span>
            <button
              type="button"
              class="pos-config-link-btn"
              :disabled="outboxLoading"
              @click="loadSyncStatus"
            >
              รีเฟรช
            </button>
          </div>

          <div
            class="pos-config-shift-card"
            :data-tone="shiftSyncStatus.tone"
          >
            <div class="pos-config-shift-card-head">
              <strong>{{ shiftSyncStatus.title }}</strong>
              <span
                v-if="apiReachable !== null"
                class="pos-config-api-pill"
                :data-online="apiReachable"
              >
                API {{ apiReachable ? "ออนไลน์" : "ออฟไลน์" }}
              </span>
            </div>
            <p class="pos-config-shift-card-hint">
              {{ shiftSyncStatus.hint }}
            </p>
            <dl v-if="shiftPreview" class="pos-config-shift-dl">
              <div>
                <dt>พนักงาน</dt>
                <dd>{{ shiftPreview.staffName }}</dd>
              </div>
              <div>
                <dt>เงินทอน</dt>
                <dd>
                  {{ shiftPreview.openCash.toFixed(0) }}
                  <span v-if="shiftPreview.floatCounted" class="pos-config-tag"
                    >นับแล้ว</span
                  >
                  <span v-else class="pos-config-tag muted">ยังไม่นับ</span>
                </dd>
              </div>
              <div>
                <dt>บิล / ยอด</dt>
                <dd>
                  {{ shiftPreview.billCount }} บิล ·
                  {{ shiftPreview.grossTotal.toFixed(0) }}
                </dd>
              </div>
              <div>
                <dt>รหัสรอบ</dt>
                <dd class="pos-config-shift-id">
                  {{ shiftPreview.shiftId.slice(0, 18) }}…
                </dd>
              </div>
            </dl>
          </div>

          <p v-if="syncStep" class="pos-config-sync-step">{{ syncStep }}</p>

          <div class="pos-config-inline-actions">
            <button
              type="button"
              class="pay-confirm"
              :disabled="resyncingShift || !canResyncShift"
              @click="resyncShift"
            >
              {{
                resyncingShift ? "กำลังส่ง…" : "ส่งรอบ + ทอน + บิลค้าง"
              }}
            </button>
            <button
              type="button"
              class="pay-cancel"
              :disabled="
                syncing ||
                pushingPendingSales ||
                (outboxCounts.total === 0 && pendingSalesCount === 0)
              "
              @click="pushAllOutbox"
            >
              {{ syncing ? "กำลังส่ง…" : "ส่ง outbox ทั้งหมด" }}
            </button>
            <button
              type="button"
              class="pay-cancel"
              :disabled="
                pushingPendingSales || syncing || pendingSalesCount === 0
              "
              @click="pushPendingBills"
            >
              {{
                pushingPendingSales
                  ? "กำลังส่งบิล…"
                  : `ส่งบิลค้าง (${pendingSalesCount})`
              }}
            </button>
          </div>
          <p class="pos-config-hint">
            บิลเก็บในเครื่องเสมอ — ส่งแล้วจะขึ้นสถานะ «ส่งแล้ว» ไม่ลบออกจาก
            SQLite
          </p>

          <div v-if="localSales.length" class="pos-config-sales-block">
            <div class="pos-config-sales-head">
              <strong>บิลในเครื่อง</strong>
              <span v-if="pendingSalesCount" class="pos-config-tag warn"
                >ค้าง {{ pendingSalesCount }}</span
              >
            </div>
            <ul class="pos-config-outbox-list pos-config-sales-list">
              <li
                v-for="sale in localSales"
                :key="sale.id"
                class="pos-config-outbox-item"
              >
                <div class="pos-config-outbox-head">
                  <span
                    class="pos-config-sale-status"
                    :data-status="sale.status"
                  >
                    {{ sale.status === "synced" ? "ส่งแล้ว" : "ค้างส่ง" }}
                  </span>
                  <span class="pos-config-outbox-time">{{
                    formatOutboxTime(sale.createdAt)
                  }}</span>
                </div>
                <div class="pos-config-outbox-label">{{ sale.billNo }}</div>
                <div class="pos-config-outbox-detail">
                  {{ sale.total.toFixed(0) }} บาท
                  <template v-if="sale.syncedAt">
                    · ส่งเมื่อ {{ formatOutboxTime(sale.syncedAt) }}
                  </template>
                </div>
              </li>
            </ul>
          </div>

          <ul v-if="outboxItems.length" class="pos-config-outbox-list">
            <li
              v-for="item in outboxItems"
              :key="item.id"
              class="pos-config-outbox-item"
            >
              <div class="pos-config-outbox-head">
                <span
                  class="pos-config-outbox-type"
                  :data-type="item.type"
                >{{ outboxTypeLabel(item.type) }}</span>
                <span class="pos-config-outbox-time">{{
                  formatOutboxTime(item.createdAt)
                }}</span>
              </div>
              <div class="pos-config-outbox-label">{{ item.label }}</div>
              <div class="pos-config-outbox-detail">{{ item.detail }}</div>
              <div
                v-if="item.lastError"
                class="pos-config-outbox-error"
              >
                {{ item.lastError }}
              </div>
            </li>
          </ul>
          <p v-else-if="!outboxLoading && !localSales.length" class="pos-config-hint">
            บิล / รอบ / ยกเลิกที่ยังไม่ถึงเซิร์ฟจะแสดงที่นี่
          </p>
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
  grid-template-columns: repeat(4, 1fr);
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

.pos-config-tab-sync {
  position: relative;
}

.pos-config-tab-badge {
  display: inline-flex;
  min-width: 1.1rem;
  height: 1.1rem;
  align-items: center;
  justify-content: center;
  margin-left: 4px;
  padding: 0 4px;
  border-radius: 999px;
  background: #dc2626;
  color: #fff;
  font-size: 10px;
  font-weight: 800;
  line-height: 1;
}

.pos-config-tab.active .pos-config-tab-badge {
  background: #fef2f2;
  color: #b91c1c;
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

.pos-config-sync-summary {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 13px;
  font-weight: 700;
  margin-top: 4px;
}

.pos-config-sync-live {
  margin-top: 10px;
  padding: 10px 12px;
  border-radius: 10px;
  background: #ecfdf5;
  border: 1px solid #a7f3d0;
  font-size: 13px;
  color: #065f46;
}

.pos-config-shift-card {
  margin-top: 12px;
  padding: 12px 14px;
  border-radius: 12px;
  border: 1px solid #e7e5e4;
  background: #fafaf9;
}

.pos-config-shift-card[data-tone="ok"] {
  border-color: #6ee7b7;
  background: #ecfdf5;
}

.pos-config-shift-card[data-tone="warn"] {
  border-color: #fcd34d;
  background: #fffbeb;
}

.pos-config-shift-card[data-tone="bad"] {
  border-color: #fca5a5;
  background: #fef2f2;
}

.pos-config-shift-card-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.pos-config-shift-card-hint {
  margin: 6px 0 0;
  font-size: 12px;
  opacity: 0.85;
  line-height: 1.45;
}

.pos-config-shift-dl {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px 12px;
  margin: 12px 0 0;
  font-size: 12px;
}

.pos-config-shift-dl dt {
  opacity: 0.65;
  font-weight: 600;
}

.pos-config-shift-dl dd {
  margin: 2px 0 0;
  font-weight: 700;
}

.pos-config-shift-id {
  font-family: ui-monospace, monospace;
  font-size: 11px;
  font-weight: 500;
}

.pos-config-tag {
  display: inline-block;
  margin-left: 4px;
  padding: 1px 6px;
  border-radius: 999px;
  background: #ccfbf1;
  color: #115e59;
  font-size: 10px;
  font-weight: 800;
}

.pos-config-tag.muted {
  background: #e7e5e4;
  color: #57534e;
}

.pos-config-api-pill {
  font-size: 11px;
  font-weight: 700;
  padding: 2px 8px;
  border-radius: 999px;
  background: #fee2e2;
  color: #991b1b;
}

.pos-config-api-pill[data-online="true"] {
  background: #d1fae5;
  color: #065f46;
}

.pos-config-sync-step {
  margin: 10px 0 0;
  font-size: 13px;
  font-weight: 700;
  color: #0f766e;
}

.pos-config-link-btn {
  border: none;
  background: none;
  color: #0f766e;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  text-decoration: underline;
  padding: 0;
}

.pos-config-outbox-list {
  list-style: none;
  margin: 14px 0 0;
  padding: 0;
  display: grid;
  gap: 8px;
  max-height: 220px;
  overflow: auto;
}

.pos-config-outbox-item {
  border: 1px solid #e7e5e4;
  border-radius: 10px;
  padding: 10px 12px;
  background: #fafaf9;
}

.pos-config-outbox-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}

.pos-config-outbox-type {
  display: inline-block;
  font-size: 11px;
  font-weight: 800;
  padding: 2px 8px;
  border-radius: 999px;
  background: #e7e5e4;
  color: #44403c;
}

.pos-config-outbox-type[data-type="shift"] {
  background: #ccfbf1;
  color: #115e59;
}

.pos-config-outbox-type[data-type="sale"] {
  background: #fef3c7;
  color: #92400e;
}

.pos-config-outbox-type[data-type="audit"] {
  background: #fee2e2;
  color: #991b1b;
}

.pos-config-outbox-time {
  font-size: 11px;
  opacity: 0.7;
}

.pos-config-outbox-label {
  font-size: 14px;
  font-weight: 700;
}

.pos-config-outbox-detail {
  font-size: 12px;
  opacity: 0.8;
  margin-top: 2px;
}

.pos-config-outbox-error {
  margin-top: 6px;
  font-size: 11px;
  color: #b91c1c;
}

.pos-config-sales-block {
  margin-top: 12px;
}

.pos-config-sales-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
  font-size: 13px;
}

.pos-config-sales-list {
  max-height: 220px;
  overflow: auto;
}

.pos-config-sale-status {
  font-size: 11px;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 4px;
  background: #fef3c7;
  color: #92400e;
}

.pos-config-sale-status[data-status="synced"] {
  background: #dcfce7;
  color: #166534;
}

.pos-config-tag.warn {
  background: #fef3c7;
  color: #92400e;
}
</style>
