import imgMisc from "../assets/products/misc.jpg";

export type QuickProduct = {
  id: string;
  barcode: string;
  productCode?: string;
  name: string;
  unit: string;
  /** ราคาทุน (admin / sync) — ไม่ใช้บนจอขาย */
  costPrice?: number | null;
  price: number | null;
  tone: string;
  image: string;
  /** จากหลังบ้าน — เลือกเป็นสินค้าด่วนบนจอ POS */
  isQuick?: boolean;
  /** ลำดับบนจอสินค้าด่วน (น้อย = มาก่อน) */
  quickSort?: number;
  isOpenPrice?: boolean;
  openPriceMax?: number;
};

/** รูปสำรองเมื่อสินค้าไม่มี imageUrl */
export const PLACEHOLDER_IMAGE = imgMisc;

/** ไม่มีสินค้า demo — โหลดจาก API / local cache เท่านั้น */
export const DEMO_PRODUCTS: QuickProduct[] = [];
