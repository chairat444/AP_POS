import { defineStore } from "pinia";
import { computed, ref } from "vue";
import {
  calcDailyCommission,
  type CommissionResult,
} from "@ap-pos/shared";
import { DEMO_STAFF, type StaffUser } from "../data/demo-staff";
import type { DenomCount } from "../data/cash-denoms";
import { sumDenomCounts } from "../data/cash-denoms";
import {
  claimThisTerminal,
  checkStaffOpenOnOtherTerminal,
  enqueueAuditAndSync,
  enqueueShift,
  enqueueShiftAndSync,
  fetchStaffDayPriorSales,
  getDeviceConfig,
  isApiOfflineKnown,
  isTestMode,
  loadStaffDirectory,
  markDeviceSetupDone,
  pendingOutboxCount,
  setDeviceBranch,
  setDeviceTerminal,
  syncPushOutbox,
  type SyncBranch,
  type SyncStaff,
  type SyncedShiftPayload,
} from "../services/sync";
import type { PaymentMethod } from "./cart";
import { useSettingsStore } from "./settings";

let cachedDevice: {
  branchId: string;
  branchName: string;
  terminalId: string;
  terminalName?: string;
  setupDone?: boolean;
} = {
  branchId: "branch-002",
  branchName: "สาขาเจ็ดเสมียน",
  terminalId: "terminal-dev",
  terminalName: "เครื่อง POS",
  setupDone: false,
};

void getDeviceConfig().then((d) => {
  cachedDevice = d;
});

function deviceSync() {
  return cachedDevice;
}

function branchCodeOf(device: { branchId: string; branchName?: string }) {
  const raw = device.branchId.replace(/^branch-/i, "");
  return raw.toUpperCase() || "001";
}

export type ShiftSale = {
  id: string;
  billNo: string;
  at: string;
  total: number;
  payments: { method: PaymentMethod; amount: number }[];
  cashTendered: number;
  change: number;
  pointsRedeemed: number;
  pointsEarned: number;
  memberName: string;
};

export type AuditEvent = {
  id: string;
  at: string;
  staffId: string;
  staffName: string;
  type: "line_void" | "bill_cancel";
  barcode?: string;
  productName?: string;
  qty?: number;
  amount: number;
  billTotalBefore: number;
  itemCountBefore: number;
};

export type CashMove = {
  id: string;
  at: string;
  staffId: string;
  staffName: string;
  direction: "in" | "out";
  amount: number;
  reason: string;
  note: string;
};

export type CashCountRecord = {
  id: string;
  at: string;
  staffId: string;
  staffName: string;
  purpose: "float" | "close";
  total: number;
  denoms: DenomCount[];
};

export type ShiftSummary = {
  billCount: number;
  grossTotal: number;
  byMethod: Record<PaymentMethod, number>;
  cashTendered: number;
  cashChange: number;
  cashInTotal: number;
  cashOutTotal: number;
  expectedCash: number;
  pointsRedeemed: number;
  pointsEarned: number;
  voidLineCount: number;
  voidLineAmount: number;
  voidBillCount: number;
  voidBillAmount: number;
  floatCounted: boolean;
};

const ACTIVE_SHIFT_KEY = "active-shift-session";

