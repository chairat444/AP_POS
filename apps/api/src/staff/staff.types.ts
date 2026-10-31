export type StaffRole = "admin" | "manager" | "cashier";

export type StaffRecord = {
  id: string;
  code: string;
  name: string;
  pin: string;
  role: StaffRole;
  canLoginAdmin: boolean;
  /** เมนูที่เข้าได้ · ["*"] = ทุกเมนู */
  adminMenus: string[];
  active: boolean;
  hasPassword: boolean;
  commissionEnabled: boolean;
  commissionStartSales: number;
  commissionStepSales: number;
  commissionPerStep: number;
  /** ค่าแรงรายวัน (บาท) — ได้ทุกวันที่มาทำงาน */
  dailyWage: number;
  updatedAt: string;
};

export type UpsertStaffDto = {
  code?: string;
  name: string;
  pin?: string;
  password?: string;
  role?: StaffRole;
  canLoginAdmin?: boolean;
  adminMenus?: string[];
  active?: boolean;
  commissionEnabled?: boolean;
  commissionStartSales?: number;
  commissionStepSales?: number;
  commissionPerStep?: number;
  dailyWage?: number;
};
