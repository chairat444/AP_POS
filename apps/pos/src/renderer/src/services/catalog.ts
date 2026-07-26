import { DEMO_PRODUCTS, type QuickProduct } from "../data/demo-products";

const API_BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:3000";

export type CatalogProduct = QuickProduct;

type ApiProduct = {
  id: string;
  barcode: string;
  productCode?: string;
  name: string;
  unit: string;
  price: number | null;
  isQuick: boolean;
  quickSort: number;
  imageUrl: string | null;
  isOpenPrice?: boolean;
  openPriceMax?: number;
};

function resolveImage(url: string | null | undefined, fallback: string): string {
  if (!url) return fallback;
  if (url.startsWith("http://") || url.startsWith("https://") || url.startsWith("data:")) {
    return url;
  }
  return `${API_BASE}${url.startsWith("/") ? "" : "/"}${url}`;
}

function mapApiProduct(p: ApiProduct, fallbackImage: string): CatalogProduct {
  return {
    id: p.id,
    barcode: p.barcode,
    productCode: p.productCode,
    name: p.name,
    unit: p.unit,
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
  const fallbackByCode = new Map(
    DEMO_PRODUCTS.map((p) => [p.productCode ?? p.id, p.image]),
  );

  try {
    const res = await fetch(`${API_BASE}/products`, {
      signal: AbortSignal.timeout(2500),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { products: ApiProduct[] };
    const mapped = data.products
      .map((p) =>
        mapApiProduct(
          p,
          fallbackByCode.get(p.productCode ?? p.id) ??
            DEMO_PRODUCTS[DEMO_PRODUCTS.length - 1].image,
        ),
      )
      .sort((a, b) => (a.quickSort ?? 999) - (b.quickSort ?? 999));
    if (mapped.length) return mapped;
  } catch {
    // offline / API down → local demo
  }

  return DEMO_PRODUCTS.map((p) => ({
    ...p,
    isQuick: p.isQuick ?? !p.isOpenPrice,
    quickSort: p.quickSort ?? 999,
    isOpenPrice: p.isOpenPrice ?? false,
    openPriceMax: p.openPriceMax ?? 100,
  }));
}

export { API_BASE };
