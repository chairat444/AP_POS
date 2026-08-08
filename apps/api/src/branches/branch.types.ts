export type BranchRecord = {
  id: string;
  code: string;
  name: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export type UpsertBranchDto = {
  code?: string;
  name: string;
  active?: boolean;
};
