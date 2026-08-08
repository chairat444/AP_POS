export type ShiftRecord = {
  id: string;
  branchId: string;
  terminalId: string;
  staffId: string | null;
  staffCode: string | null;
  staffName: string;
  openedAt: string;
  closedAt: string | null;
  openCash: number;
  closeCash: number | null;
  expectedCash: number | null;
  variance: number | null;
  status: string;
  billCount: number;
  grossTotal: number;
  closeNote: string | null;
  summary: unknown | null;
  cashMoves: unknown[];
  cashCounts: unknown[];
  updatedAt: string;
};

export type SyncedShiftPayload = {
  id: string;
  branchId: string;
  terminalId: string;
  staffId?: string | null;
  staffCode?: string | null;
  staffName: string;
  openedAt: string;
  closedAt?: string | null;
  openCash: number;
  closeCash?: number | null;
  expectedCash?: number | null;
  variance?: number | null;
  status: "open" | "closed";
  billCount?: number;
  grossTotal?: number;
  closeNote?: string | null;
  summary?: unknown;
  cashMoves?: unknown[];
  cashCounts?: unknown[];
  terminalName?: string;
};

export type SyncedShiftAudit = {
  id: string;
  shiftId: string;
  branchId: string;
  terminalId: string;
  staffId?: string | null;
  staffName: string;
  type: "line_void" | "bill_cancel" | string;
  at: string;
  barcode?: string | null;
  productName?: string | null;
  qty?: number | null;
  amount: number;
  billTotalBefore?: number | null;
  itemCountBefore?: number | null;
};

export type ShiftAuditRecord = {
  id: string;
  shiftId: string;
  branchId: string;
  terminalId: string;
  staffId: string | null;
  staffName: string;
  type: string;
  barcode: string | null;
  productName: string | null;
  qty: number | null;
  amount: number;
  billTotalBefore: number | null;
  itemCountBefore: number | null;
  createdAt: string;
};
