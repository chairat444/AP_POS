export type StaffUser = {
  id: string;
  code: string;
  name: string;
  /** PIN 4 หลัก */
  pin: string;
  commissionEnabled?: boolean;
  commissionStartSales?: number;
  commissionStepSales?: number;
  commissionPerStep?: number;
};

/** ไม่มีพนักงาน demo — โหลดจาก sync / API เท่านั้น */
export const DEMO_STAFF: StaffUser[] = [];
