export type StaffUser = {
  id: string;
  code: string;
  name: string;
  /** PIN 4 หลักสำหรับเดโม่ */
  pin: string;
};

export const DEMO_STAFF: StaffUser[] = [
  { id: "s1", code: "01", name: "พนักงาน A", pin: "1234" },
  { id: "s2", code: "02", name: "พนักงาน B", pin: "5678" },
];
