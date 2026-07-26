export type ProductRecord = {
  id: string;
  barcode: string;
  productCode?: string;
  name: string;
  unit: string;
  /** Fixed price; null = must use price-embedded barcode or open-price */
  price: number | null;
  isQuick: boolean;
  quickSort: number;
  /** Relative URL e.g. /uploads/products/xxx.jpg */
  imageUrl: string | null;
  /** Allow typing amount as price (สินค้าเบ็ดเตล็ด) */
  isOpenPrice: boolean;
  openPriceMax: number;
  updatedAt: string;
};

export type UpsertProductDto = {
  barcode: string;
  productCode?: string;
  name: string;
  unit?: string;
  price?: number | null;
  isQuick?: boolean;
  quickSort?: number;
  isOpenPrice?: boolean;
  openPriceMax?: number;
  imageUrl?: string | null;
};

/** ตั้งชุดสินค้าด่วนทั้งแผง — ลำดับใน array = ลำดับบนจอ POS */
export type SetQuickBoardDto = {
  productIds: string[];
};
