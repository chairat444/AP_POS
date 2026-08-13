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
  enqueueAuditAndSync,
  enqueueShiftAndSync,
  fetchStaffDayPriorSales,
  getDeviceConfig,
  loadStaffDirectory,
  markDeviceSetupDone,
  setDeviceBranch,
  setDeviceTerminal,
  type SyncBranch,
  type SyncStaff,
  type SyncedShiftPayload,
} from "../services/sync";
import type { PaymentMethod } from "./cart";

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

function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
    const day = new Date().toISOString().slice(2, 10).replace(/-/g, "");
    return `S${day}-${branchCodeOf(d)}-${n}`;
  }

  function previewBillNo() {
    const d = deviceSync();
    const n = String(billSeq.value + 1).padStart(6, "0");
    const day = new Date().toISOString().slice(2, 10).replace(/-/g, "");
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
        audits: audits.value,
      },
      cashMoves: cashMoves.value.map((m) => ({ ...m })),
      cashCounts: cashCounts.value.map((c) => ({ ...c })),
      ...extra,
    };
  }

  function pushShiftSnapshot(
    status: "open" | "closed",
    extra: Partial<SyncedShiftPayload> = {},
  ) {
    const payload = buildShiftPayload(status, extra);
    if (!payload) return Promise.resolve();
    return enqueueShiftAndSync(payload);
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
    billSeq.value = 0;
    const branchLabel = deviceSync().branchName || deviceSync().branchId;
    statusMessage.value = floatCounted.value
      ? `เปิดรอบ: ${found.name} · ${branchLabel} · ทอนเริ่ม ${openCash.value.toFixed(0)}฿`
      : `เปิดรอบ: ${found.name} · ${branchLabel} · นับเงินทอนทีหลังได้`;
    pushShiftSnapshot("open");
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

    return event;
  }

  function saveFloatCount(denoms: DenomCount[]) {
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
    statusMessage.value = `บันทึกเงินทอนเริ่มรอบ ${total.toFixed(0)} บาท`;
    pushShiftSnapshot("open");
    return rec;
  }

  function recordCashMove(input: {
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
    statusMessage.value =
      input.direction === "out"
        ? `นำเงินออก ${amount.toFixed(0)}฿ (${move.reason})`
        : `นำเงินเข้า ${amount.toFixed(0)}฿ (${move.reason})`;
    pushShiftSnapshot("open");
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

  async function closeShift(closeCount?: {
    total: number;
    denoms: DenomCount[];
    note?: string;
  }) {
    const snap = summary.value;
    const counted = closeCount?.total ?? null;
    const variance =
      counted == null ? null : round2(counted - snap.expectedCash);
    const closeNote = closeCount?.note?.trim() ?? "";
    const closedAt = new Date().toISOString();

    if (closeCount && staff.value) {
      cashCounts.value = [
        ...cashCounts.value,
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
    }

    // สร้าง payload ก่อนเคลียร์ state — sync ทำพื้นหลัง อย่าบล็อกการปิดแอป
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

    const closed = {
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
    statusMessage.value =
      variance == null
        ? "ปิดรอบเรียบร้อย"
        : `ปิดรอบแล้ว · นับได้ ${counted?.toFixed(0)} ต่าง ${variance >= 0 ? "+" : ""}${variance.toFixed(0)}${closeNote ? ` · ${closeNote}` : ""}`;

    // ปิดรอบ: บันทึก SQLite → เช็ค API 3 รอบ → ส่งถ้าติด / ปิดเลยถ้าไม่ติด
    if (payload) {
      await enqueueShiftAndSync(payload, {
        awaitIfOnline: true,
        probeAttempts: 3,
        probeTimeoutMs: 800,
        pushTimeoutMs: 12_000,
        onlineDeadlineMs: 45_000,
      }).catch(() => undefined);
    }
    try {
      if (window.apPos?.db?.purgeSyncedSales) {
        await window.apPos.db.purgeSyncedSales();
      }
    } catch {
      // ignore
    }
    return closed;
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
    recordSale,
    recordAudit,
    saveFloatCount,
    recordCashMove,
    nextBillNo,
    previewBillNo,
    closeShift,
  };
});
