import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { DEMO_STAFF, type StaffUser } from "../data/demo-staff";
import type { DenomCount } from "../data/cash-denoms";
import { sumDenomCounts } from "../data/cash-denoms";
import type { PaymentMethod } from "./cart";

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
    billSeq.value += 1;
    const n = String(billSeq.value).padStart(6, "0");
    return `S2607-001-${n}`;
  }

  /** เปิดรอบเร็ว — นับเงินทอนทีหลังได้ */
  function loginAndOpen(codeOrPin: string, floatCash = 0): boolean {
    const raw = codeOrPin.trim();
    const found =
      DEMO_STAFF.find((s) => s.pin === raw) ??
      DEMO_STAFF.find((s) => s.code === raw);
    if (!found) {
      statusMessage.value = "รหัสพนักงานหรือ PIN ไม่ถูกต้อง";
      return false;
    }
    staff.value = found;
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
    statusMessage.value = floatCounted.value
      ? `เปิดรอบ: ${found.name} · ทอนเริ่ม ${openCash.value.toFixed(0)}฿`
      : `เปิดรอบ: ${found.name} · นับเงินทอนทีหลังได้`;
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
    if (!staff.value) return null;
    const event: AuditEvent = {
      id: uid(),
      at: new Date().toISOString(),
      staffId: staff.value.id,
      staffName: staff.value.name,
      ...input,
    };
    audits.value = [...audits.value, event];
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
    // TODO: แจ้งเตือน LINE/Discord
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
    return move;
  }

  function closeShift(closeCount?: {
    total: number;
    denoms: DenomCount[];
    note?: string;
  }) {
    const snap = summary.value;
    const counted = closeCount?.total ?? null;
    const variance =
      counted == null ? null : round2(counted - snap.expectedCash);
    const closeNote = closeCount?.note?.trim() ?? "";

    if (closeCount && staff.value) {
      cashCounts.value = [
        ...cashCounts.value,
        {
          id: uid(),
          at: new Date().toISOString(),
          staffId: staff.value.id,
          staffName: staff.value.name,
          purpose: "close",
          total: closeCount.total,
          denoms: closeCount.denoms.map((d) => ({ ...d })),
        },
      ];
    }

    const closed = {
      staffName: staff.value?.name ?? "-",
      openedAt: openedAt.value,
      closedAt: new Date().toISOString(),
      openCash: openCash.value,
      closeCash: counted,
      variance,
      closeNote,
      cashMoves: cashMoves.value.map((m) => ({ ...m })),
      cashCounts: cashCounts.value.map((c) => ({ ...c })),
      audits: audits.value.map((a) => ({ ...a })),
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
    // TODO: แจ้งเตือน LINE สรุปรอบ
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
    summary,
    statusMessage,
    loginAndOpen,
    recordSale,
    recordAudit,
    saveFloatCount,
    recordCashMove,
    nextBillNo,
    closeShift,
  };
});
