export type MemberRecord = {
  id: string;
  code: string;
  name: string;
  phone: string;
  points: number;
  updatedAt: string;
};

export type UpsertMemberDto = {
  code?: string;
  name: string;
  phone?: string;
  points?: number;
};
