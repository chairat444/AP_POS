import { PLACEHOLDER_IMAGE, type QuickProduct } from "../data/demo-products";
import { resolveImage } from "./sync";

const API_BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:3000";

export type CatalogProduct = QuickProduct;

type ApiProduct = {
  id: string;
  barcode: string;
  productCode?: string;
  name: string;
  unit: string;
  costPrice?: number | null;
  price: number | null;
  isQuick: boolean;
  quickSort: number;
  imageUrl: string | null;
  isOpenPrice?: boolean;
  openPriceMax?: number;
};

function mapApiProduct(p: ApiProduct, fallbackImage: string): CatalogProduct {
  return {
    id: p.id,
    barcode: p.barcode,
    productCode: p.productCode,
    name: p.name,
    unit: p.unit,
    costPrice: p.costPrice ?? null,
    price: p.price,
    tone: "#495057",
    image: resolveImage(p.imageUrl, fallbackImage),
    isQuick: Boolean(p.isQuick),
    quickSort: p.quickSort ?? 999,
    isOpenPrice: p.isOpenPrice ?? false,
    openPriceMax: p.openPriceMax ?? 100,
  };
}

/**
 * โหลดสินค้าทั้งหมดจากหลังบ้าน (สำหรับสแกน/ค้นหา)
 * สินค้าด่วนบนจอ = รายการที่ isQuick=true ตามที่หลังบ้านตั้ง
 */
export async function fetchCatalogProducts(): Promise<CatalogProduct[]> {
  try {
    const res = await fetch(`${API_BASE}/products`, {
      signal: AbortSignal.timeout(2500),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { products: ApiProduct[] };
    return data.products
      .map((p) => mapApiProduct(p, PLACEHOLDER_IMAGE))
      .sort((a, b) => (a.quickSort ?? 999) - (b.quickSort ?? 999));
  } catch {
    return [];
  }
}

export { API_BASE };
