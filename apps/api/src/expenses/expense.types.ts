export type ExpensePaidFrom = "drawer" | "external";

export type ExpenseCategoryRecord = {
  id: string;
  name: string;
  sortOrder: number;
  posReason: string | null;
  active: boolean;
  updatedAt: string;
};

export type ExpenseRecord = {
  id: string;
  branchId: string | null;
  categoryId: string;
  categoryName?: string;
  amount: number;
  description: string | null;
  paidFrom: ExpensePaidFrom;
  spentAt: string;
  shiftId: string | null;
  terminalId: string | null;
  staffId: string | null;
  staffName: string | null;
  cashMoveId: string | null;
  note: string | null;
  updatedAt: string;
};

export type UpsertExpenseDto = {
  branchId?: string | null;
  categoryId: string;
  amount: number;
  description?: string | null;
  paidFrom?: ExpensePaidFrom;
  spentAt?: string;
  shiftId?: string | null;
  terminalId?: string | null;
  staffId?: string | null;
  staffName?: string | null;
  note?: string | null;
};

export type UpsertExpenseCategoryDto = {
  name: string;
  sortOrder?: number;
  posReason?: string | null;
  active?: boolean;
};