function bangkokDayKey(d = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/** YYMMDD ตามโซนไทย — ใช้ในเลขบิล */
function bangkokBillDayToken(d = new Date()) {
  return bangkokDayKey(d).slice(2).replace(/-/g, "");
}

function billSeqMetaKey(day = bangkokDayKey()) {
  return `bill-seq-${day}`;
}

async function loadDayBillSeq(day = bangkokDayKey()): Promise<number> {
  if (!window.apPos?.db?.getMeta) return 0;
  const raw = await window.apPos.db.getMeta(billSeqMetaKey(day));
  const n = Number(raw ?? 0);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

async function saveDayBillSeq(seq: number, day = bangkokDayKey()) {
  if (!window.apPos?.db?.setMeta) return;
  await window.apPos.db.setMeta(billSeqMetaKey(day), String(Math.max(0, Math.floor(seq))));
}

type PersistedShiftSession = {
  version: 1;
  branchId: string;
  terminalId: string;
  staff: {
    id: string;
    code: string;
    name: string;
    commissionEnabled?: boolean;
    commissionStartSales?: number;
    commissionStepSales?: number;
    commissionPerStep?: number;
  };
  shiftId: string;
  openedAt: string;
  openCash: number;
  floatCounted: boolean;
  floatDenoms: DenomCount[];
  sales: ShiftSale[];
  audits: AuditEvent[];
  cashMoves: CashMove[];
  cashCounts: CashCountRecord[];
  billSeq: number;
};

async function persistActiveSession(snapshot: {
  staff: StaffUser;
  shiftId: string;
  openedAt: string;
  openCash: number;
  floatCounted: boolean;
  floatDenoms: DenomCount[];
  sales: ShiftSale[];
  audits: AuditEvent[];
  cashMoves: CashMove[];
  cashCounts: CashCountRecord[];
  billSeq: number;
}) {
  if (!window.apPos?.db?.setMeta) return;
  const dev = deviceSync();
  const payload: PersistedShiftSession = {
    version: 1,
    branchId: dev.branchId,
    terminalId: dev.terminalId,
    staff: {
      id: snapshot.staff.id,
      code: snapshot.staff.code,
      name: snapshot.staff.name,
      commissionEnabled: snapshot.staff.commissionEnabled,
      commissionStartSales: snapshot.staff.commissionStartSales,
      commissionStepSales: snapshot.staff.commissionStepSales,
      commissionPerStep: snapshot.staff.commissionPerStep,
    },
    shiftId: snapshot.shiftId,
    openedAt: snapshot.openedAt,
    openCash: snapshot.openCash,
    floatCounted: snapshot.floatCounted,
    floatDenoms: snapshot.floatDenoms.map((d) => ({ ...d })),
    sales: snapshot.sales.map((s) => ({ ...s, payments: [...s.payments] })),
    audits: snapshot.audits.map((a) => ({ ...a })),
    cashMoves: snapshot.cashMoves.map((m) => ({ ...m })),
    cashCounts: snapshot.cashCounts.map((c) => ({
      ...c,
      denoms: c.denoms.map((d) => ({ ...d })),
    })),
    billSeq: snapshot.billSeq,
  };
  await window.apPos.db.setMeta(ACTIVE_SHIFT_KEY, JSON.stringify(payload));
}

function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function sessionSnapshotFromStore(state: {
  staff: StaffUser | null;
  shiftId: string | null;
  openedAt: string | null;
  openCash: number;
  floatCounted: boolean;
  floatDenoms: DenomCount[];
  sales: ShiftSale[];
  audits: AuditEvent[];
  cashMoves: CashMove[];
  cashCounts: CashCountRecord[];
  billSeq: number;
}) {
  if (!state.staff || !state.shiftId || !state.openedAt) return null;
  return {
    staff: state.staff,
    shiftId: state.shiftId,
    openedAt: state.openedAt,
    openCash: state.openCash,
    floatCounted: state.floatCounted,
    floatDenoms: state.floatDenoms,
    sales: state.sales,
    audits: state.audits,
    cashMoves: state.cashMoves,
    cashCounts: state.cashCounts,
    billSeq: state.billSeq,
  };
}

async function snapshotAndPersist(state: Parameters<typeof sessionSnapshotFromStore>[0]) {
  const snap = sessionSnapshotFromStore(state);
  if (snap) await persistActiveSession(snap);
}

async function clearActiveSession() {
  if (!window.apPos?.db?.setMeta) return;
  await window.apPos.db.setMeta(ACTIVE_SHIFT_KEY, "");
}

function staffFromPersisted(
  saved: PersistedShiftSession["staff"],
  directory: SyncStaff[],
): StaffUser | null {
  const found =
    directory.find((s) => s.id === saved.id) ??
    directory.find((s) => s.code === saved.code) ??
    DEMO_STAFF.find((s) => s.id === saved.id || s.code === saved.code);
  if (!found) return null;
  return {
    id: found.id,
    code: found.code,
    name: found.name,
    pin: found.pin,
    commissionEnabled: Boolean(
      saved.commissionEnabled ?? found.commissionEnabled,
    ),
    commissionStartSales:
      saved.commissionStartSales ?? found.commissionStartSales,
    commissionStepSales: saved.commissionStepSales ?? found.commissionStepSales,
    commissionPerStep: saved.commissionPerStep ?? found.commissionPerStep,
  };
}

function storeStateRefs(store: {
  staff: { value: StaffUser | null };
  shiftId: { value: string | null };
  openedAt: { value: string | null };
  openCash: { value: number };
  floatCounted: { value: boolean };
  floatDenoms: { value: DenomCount[] };
  sales: { value: ShiftSale[] };
  audits: { value: AuditEvent[] };
  cashMoves: { value: CashMove[] };
  cashCounts: { value: CashCountRecord[] };
  billSeq: { value: number };
}) {
  return {
    staff: store.staff.value,
    shiftId: store.shiftId.value,
    openedAt: store.openedAt.value,
    openCash: store.openCash.value,
    floatCounted: store.floatCounted.value,
    floatDenoms: store.floatDenoms.value,
    sales: store.sales.value,
    audits: store.audits.value,
    cashMoves: store.cashMoves.value,
    cashCounts: store.cashCounts.value,
    billSeq: store.billSeq.value,
  };
}


function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export const useSessionStore = defineStore("session", () => {
  const staff = ref<StaffUser | null>(null);
  const shiftId = ref<string | null>(null);
  const openedAt = ref<string | null>(null);
  const openCash = ref(0);
  /** นับเงินทอนเริ่มรอบแล้วหรือยัง (เปิดรอบไปขายนับทีหลังได้) */
  const floatCounted = ref(false);
  /** จำนวนใบ/เหรียญล่าสุดของเงินทอนเริ่มรอบ — เปิดแก้ในรอบเดิมได้ */
  const floatDenoms = ref<DenomCount[]>([]);
  const sales = ref<ShiftSale[]>([]);
  const audits = ref<AuditEvent[]>([]);
  const cashMoves = ref<CashMove[]>([]);
  const cashCounts = ref<CashCountRecord[]>([]);
  const billSeq = ref(0);
  const statusMessage = ref("");
  const staffDirectory = ref<SyncStaff[]>(
    DEMO_STAFF.map((s) => ({
      id: s.id,
      code: s.code,
      name: s.name,
      pin: s.pin,
    })),
  );
  const device = ref(cachedDevice);
  /** ปิดรอบแล้วกำลังออกจากแอป — ห้ามโชว์หน้าล็อกอิน */
  const exiting = ref(false);

  const isOpen = computed(() => Boolean(staff.value && shiftId.value));

  const summary = computed<ShiftSummary>(() => {
    const byMethod: Record<PaymentMethod, number> = {
      cash: 0,
      transfer: 0,
      government: 0,
      points: 0,
    };
    let grossTotal = 0;
    let cashTendered = 0;
    let cashChange = 0;
    let pointsRedeemed = 0;
    let pointsEarned = 0;

    for (const s of sales.value) {
      grossTotal += s.total;
      cashTendered += s.cashTendered;
      cashChange += s.change;
      pointsRedeemed += s.pointsRedeemed;
      pointsEarned += s.pointsEarned;
      for (const p of s.payments) {
        byMethod[p.method] += p.amount;
      }
    }

    let voidLineCount = 0;
    let voidLineAmount = 0;
    let voidBillCount = 0;
    let voidBillAmount = 0;
    for (const a of audits.value) {
      if (a.type === "line_void") {
        voidLineCount += 1;
        voidLineAmount += a.amount;
      } else {
        voidBillCount += 1;
        voidBillAmount += a.amount;
      }
    }

    let cashInTotal = 0;
    let cashOutTotal = 0;
    for (const m of cashMoves.value) {
      if (m.direction === "in") cashInTotal += m.amount;
      else cashOutTotal += m.amount;
    }

    // เงินในลิ้นชักที่ควรมี = เงินทอนเริ่ม + ขายเงินสด + นำเข้า − นำออก
    const expectedCash = round2(
      openCash.value + byMethod.cash + cashInTotal - cashOutTotal,
    );

    return {
      billCount: sales.value.length,
      grossTotal: round2(grossTotal),
      byMethod: {
        cash: round2(byMethod.cash),
        transfer: round2(byMethod.transfer),
        government: round2(byMethod.government),
        points: round2(byMethod.points),
      },
      cashTendered: round2(cashTendered),
      cashChange: round2(cashChange),
      cashInTotal: round2(cashInTotal),
      cashOutTotal: round2(cashOutTotal),
      expectedCash,
      pointsRedeemed,
      pointsEarned,
      voidLineCount,
      voidLineAmount: round2(voidLineAmount),
      voidBillCount,
      voidBillAmount: round2(voidBillAmount),
      floatCounted: floatCounted.value,
    };
  });

  function nextBillNo() {
    const d = deviceSync();
    billSeq.value += 1;
    const n = String(billSeq.value).padStart(6, "0");
    const day = bangkokBillDayToken();
    void saveDayBillSeq(billSeq.value);
    return `S${day}-${branchCodeOf(d)}-${n}`;
  }

  function previewBillNo() {
    const d = deviceSync();
    const n = String(billSeq.value + 1).padStart(6, "0");
    const day = bangkokBillDayToken();
    return `S${day}-${branchCodeOf(d)}-${n}`;
  }

  async function refreshStaffDirectory() {
    staffDirectory.value = await loadStaffDirectory();
    return staffDirectory.value;
  }

  async function selectBranch(branch: SyncBranch) {
    const next = await setDeviceBranch({ id: branch.id, name: branch.name });
    cachedDevice = next;
    device.value = next;
    useSettingsStore().setPromptPayId(branch.promptPayId ?? null);
    useSettingsStore().setPromptPayName(branch.promptPayName ?? null);
    return next;
  }

  async function selectTerminal(terminal: {
    id: string;
    name: string;
    setupDone?: boolean;
  }) {
    const next = await setDeviceTerminal(terminal);
    cachedDevice = next;
    device.value = next;
    return next;
  }

  async function applyDeviceConfig(next: {
    branchId: string;
    branchName: string;
    terminalId: string;
    terminalName?: string;
    setupDone?: boolean;
  }) {
    const payload = {
      branchId: next.branchId,
      branchName: next.branchName,
      terminalId: next.terminalId,
      terminalName: next.terminalName ?? "เครื่อง POS",
      setupDone: Boolean(next.setupDone),
    };
    if (window.apPos?.db?.replaceDevice) {
      const saved = await window.apPos.db.replaceDevice(payload);
      cachedDevice = saved;
      device.value = saved;
      return saved;
    }
    if (window.apPos?.db?.setDevice) {
      const saved = await window.apPos.db.setDevice(payload);
      // บังคับค่าใน memory ให้ตรงที่ต้องการ แม้ main เก่ายังไม่รองรับบางฟิลด์
      const forced = {
        ...saved,
        ...payload,
      };
      cachedDevice = forced;
      device.value = forced;
      // backup ผ่าน meta โดยตรง
      if (window.apPos.db.setMeta) {
        await window.apPos.db.setMeta(
          "device-config",
          JSON.stringify(forced),
        );
      }
      return forced;
    }
    cachedDevice = payload;
    device.value = payload;
    return payload;
  }

  async function completeDeviceSetup() {
    const next = await markDeviceSetupDone();
    cachedDevice = next;
    device.value = next;
    return next;
  }

  async function resetDeviceSetup() {
    const next = window.apPos?.db?.setDevice
      ? await window.apPos.db.setDevice({ setupDone: false })
      : { ...(await getDeviceConfig()), setupDone: false };
    cachedDevice = next;
    device.value = next;
    return next;
  }

  async function refreshDevice() {
    const d = await getDeviceConfig();
    cachedDevice = d;
    device.value = d;
    return d;
  }

  function buildShiftPayload(
    status: "open" | "closed",
    extra: Partial<SyncedShiftPayload> = {},
  ): SyncedShiftPayload | null {
    if (!shiftId.value || !staff.value || !openedAt.value) return null;
    const d = deviceSync();
    const snap = summary.value;
    return {
      id: shiftId.value,
      branchId: d.branchId,
      terminalId: d.terminalId,
      terminalName: d.terminalName ?? "เครื่อง POS",
      staffId: staff.value.id,
      staffCode: staff.value.code,
      staffName: staff.value.name,
      openedAt: openedAt.value,
      closedAt: extra.closedAt ?? null,
      openCash: openCash.value,
      closeCash: extra.closeCash ?? null,
      expectedCash: extra.expectedCash ?? snap.expectedCash,
      variance: extra.variance ?? null,
      status,
      billCount: snap.billCount,
      grossTotal: snap.grossTotal,
      closeNote: extra.closeNote ?? null,
      summary: {
        byMethod: snap.byMethod,
        cashTendered: snap.cashTendered,
        cashChange: snap.cashChange,
        cashInTotal: snap.cashInTotal,
        cashOutTotal: snap.cashOutTotal,
        pointsRedeemed: snap.pointsRedeemed,
        pointsEarned: snap.pointsEarned,
        voidLineCount: snap.voidLineCount,
        voidLineAmount: snap.voidLineAmount,
        voidBillCount: snap.voidBillCount,
        voidBillAmount: snap.voidBillAmount,
        floatCounted: snap.floatCounted,
        audits: audits.value.map((a) => ({ ...a })),
      },
      cashMoves: cashMoves.value.map((m) => ({ ...m })),
      cashCounts: cashCounts.value.map((c) => ({
        ...c,
        denoms: c.denoms.map((d) => ({ ...d })),
      })),
      ...extra,
    };
  }

  async function pushShiftSnapshot(
    status: "open" | "closed",
    extra: Partial<SyncedShiftPayload> = {},
    opts?: { urgent?: boolean; background?: boolean },
  ) {
    const payload = buildShiftPayload(status, extra);
    if (!payload) return { synced: false, pending: 0 };
    // background = เข้าคิวแล้วส่งเมื่อไหร่ก็ได้ — ไม่รอ probe/API (ใช้กับเงินเข้า-ออก/นับทอน)
    if (opts?.background) {
      return enqueueShiftAndSync(payload, { awaitIfOnline: false }).catch(
        (e) => ({
          synced: false,
          pending: -1,
          error: e instanceof Error ? e.message : "ส่งไม่สำเร็จ",
        }),
      );
    }
    // เปิด/ปิดรอบ — ออนไลน์แล้วส่งทันที
    const urgent = Boolean(opts?.urgent) || status === "closed";
    return enqueueShiftAndSync(payload, {
      awaitIfOnline: true,
      probeAttempts: urgent ? 5 : 3,
      probeTimeoutMs: urgent ? 1500 : 1000,
      pushTimeoutMs: urgent ? 15_000 : 10_000,
    }).catch((e) => ({
      synced: false,
      pending: -1,
      error: e instanceof Error ? e.message : "ส่งไม่สำเร็จ",
    }));
  }

  /** มีรอบค้างในเครื่องไหม (ยังไม่ unlock ด้วย PIN) */
  async function peekActiveSession(): Promise<{
    staffName: string;
    billCount: number;
  } | null> {
    if (!window.apPos?.db?.getMeta) return null;
    const raw = await window.apPos.db.getMeta(ACTIVE_SHIFT_KEY);
    if (!raw?.trim()) return null;
    try {
      const saved = JSON.parse(raw) as PersistedShiftSession;
      if (saved.version !== 1 || !saved.shiftId || !saved.openedAt) return null;
      const dev = deviceSync();
      if (
        saved.branchId !== dev.branchId ||
        saved.terminalId !== dev.terminalId
      ) {
        return null;
      }
      return {
        staffName: saved.staff?.name || "พนักงาน",
        billCount: Array.isArray(saved.sales) ? saved.sales.length : 0,
      };
    } catch {
      return null;
    }
  }

  /** เปิดรอบเร็ว — นับเงินทอนทีหลังได้ · พนักงานใช้ได้ทุกสาขา */
  async function loginAndOpen(
    codeOrPin: string,
    floatCash = 0,
  ): Promise<boolean> {
    const raw = codeOrPin.trim();
    const directory = staffDirectory.value.length
      ? staffDirectory.value
      : DEMO_STAFF;
    const found =
      directory.find((s) => s.pin === raw) ??
      directory.find((s) => s.code === raw);
    if (!found) {
      statusMessage.value = "รหัสพนักงานหรือ PIN ไม่ถูกต้อง";
      return false;
    }

    // มีรอบค้าง → ต้อง PIN ของพนักงานคนเดิม แล้วกลับเข้ารอบนั้น (ไม่เปิดรอบใหม่)
    if (window.apPos?.db?.getMeta) {
      const existing = await window.apPos.db.getMeta(ACTIVE_SHIFT_KEY);
      if (existing?.trim()) {
        let saved: PersistedShiftSession | null = null;
        try {
          saved = JSON.parse(existing) as PersistedShiftSession;
        } catch {
          saved = null;
        }
        if (saved?.version === 1 && saved.shiftId && saved.openedAt) {
          const sameStaff =
            saved.staff?.id === found.id || saved.staff?.code === found.code;
          if (!sameStaff) {
            statusMessage.value = `รอบค้างของ ${saved.staff?.name || "พนักงานอื่น"} — ใส่ PIN ของพนักงานคนนั้น`;
            return false;
          }
          const restored = await tryRestoreActiveSession();
          if (restored) return true;
          statusMessage.value =
            "มีรอบค้างอยู่แต่กู้คืนไม่ได้ — ติดต่อผู้ดูแลหรือปิดรอบจากเครื่องเดิม";
          return false;
        }
      }
    }

    // ออนไลน์ — ห้ามใช้ PIN ที่เปิดรอบค้างบนเครื่องอื่น
    if (!isApiOfflineKnown()) {
      const conflict = await checkStaffOpenOnOtherTerminal({
        staffId: found.id,
        staffCode: found.code,
        excludeTerminalId: deviceSync().terminalId,
      });
      if (conflict.blocked) {
        statusMessage.value =
          conflict.message || "PIN นี้เปิดรอบอยู่เครื่องอื่นแล้ว";
        return false;
      }
    }

    try {
      const claimed = await claimThisTerminal({
        id: deviceSync().terminalId,
        branchId: deviceSync().branchId,
      });
      if (!claimed.ok) {
        statusMessage.value = claimed.message;
        exiting.value = false;
        // บังคับกลับไปลงทะเบียนใหม่
        const reset = await resetDeviceSetup();
        cachedDevice = reset;
        device.value = reset;
        return false;
      }
      cachedDevice = claimed.device;
      device.value = claimed.device;
    } catch (e) {
      statusMessage.value =
        e instanceof Error ? e.message : "ยืนยันเครื่อง POS ไม่สำเร็จ";
      return false;
    }

    staff.value = {
      id: found.id,
      code: found.code,
      name: found.name,
      pin: found.pin,
      commissionEnabled: Boolean(found.commissionEnabled),
      commissionStartSales: found.commissionStartSales,
      commissionStepSales: found.commissionStepSales,
      commissionPerStep: found.commissionPerStep,
    };
    shiftId.value = uid();
    openedAt.value = new Date().toISOString();
    openCash.value = Math.max(0, floatCash);
    floatCounted.value = floatCash > 0;
    floatDenoms.value = [];
    sales.value = [];
    audits.value = [];
    cashMoves.value = [];
    cashCounts.value = [];
    // เลขบิลต่อเนื่องทั้งวันต่อสาขา/เครื่อง — ไม่รีเซ็ตตอนเปิดรอบใหม่
    billSeq.value = await loadDayBillSeq();
    const branchLabel = deviceSync().branchName || deviceSync().branchId;
    const baseMsg = floatCounted.value
      ? `เปิดรอบ: ${found.name} · ${branchLabel} · ทอนเริ่ม ${openCash.value.toFixed(0)}`
      : `เปิดรอบ: ${found.name} · ${branchLabel} · นับเงินทอนทีหลังได้`;
    statusMessage.value = `${baseMsg} · กำลังส่งเซิร์ฟ…`;
    const sync = await pushShiftSnapshot("open");
    // เซิร์ฟปฏิเสธ (PIN/พนักงานเปิดรอบเครื่องอื่น) — ยกเลิกรอบในเครื่องนี้
    const conflict =
      Boolean((sync as { conflict?: boolean }).conflict) ||
      /เปิดรอบอยู่/.test(String(sync.error || ""));
    if (sync.synced !== true && conflict) {
      staff.value = null;
      shiftId.value = null;
      openedAt.value = null;
      openCash.value = 0;
      floatCounted.value = false;
      floatDenoms.value = [];
      sales.value = [];
      audits.value = [];
      cashMoves.value = [];
      cashCounts.value = [];
      await clearActiveSession();
      statusMessage.value =
        sync.error || "PIN นี้เปิดรอบอยู่เครื่องอื่นแล้ว — ปิดรอบเครื่องนั้นก่อน";
      return false;
    }
    statusMessage.value =
      sync.synced === true
        ? `${baseMsg} · ส่งเซิร์ฟแล้ว`
        : `${baseMsg} · จะซิงค์เมื่อออนไลน์`;
    await snapshotAndPersist(
      storeStateRefs({
        staff,
        shiftId,
        openedAt,
        openCash,
        floatCounted,
        floatDenoms,
        sales,
        audits,
        cashMoves,
        cashCounts,
        billSeq,
      }),
    );
    return true;
  }

  async function tryRestoreActiveSession(): Promise<boolean> {
    if (!window.apPos?.db?.getMeta) return false;
    const raw = await window.apPos.db.getMeta(ACTIVE_SHIFT_KEY);
    if (!raw?.trim()) return false;

    let saved: PersistedShiftSession;
    try {
      saved = JSON.parse(raw) as PersistedShiftSession;
    } catch {
      await clearActiveSession();
      return false;
    }
    if (saved.version !== 1 || !saved.shiftId || !saved.openedAt) {
      await clearActiveSession();
      return false;
    }

    const dev = deviceSync();
    if (
      saved.branchId !== dev.branchId ||
      saved.terminalId !== dev.terminalId
    ) {
      return false;
    }

    try {
      const claimed = await claimThisTerminal({
        id: dev.terminalId,
        branchId: dev.branchId,
      });
      if (!claimed.ok) {
        statusMessage.value = claimed.message;
        return false;
      }
      cachedDevice = claimed.device;
      device.value = claimed.device;
    } catch (e) {
      statusMessage.value =
        e instanceof Error ? e.message : "ยืนยันเครื่อง POS ไม่สำเร็จ";
      return false;
    }

    const directory = staffDirectory.value.length
      ? staffDirectory.value
      : DEMO_STAFF;
    const restoredStaff = staffFromPersisted(saved.staff, directory);
    if (!restoredStaff) {
      statusMessage.value = "ไม่พบพนักงานของรอบค้าง — ติดต่อผู้ดูแล";
      return false;
    }

    staff.value = restoredStaff;
    shiftId.value = saved.shiftId;
    openedAt.value = saved.openedAt;
    openCash.value = saved.openCash;
    floatCounted.value = saved.floatCounted;
    floatDenoms.value = saved.floatDenoms.map((d) => ({ ...d }));
    sales.value = saved.sales.map((s) => ({ ...s, payments: [...s.payments] }));
    audits.value = saved.audits.map((a) => ({ ...a }));
    cashMoves.value = saved.cashMoves.map((m) => ({ ...m }));
    cashCounts.value = saved.cashCounts.map((c) => ({
      ...c,
      denoms: c.denoms.map((d) => ({ ...d })),
    }));
    let maxFromSales = 0;
    for (const s of sales.value) {
      const m = String(s.billNo ?? "").match(/(\d+)$/);
      if (m) maxFromSales = Math.max(maxFromSales, Number(m[1]) || 0);
    }
    billSeq.value = Math.max(
      saved.billSeq,
      maxFromSales,
      await loadDayBillSeq(),
    );
    void saveDayBillSeq(billSeq.value);
    exiting.value = false;

    const branchLabel = dev.branchName || dev.branchId;
    const floatNote = floatCounted.value
      ? ` · ทอน ${openCash.value.toFixed(0)}`
      : "";
    statusMessage.value = `กลับรอบเดิม: ${restoredStaff.name} · ${branchLabel} · ${sales.value.length} บิล${floatNote}`;
    void pushShiftSnapshot("open");
    return true;
  }

  function recordSale(input: Omit<ShiftSale, "id" | "billNo" | "at"> & { billNo?: string }) {
    const sale: ShiftSale = {
      id: uid(),
      billNo: input.billNo ?? nextBillNo(),
      at: new Date().toISOString(),
      total: input.total,
      payments: input.payments,
      cashTendered: input.cashTendered,
      change: input.change,
      pointsRedeemed: input.pointsRedeemed,
      pointsEarned: input.pointsEarned,
      memberName: input.memberName,
    };
    sales.value = [...sales.value, sale];
    void snapshotAndPersist(
      storeStateRefs({
        staff,
        shiftId,
        openedAt,
        openCash,
        floatCounted,
        floatDenoms,
        sales,
        audits,
        cashMoves,
        cashCounts,
        billSeq,
      }),
    );
    return sale;
  }

  function recordAudit(
    input: Omit<AuditEvent, "id" | "at" | "staffId" | "staffName">,
  ) {
    if (!staff.value || !shiftId.value) return null;
    const event: AuditEvent = {
      id: uid(),
      at: new Date().toISOString(),
      staffId: staff.value.id,
      staffName: staff.value.name,
      ...input,
    };
    audits.value = [...audits.value, event];

    const d = deviceSync();
    void enqueueAuditAndSync({
      id: event.id,
      shiftId: shiftId.value,
      branchId: d.branchId,
      terminalId: d.terminalId,
      staffId: event.staffId,
      staffName: event.staffName,
      type: event.type,
      at: event.at,
      barcode: event.barcode ?? null,
      productName: event.productName ?? null,
      qty: event.qty ?? null,
      amount: event.amount,
      billTotalBefore: event.billTotalBefore,
      itemCountBefore: event.itemCountBefore,
    }).catch(() => undefined);

    void snapshotAndPersist(
      storeStateRefs({
        staff,
        shiftId,
        openedAt,
        openCash,
        floatCounted,
        floatDenoms,
        sales,
        audits,
        cashMoves,
        cashCounts,
        billSeq,
      }),
    );

    return event;
  }

  async function saveFloatCount(denoms: DenomCount[]) {
    if (!staff.value) return null;
    const total = sumDenomCounts(denoms);
    openCash.value = total;
    floatCounted.value = true;
    floatDenoms.value = denoms.map((d) => ({ ...d }));
    const rec: CashCountRecord = {
      id: uid(),
      at: new Date().toISOString(),
      staffId: staff.value.id,
      staffName: staff.value.name,
      purpose: "float",
      total,
      denoms: denoms.map((d) => ({ ...d })),
    };
    cashCounts.value = [...cashCounts.value, rec];
    const base = `บันทึกเงินทอนเริ่มรอบ ${total.toFixed(0)} บาท`;
    statusMessage.value = `${base} · บันทึกในเครื่องแล้ว`;
    await snapshotAndPersist(
      storeStateRefs({
        staff,
        shiftId,
        openedAt,
        openCash,
        floatCounted,
        floatDenoms,
        sales,
        audits,
        cashMoves,
        cashCounts,
        billSeq,
      }),
    );
    // ลิ้นชักกับ sync ไม่รอกัน — sync พื้นหลังอย่างเดียว
    void pushShiftSnapshot("open", {}, { background: true }).then((sync) => {
      statusMessage.value =
        sync.synced === true
          ? `${base} · ส่งเซิร์ฟแล้ว`
          : `${base} · จะซิงค์เมื่อออนไลน์`;
    });
    return rec;
  }

  async function recordCashMove(input: {
    direction: "in" | "out";
    amount: number;
    reason: string;
    note?: string;
  }) {
    if (!staff.value) return null;
    const amount = round2(Math.max(0, input.amount));
    if (amount <= 0) {
      statusMessage.value = "ระบุจำนวนเงิน";
      return null;
    }
    const move: CashMove = {
      id: uid(),
      at: new Date().toISOString(),
      staffId: staff.value.id,
      staffName: staff.value.name,
      direction: input.direction,
      amount,
      reason: input.reason.trim() || "อื่นๆ",
      note: input.note?.trim() ?? "",
    };
    cashMoves.value = [...cashMoves.value, move];
    const base =
      input.direction === "out"
        ? `นำเงินออก ${amount.toFixed(0)} (${move.reason})`
        : `นำเงินเข้า ${amount.toFixed(0)} (${move.reason})`;
    statusMessage.value = `${base} · บันทึกในเครื่องแล้ว`;
    await snapshotAndPersist(
      storeStateRefs({
        staff,
        shiftId,
        openedAt,
        openCash,
        floatCounted,
        floatDenoms,
        sales,
        audits,
        cashMoves,
        cashCounts,
        billSeq,
      }),
    );
    // ลิ้นชักกับ sync ไม่รอกัน — sync พื้นหลังอย่างเดียว
    void pushShiftSnapshot("open", {}, { background: true }).then((sync) => {
      statusMessage.value =
        sync.synced === true
          ? `${base} · ส่งเซิร์ฟแล้ว`
          : `${base} · จะซิงค์เมื่อออนไลน์`;
    });
    return move;
  }

  function markExiting() {
    exiting.value = true;
  }

  /**
   * ค่าคอมรายวันตอนปิดรอบ = ยอดรอบปิดแล้ววันนี้ + ยอดรอบนี้
   * ออฟไลน์: ใช้แค่ยอดรอบนี้
   */
  async function getCloseCommission(): Promise<CommissionResult | null> {
    const s = staff.value;
    if (!s) return null;
    const fromDir = staffDirectory.value.find((x) => x.id === s.id);
    const enabled = Boolean(
      fromDir?.commissionEnabled ?? s.commissionEnabled,
    );
    if (!enabled) return null;
    const prior = await fetchStaffDayPriorSales(
      s.id,
      shiftId.value ?? undefined,
    );
    const daySales = round2(prior + summary.value.grossTotal);
    return calcDailyCommission(daySales, {
      enabled: true,
      startSales:
        fromDir?.commissionStartSales ?? s.commissionStartSales ?? 8000,
      stepSales: fromDir?.commissionStepSales ?? s.commissionStepSales ?? 1000,
      amountPerStep:
        fromDir?.commissionPerStep ?? s.commissionPerStep ?? 100,
    });
  }

  async function closeShift(
    closeCount?: {
      total: number;
      denoms: DenomCount[];
      note?: string;
    },
    opts?: { forceLocal?: boolean },
  ) {
    const snap = summary.value;
    const counted = closeCount?.total ?? null;
    const variance =
      counted == null ? null : round2(counted - snap.expectedCash);
    const closeNote = closeCount?.note?.trim() ?? "";
    const closedAt = new Date().toISOString();

    // กันกดส่งซ้ำแล้วโปะ purpose:close ซ้ำหลายแถว
    if (closeCount && staff.value) {
      cashCounts.value = [
        ...cashCounts.value.filter((c) => c.purpose !== "close"),
        {
          id: uid(),
          at: closedAt,
          staffId: staff.value.id,
          staffName: staff.value.name,
          purpose: "close",
          total: closeCount.total,
          denoms: closeCount.denoms.map((d) => ({ ...d })),
        },
      ];
    } else if (!closeCount) {
      cashCounts.value = cashCounts.value.filter((c) => c.purpose !== "close");
    }

    const commission = await getCloseCommission().catch(() => null);
    const payload = buildShiftPayload("closed", {
      closedAt,
      closeCash: counted,
      expectedCash: snap.expectedCash,
      variance,
      closeNote,
      billCount: snap.billCount,
      grossTotal: snap.grossTotal,
    });
    if (payload && commission) {
      const base =
        payload.summary && typeof payload.summary === "object"
          ? (payload.summary as Record<string, unknown>)
          : {};
      payload.summary = {
        ...base,
        commission: {
          daySales: commission.daySales,
          amount: commission.amount,
          steps: commission.steps,
          startSales: commission.startSales,
          stepSales: commission.stepSales,
          amountPerStep: commission.amountPerStep,
        },
      };
    }

    const closedBase = {
      staffName: staff.value?.name ?? "-",
      openedAt: openedAt.value,
      closedAt,
      openCash: openCash.value,
      closeCash: counted,
      variance,
      closeNote,
      cashMoves: cashMoves.value.map((m) => ({ ...m })),
      cashCounts: cashCounts.value.map((c) => ({ ...c })),
      audits: audits.value.map((a) => ({ ...a })),
      commission,
      ...snap,
    };

    // ส่งเซิร์ฟ+Discord ก่อนเคลียร์จอ — ปิดคอมหลัง ACK เท่านั้น
    let sync: { synced: boolean; pending: number; error?: string } = {
      synced: false,
      pending: 0,
    };
    if (payload) {
      sync = await enqueueShiftAndSync(payload, {
        awaitIfOnline: true,
        probeAttempts: 5,
        probeTimeoutMs: 1500,
        pushTimeoutMs: 15_000,
      }).catch((e) => ({
        synced: false,
        pending: -1,
        error: e instanceof Error ? e.message : "ส่งเซิร์ฟไม่สำเร็จ",
      }));
    }

    if (!sync.synced && !opts?.forceLocal) {
      // enqueueShift ใส่ closed ไปแล้ว — ต้องดึงกลับเป็น open ทันที
      // ไม่งั้น sync พื้นหลัง/บิลถัดไปจะปิดรอบบนเซิร์ฟทั้งที่จอยังเปิด
      await requeueOpenShiftToOutbox().catch(() => undefined);
      statusMessage.value =
        `ปิดรอบยังส่งเซิร์ฟไม่สำเร็จ${sync.error ? ` · ${sync.error}` : ""} · กดส่งอีกครั้ง อย่าปิดเครื่อง`;
      return { ...closedBase, synced: false as const, cleared: false as const };
    }

    // หลังปิดรอบติดเซิร์ฟแล้ว ดันบิลค้างใน outbox ให้ทันก่อนปิดเครื่อง
    if (sync.synced && !isTestMode()) {
      await syncPushOutbox({ force: true, timeoutMs: 12_000 }).catch(
        () => undefined,
      );
    }

    staff.value = null;
    shiftId.value = null;
    openedAt.value = null;
    openCash.value = 0;
    floatCounted.value = false;
    floatDenoms.value = [];
    sales.value = [];
    audits.value = [];
    cashMoves.value = [];
    cashCounts.value = [];
    void saveDayBillSeq(billSeq.value);
    billSeq.value = await loadDayBillSeq();
    await clearActiveSession();

    statusMessage.value =
      (variance == null
        ? "ปิดรอบเรียบร้อย"
        : `ปิดรอบแล้ว · นับได้ ${counted?.toFixed(0)} ต่าง ${variance >= 0 ? "+" : ""}${variance.toFixed(0)}${closeNote ? ` · ${closeNote}` : ""}`) +
      (isTestMode()
        ? " · โหมดทดสอบ ไม่ส่งขึ้นเซิร์ฟเวอร์"
        : sync.synced
          ? " · ส่งเซิร์ฟแล้ว"
          : " · บันทึกในเครื่อง (ยังไม่ถึงเซิร์ฟ)");
    try {
      if (window.apPos?.db?.purgeSyncedSales) {
        await window.apPos.db.purgeSyncedSales();
      }
    } catch {
      // ignore
    }
    return { ...closedBase, synced: sync.synced, cleared: true as const };
  }

  /** ยกเลิกหน้าปิดรอบหลังส่งไม่สำเร็จ — เอาแถวนับปิดที่ค้างออก */
  function rollbackCloseCashCounts() {
    cashCounts.value = cashCounts.value.filter((c) => c.purpose !== "close");
  }

  /**
   * แทนที่ outbox shift ที่อาจเป็น closed ด้วย snapshot เปิดอยู่
   * (ใช้หลังปิดรอบไม่สำเร็จ / ยกเลิก modal)
   */
  async function requeueOpenShiftToOutbox() {
    const payload = buildShiftPayload("open", {
      closedAt: null,
      closeCash: null,
      variance: null,
      closeNote: null,
    });
    if (!payload) return;
    payload.cashCounts = (payload.cashCounts ?? []).filter(
      (c) => (c as { purpose?: string }).purpose !== "close",
    );
    await enqueueShift(payload);
  }

  /** ส่ง snapshot รอบเปิดอยู่ (รวมเงินทอน) ขึ้นเซิร์ฟซ้ำ — ใช้จากหน้าตั้งค่า */
  async function resyncOpenShift() {
    if (!isOpen.value) {
      return {
        synced: false,
        pending: await pendingOutboxCount().catch(() => 0),
        error: "ไม่มีรอบเปิดอยู่",
      };
    }
    return pushShiftSnapshot("open", {}, { urgent: true });
  }

  /** snapshot รอบเปิดอยู่ล่าสุด — สำหรับส่งซ้ำ/แสดงใน UI */
  function buildOpenShiftPayload(): SyncedShiftPayload | null {
    return buildShiftPayload("open");
  }

  async function abandonShiftForTestReset() {
    staff.value = null;
    shiftId.value = null;
    openedAt.value = null;
    openCash.value = 0;
    floatCounted.value = false;
    floatDenoms.value = [];
    sales.value = [];
    audits.value = [];
    cashMoves.value = [];
    cashCounts.value = [];
    billSeq.value = 0;
    await clearActiveSession();
    statusMessage.value = "ล้างรอบทดสอบแล้ว";
  }

  function getOpenShiftSyncPreview() {
    if (!isOpen.value || !staff.value || !shiftId.value) return null;
    const snap = summary.value;
    return {
      shiftId: shiftId.value,
      staffName: staff.value.name,
      openCash: openCash.value,
      floatCounted: floatCounted.value,
      billCount: snap.billCount,
      grossTotal: snap.grossTotal,
      openedAt: openedAt.value,
    };
  }

  return {
    staff,
    shiftId,
    openedAt,
    openCash,
    floatCounted,
    floatDenoms,
    sales,
    audits,
    cashMoves,
    cashCounts,
    isOpen,
    exiting,
    summary,
    statusMessage,
    staffDirectory,
    device,
    refreshStaffDirectory,
    selectBranch,
    selectTerminal,
    applyDeviceConfig,
    completeDeviceSetup,
    resetDeviceSetup,
    refreshDevice,
    markExiting,
    getCloseCommission,
    loginAndOpen,
    peekActiveSession,
    tryRestoreActiveSession,
    recordSale,
    recordAudit,
    saveFloatCount,
    recordCashMove,
    nextBillNo,
    previewBillNo,
    closeShift,
    abandonShiftForTestReset,
    rollbackCloseCashCounts,
    requeueOpenShiftToOutbox,
    resyncOpenShift,
    buildOpenShiftPayload,
    getOpenShiftSyncPreview,
  };
});
