export type ProductRecord = {
  id: string;
  barcode: string;
  productCode?: string;
  name: string;
  unit: string;
  /** ราคาทุน */
  costPrice: number | null;
  /** Fixed sell price; null = must use price-embedded barcode or open-price */
  price: number | null;
  isQuick: boolean;
  quickSort: number;
  /** Relative URL e.g. /uploads/products/xxx.jpg */
  imageUrl: string | null;
  /** Allow typing amount as price (สินค้าเบ็ดเตล็ด) */
  isOpenPrice: boolean;
  openPriceMax: number;
  /** ใช้งาน / ไม่ใช้งาน */
  active: boolean;
  updatedAt: string;
};

export type UpsertProductDto = {
  barcode: string;
  productCode?: string;
  name: string;
  unit?: string;
  costPrice?: number | null;
  price?: number | null;
  isQuick?: boolean;
  quickSort?: number;
  isOpenPrice?: boolean;
  openPriceMax?: number;
  active?: boolean;
  imageUrl?: string | null;
};

/** ตั้งชุดสินค้าด่วนทั้งแผง — ลำดับใน array = ลำดับบนจอ POS */
export type SetQuickBoardDto = {
  productIds: string[];
};

/** แถวอัปเดตราคาจาก Excel — จับคู่ด้วย barcode หรือ productCode */
export type BulkPriceRow = {
  barcode?: string;
  productCode?: string;
  /** undefined = ไม่แก้, null = เคลียร์ */
  costPrice?: number | null;
  price?: number | null;
};

export type BulkPriceResult = {
  updated: number;
  skipped: number;
  notFound: string[];
};
