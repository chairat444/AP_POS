export type PromoRecord = {
  id: string;
  productCode: string;
  buyQty: number;
  payAmount: number;
  label: string;
  active: boolean;
  updatedAt: string;
};

export type UpsertPromoDto = {
  productCode: string;
  buyQty: number;
  payAmount: number;
  label: string;
  active?: boolean;
};
