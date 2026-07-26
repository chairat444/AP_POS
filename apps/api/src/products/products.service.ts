import { Injectable, NotFoundException, OnModuleInit } from "@nestjs/common";
import { mkdirSync, existsSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { ProductRecord, UpsertProductDto } from "./product.types";

const DATA_DIR = join(process.cwd(), "data");
const UPLOAD_DIR = join(process.cwd(), "uploads", "products");
const PRODUCTS_FILE = join(DATA_DIR, "products.json");

function nowIso() {
  return new Date().toISOString();
}

@Injectable()
export class ProductsService implements OnModuleInit {
  private products: ProductRecord[] = [];

  onModuleInit() {
    mkdirSync(DATA_DIR, { recursive: true });
    mkdirSync(UPLOAD_DIR, { recursive: true });
    this.loadOrSeed();
  }

  private loadOrSeed() {
    if (existsSync(PRODUCTS_FILE)) {
      this.products = JSON.parse(readFileSync(PRODUCTS_FILE, "utf8")) as ProductRecord[];
      return;
    }
    this.products = this.seedProducts();
    this.persist();
  }

  private persist() {
    writeFileSync(PRODUCTS_FILE, JSON.stringify(this.products, null, 2), "utf8");
  }

  private seedProducts(): ProductRecord[] {
    const seeded: Array<Omit<ProductRecord, "updatedAt"> & { seedImage?: string }> = [
      { id: "p-00001", barcode: "8850001000011", productCode: "00001", name: "ผักบุ้ง", unit: "มัด", price: 15, isQuick: true, quickSort: 1, imageUrl: null, isOpenPrice: false, openPriceMax: 100, seedImage: "morning-glory.jpg" },
      { id: "p-00002", barcode: "8850001000028", productCode: "00002", name: "เห็ดเข็มทอง", unit: "แพ็ค", price: 25, isQuick: true, quickSort: 2, imageUrl: null, isOpenPrice: false, openPriceMax: 100, seedImage: "enoki.jpg" },
      { id: "p-00003", barcode: "8850001000035", productCode: "00003", name: "ซี่โครง", unit: "กก.", price: null, isQuick: false, quickSort: 3, imageUrl: null, isOpenPrice: false, openPriceMax: 100, seedImage: "ribs.jpg" },
      { id: "p-00004", barcode: "8850001000042", productCode: "00004", name: "สันนอก", unit: "กก.", price: null, isQuick: false, quickSort: 4, imageUrl: null, isOpenPrice: false, openPriceMax: 100, seedImage: "loin.jpg" },
      { id: "p-00005", barcode: "8850001000059", productCode: "00005", name: "เต้าหู้ไข่", unit: "แพ็ค", price: 20, isQuick: true, quickSort: 5, imageUrl: null, isOpenPrice: false, openPriceMax: 100, seedImage: "tofu.jpg" },
      { id: "p-00006", barcode: "8850001000066", productCode: "00006", name: "หมูเด้ง", unit: "กก.", price: null, isQuick: false, quickSort: 6, imageUrl: null, isOpenPrice: false, openPriceMax: 100, seedImage: "pork-bounce.jpg" },
      { id: "p-00007", barcode: "8850001000073", productCode: "00007", name: "ผักกาดขาว", unit: "กก.", price: 35, isQuick: true, quickSort: 7, imageUrl: null, isOpenPrice: false, openPriceMax: 100, seedImage: "cabbage.jpg" },
      { id: "p-00008", barcode: "8850001000080", productCode: "00008", name: "ลูกชิ้นหมู", unit: "แพ็ค", price: 45, isQuick: true, quickSort: 8, imageUrl: null, isOpenPrice: false, openPriceMax: 100, seedImage: "meatball.jpg" },
      { id: "p-00009", barcode: "8850001000097", productCode: "00009", name: "สามชั้นสไลด์", unit: "กก.", price: null, isQuick: false, quickSort: 9, imageUrl: null, isOpenPrice: false, openPriceMax: 100, seedImage: "belly.jpg" },
      { id: "p-00010", barcode: "8850001000103", productCode: "00010", name: "หอยดอง", unit: "ขวด", price: 25, isQuick: true, quickSort: 10, imageUrl: null, isOpenPrice: false, openPriceMax: 100, seedImage: "mussels.jpg" },
      { id: "p-00011", barcode: "8850001000110", productCode: "00011", name: "น้ำจิ้มซีฟู้ด", unit: "ขวด", price: 35, isQuick: true, quickSort: 11, imageUrl: null, isOpenPrice: false, openPriceMax: 100, seedImage: "sauce.jpg" },
      {
        id: "p-misc",
        barcode: "MISC",
        productCode: "99999",
        name: "สินค้าเบ็ดเตล็ด",
        unit: "ชิ้น",
        price: null,
        isQuick: false,
        quickSort: 12,
        imageUrl: null,
        isOpenPrice: true,
        openPriceMax: 100,
        seedImage: "misc.jpg",
      },
    ];

    const seedDir = join(process.cwd(), "..", "pos", "src", "renderer", "src", "assets", "products");

    return seeded.map((item) => {
      const { seedImage, ...rest } = item;
      let imageUrl: string | null = null;
      if (seedImage) {
        const src = join(seedDir, seedImage);
        const destName = `${rest.id}-${seedImage}`;
        const dest = join(UPLOAD_DIR, destName);
        if (existsSync(src)) {
          copyFileSync(src, dest);
          imageUrl = `/uploads/products/${destName}`;
        }
      }
      return { ...rest, imageUrl, updatedAt: nowIso() };
    });
  }

  list() {
    return {
      products: [...this.products].sort((a, b) => a.quickSort - b.quickSort),
      syncedAt: nowIso(),
    };
  }

  listQuick() {
    return {
      products: this.products
        .filter((p) => p.isQuick)
        .sort((a, b) => a.quickSort - b.quickSort),
      syncedAt: nowIso(),
    };
  }

  /**
   * หลังบ้านเลือกสินค้าด่วนทั้งแผง
   * productIds ตามลำดับที่ต้องการโชว์บนจอ — ตัวอื่น isQuick=false
   * ข้ามสินค้าที่ไม่มีราคาคงที่ / เบ็ดเตล็ด (ต้องสแกนบาร์ราคา)
   */
  setQuickBoard(productIds: string[]) {
    const order = new Map(productIds.map((id, i) => [id, i + 1]));
    for (const p of this.products) {
      const sort = order.get(p.id);
      if (sort != null && p.price != null && !p.isOpenPrice) {
        p.isQuick = true;
        p.quickSort = sort;
      } else {
        p.isQuick = false;
        if (sort != null) {
          // ขอเป็นด่วนแต่เป็นบาร์ราคา — ไม่ติดธง
          p.quickSort = sort;
        }
      }
      p.updatedAt = nowIso();
    }
    this.persist();
    return this.listQuick();
  }

  get(id: string) {
    const product = this.products.find((p) => p.id === id);
    if (!product) throw new NotFoundException("Product not found");
    return product;
  }

  create(dto: UpsertProductDto) {
    const price = dto.price ?? null;
    const isOpenPrice = dto.isOpenPrice ?? false;
    const wantQuick = dto.isQuick ?? false;
    const product: ProductRecord = {
      id: `p-${randomUUID().slice(0, 8)}`,
      barcode: dto.barcode,
      productCode: dto.productCode,
      name: dto.name,
      unit: dto.unit ?? "ชิ้น",
      price,
      isQuick: wantQuick && price != null && !isOpenPrice,
      quickSort: dto.quickSort ?? 999,
      imageUrl: dto.imageUrl ?? null,
      isOpenPrice,
      openPriceMax: dto.openPriceMax ?? 100,
      updatedAt: nowIso(),
    };
    this.products.push(product);
    this.persist();
    return product;
  }

  update(id: string, dto: Partial<UpsertProductDto>) {
    const idx = this.products.findIndex((p) => p.id === id);
    if (idx < 0) throw new NotFoundException("Product not found");
    const current = this.products[idx];
    const next: ProductRecord = {
      ...current,
      ...dto,
      unit: dto.unit ?? current.unit,
      updatedAt: nowIso(),
    };
    // สินค้าบาร์ราคา / เบ็ดเตล็ด ห้ามเป็นสินค้าด่วน
    if (next.price == null || next.isOpenPrice) {
      next.isQuick = false;
    }
    this.products[idx] = next;
    this.persist();
    return next;
  }

  setImage(id: string, filename: string) {
    const product = this.get(id);
    product.imageUrl = `/uploads/products/${filename}`;
    product.updatedAt = nowIso();
    this.persist();
    return product;
  }

  remove(id: string) {
    const idx = this.products.findIndex((p) => p.id === id);
    if (idx < 0) throw new NotFoundException("Product not found");
    const [removed] = this.products.splice(idx, 1);
    this.persist();
    return removed;
  }
}
