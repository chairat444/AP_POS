export type MemberRecord = {
  id: string;
  code: string;
  name: string;
  phone: string;
  points: number;
  /** วันที่สมัคร */
  createdAt: string;
  updatedAt: string;
  /** ใช้งานล่าสุดจากประวัติแต้ม · null = ยังไม่เคยใช้ */
  lastUsedAt?: string | null;
};

export type UpsertMemberDto = {
  code?: string;
  name?: string;
  /** UTF-8 hex ของชื่อ — กัน WAF หน้า HTTPS บล็อกบางชื่อไทย */
  nameEnc?: string;
  phone?: string;
  points?: number;
};
