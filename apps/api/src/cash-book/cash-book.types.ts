export type CashBookDirection = "in" | "out";

/** sale = รายได้สาขา · loan = เงินยืม · expense = ค่าใช้จ่าย · other = อื่นๆ */
export type CashBookKind = "sale" | "loan" | "expense" | "other";

export type CashBookEntryRecord = {
  id: string;
  entryDate: string;
  direction: CashBookDirection;
  kind: CashBookKind;
  branchId: string | null;
  branchName?: string | null;
  categoryId: string | null;
  categoryName?: string | null;
  amount: number;
  description: string | null;
  note: string | null;
  /** มีค่า = รายการที่ระบบสร้างอัตโนมัติ */
  sourceKey: string | null;
  auto: boolean;
  updatedAt: string;
};

export type UpsertCashBookEntryDto = {
  entryDate: string;
  direction: CashBookDirection;
  kind: CashBookKind;
  branchId?: string | null;
  categoryId?: string | null;
  amount: number;
  description?: string | null;
  note?: string | null;
};

export type CashBookDaySummary = {
  day: string;
  /** เงินเข้าทั้งหมด (ยอดขาย + ยืม/อื่นๆ) */
  income: number;
  /** เฉพาะยอดขายสาขา */
  sales: number;
  /** เงินเข้าอื่น เช่น ยืมจากเจ้าของ */
  otherIncome: number;
  expense: number;
  net: number;
  count: number;
  /** ยอดขายแยกสาขา — เงินสด / โอน / สวัสดิการ */
  salesByBranch: Array<{
    branchId: string;
    branchName: string;
    cash: number;
    transfer: number;
    government: number;
    /** จำนวนบิลที่มีการโอน (method=transfer) */
    transferBills: number;
    amount: number;
  }>;
};

export type CashBookMonthReport = {
  month: string;
  branches: Array<{ id: string; name: string }>;
  summary: {
    income: number;
    sales: number;
    otherIncome: number;
    expense: number;
    net: number;
    count: number;
  };
  /** สรุปกลุ่มจ่าย + ยอดขายแยกวิธีชำระ ของเดือน */
  buckets: {
    rent: number;
    rentByBranch: Array<{ branchId: string; branchName: string; amount: number }>;
    wage: number;
    goods: number;
    routine: number;
    drawer: number;
    manual: number;
    cashSales: number;
    transferSales: number;
    /** จำนวนบิลที่มีเงินโอนในเดือน */
    transferBills: number;
    /** เงินสวัสดิการ (วิธีชำระ government) */
    governmentSales: number;
    /** เงินเข้าอื่นที่ไม่ใช่ยอดขายและไม่ใช่ยืม */
    otherIn: number;
    loanIn: number;
    loanOut: number;
  };
  days: CashBookDaySummary[];
};
