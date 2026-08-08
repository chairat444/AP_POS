import {
  Injectable,
  NotFoundException,
  OnModuleInit,
} from "@nestjs/common";
import { and, asc, eq, gt, isNull } from "drizzle-orm";
import { existsSync, mkdirSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { pg } from "@ap-pos/db";
import { DatabaseService } from "../db/database.service";
import { UnitsService } from "../units/units.service";
import type {
  BulkPriceResult,
  BulkPriceRow,
  ProductRecord,
  UpsertProductDto,
} from "./product.types";

const UPLOAD_DIR = join(process.cwd(), "uploads", "products");
const JSON_SEED = join(process.cwd(), "data", "products.json");

function now() {
  return new Date();
}

function toRecord(row: typeof pg.products.$inferSelect): ProductRecord {
  return {
    id: row.id,
    barcode: row.barcode,
    productCode: row.productCode ?? undefined,
    name: row.name,
    unit: row.unit,
    costPrice: row.costPrice == null ? null : Number(row.costPrice),
    price: row.price == null ? null : Number(row.price),
    isQuick: Boolean(row.isQuick),
    quickSort: row.quickSort,
    imageUrl: row.imageUrl,
    isOpenPrice: Boolean(row.isOpenPrice),
    openPriceMax: Number(row.openPriceMax ?? 100),
    active: row.active == null ? true : Boolean(row.active),
    updatedAt: row.updatedAt.toISOString(),
  };
}

@Injectable()
export class ProductsService implements OnModuleInit {
  constructor(
    private readonly database: DatabaseService,
    private readonly units: UnitsService,
  ) {}

  async onModuleInit() {
    mkdirSync(UPLOAD_DIR, { recursive: true });
    const existing = await this.database.db.select().from(pg.products).limit(1);
    if (existing.length) return;
    await this.seed();
  }

  private async seed() {
    if (!existsSync(JSON_SEED)) return;
    const rows = JSON.parse(readFileSync(JSON_SEED, "utf8")) as ProductRecord[];
    if (!rows.length) return;
    for (const p of rows) {
      await this.database.db.insert(pg.products).values({
        id: p.id,
        barcode: p.barcode,
        productCode: p.productCode ?? null,
        name: p.name,
        unit: p.unit,
        costPrice: p.costPrice == null ? null : String(p.costPrice),
        price: p.price == null ? null : String(p.price),
        isQuick: p.isQuick ? 1 : 0,
        quickSort: p.quickSort,
        imageUrl: p.imageUrl,
        isOpenPrice: p.isOpenPrice ? 1 : 0,
        openPriceMax: String(p.openPriceMax ?? 100),
        active: p.active === false ? 0 : 1,
        updatedAt: new Date(p.updatedAt),
        deletedAt: null,
      });
    }
  }

  async list() {
    const rows = await this.database.db
      .select()
      .from(pg.products)
      .where(isNull(pg.products.deletedAt))
      .orderBy(asc(pg.products.quickSort));
    return {
      products: rows.map(toRecord),
      syncedAt: now().toISOString(),
    };
  }

  /** สำหรับ POS / sync — เฉพาะสินค้าที่ใช้งาน */
  async listActive() {
    const rows = await this.database.db
      .select()
      .from(pg.products)
      .where(
        and(
          isNull(pg.products.deletedAt),
          eq(pg.products.active, 1),
        ),
      )
      .orderBy(asc(pg.products.quickSort));
    return {
      products: rows.map(toRecord),
      syncedAt: now().toISOString(),
    };
  }

  async listQuick() {
    const rows = await this.database.db
      .select()
      .from(pg.products)
      .where(
        and(
          isNull(pg.products.deletedAt),
          eq(pg.products.active, 1),
          eq(pg.products.isQuick, 1),
        ),
      )
      .orderBy(asc(pg.products.quickSort));
    return {
      products: rows.map(toRecord),
      syncedAt: now().toISOString(),
    };
  }

  /** รหัสสินค้าถัดไป เช่น 00013 (ข้าม 99999) */
  async nextProductCode() {
    const rows = await this.database.db
      .select({ productCode: pg.products.productCode })
      .from(pg.products);
    let max = 0;
    for (const row of rows) {
      const code = (row.productCode ?? "").trim();
      if (!/^\d+$/.test(code)) continue;
      const n = Number(code);
      if (n >= 99999) continue;
      if (n > max) max = n;
    }
    const next = Math.min(max + 1, 99998);
    return { productCode: String(next).padStart(5, "0") };
  }

  async setQuickBoard(productIds: string[]) {
    const order = new Map(productIds.map((id, i) => [id, i + 1]));
    const all = await this.database.db.select().from(pg.products);
    for (const p of all) {
      if (p.deletedAt) continue;
      const sort = order.get(p.id);
      const price = p.price == null ? null : Number(p.price);
      const isOpen = Boolean(p.isOpenPrice);
      const isActive = p.active == null ? true : Boolean(p.active);
      if (sort != null && price != null && !isOpen && isActive) {
        await this.database.db
          .update(pg.products)
          .set({ isQuick: 1, quickSort: sort, updatedAt: now() })
          .where(eq(pg.products.id, p.id));
      } else {
        await this.database.db
          .update(pg.products)
          .set({
            isQuick: 0,
            quickSort: sort ?? p.quickSort,
            updatedAt: now(),
          })
          .where(eq(pg.products.id, p.id));
      }
    }
    return this.listQuick();
  }

  async listSince(since?: string | null) {
    const rows = await this.database.db
      .select()
      .from(pg.products)
      .where(
        since
          ? and(
              isNull(pg.products.deletedAt),
              eq(pg.products.active, 1),
              gt(pg.products.updatedAt, new Date(since)),
            )
          : and(isNull(pg.products.deletedAt), eq(pg.products.active, 1)),
      );
    return rows.map(toRecord);
  }

  async listDeletedSince(since?: string | null) {
    const rows = await this.database.db.select().from(pg.products);
    return rows
      .filter((r) => r.deletedAt || !r.active)
      .map((r) => ({
        id: r.id,
        updatedAt: (r.deletedAt ?? r.updatedAt).toISOString(),
      }))
      .filter((r) => !since || r.updatedAt > since);
  }

  async get(id: string) {
    const rows = await this.database.db
      .select()
      .from(pg.products)
      .where(and(eq(pg.products.id, id), isNull(pg.products.deletedAt)))
      .limit(1);
    if (!rows[0]) throw new NotFoundException("Product not found");
    return toRecord(rows[0]);
  }

  async create(dto: UpsertProductDto) {
    const price = dto.price ?? null;
    const costPrice = dto.costPrice ?? null;
    const isOpenPrice = dto.isOpenPrice ?? false;
    const wantQuick = dto.isQuick ?? false;
    const unit = await this.units.ensureUnit(dto.unit ?? "ชิ้น");
    const productCode =
      dto.productCode?.trim() || (await this.nextProductCode()).productCode;
    const id = `p-${randomUUID().slice(0, 8)}`;
    await this.database.db.insert(pg.products).values({
      id,
      barcode: dto.barcode,
      productCode,
      name: dto.name,
      unit,
      costPrice: costPrice == null ? null : String(costPrice),
      price: price == null ? null : String(price),
      isQuick: wantQuick && price != null && !isOpenPrice ? 1 : 0,
      quickSort: dto.quickSort ?? 999,
      imageUrl: dto.imageUrl ?? null,
      isOpenPrice: isOpenPrice ? 1 : 0,
      openPriceMax: String(dto.openPriceMax ?? 100),
      active: dto.active === false ? 0 : 1,
      updatedAt: now(),
      deletedAt: null,
    });
    return this.get(id);
  }

  async update(id: string, dto: Partial<UpsertProductDto>) {
    const current = await this.get(id);
    const nextPrice = dto.price === undefined ? current.price : dto.price;
    const nextCost =
      dto.costPrice === undefined ? current.costPrice : dto.costPrice;
    const nextOpen = dto.isOpenPrice ?? current.isOpenPrice;
    const nextActive = dto.active ?? current.active;
    let nextQuick = dto.isQuick ?? current.isQuick;
    if (nextPrice == null || nextOpen || !nextActive) nextQuick = false;
    const unit =
      dto.unit === undefined
        ? current.unit
        : await this.units.ensureUnit(dto.unit);
    await this.database.db
      .update(pg.products)
      .set({
        barcode: dto.barcode ?? current.barcode,
        productCode: dto.productCode ?? current.productCode ?? null,
        name: dto.name ?? current.name,
        unit,
        costPrice: nextCost == null ? null : String(nextCost),
        price: nextPrice == null ? null : String(nextPrice),
        isQuick: nextQuick ? 1 : 0,
        quickSort: dto.quickSort ?? current.quickSort,
        imageUrl: dto.imageUrl === undefined ? current.imageUrl : dto.imageUrl,
        isOpenPrice: nextOpen ? 1 : 0,
        openPriceMax: String(dto.openPriceMax ?? current.openPriceMax),
        active: nextActive ? 1 : 0,
        updatedAt: now(),
      })
      .where(eq(pg.products.id, id));
    return this.get(id);
  }

  /** อัปเดตราคาทุน/ขายเป็นชุด — จับคู่ barcode ก่อน แล้วค่อย productCode */
  async bulkUpdatePrices(rows: BulkPriceRow[]): Promise<BulkPriceResult> {
    const products = (await this.list()).products;
    const byBarcode = new Map<string, ProductRecord>();
    const byCode = new Map<string, ProductRecord>();
    for (const p of products) {
      const bc = p.barcode.trim();
      if (bc && !byBarcode.has(bc)) byBarcode.set(bc, p);
      const code = (p.productCode ?? "").trim();
      if (code && !byCode.has(code)) byCode.set(code, p);
    }

    let updated = 0;
    let skipped = 0;
    const notFound: string[] = [];

    for (const row of rows) {
      const barcode = row.barcode?.trim() ?? "";
      const productCode = row.productCode?.trim() ?? "";
      const hasCost = Object.prototype.hasOwnProperty.call(row, "costPrice");
      const hasPrice = Object.prototype.hasOwnProperty.call(row, "price");
      if (!hasCost && !hasPrice) {
        skipped += 1;
        continue;
      }

      const found =
        (barcode ? byBarcode.get(barcode) : undefined) ??
        (productCode ? byCode.get(productCode) : undefined);

      if (!found) {
        notFound.push(barcode || productCode || "(ว่าง)");
        continue;
      }

      const patch: Partial<UpsertProductDto> = {};
      if (hasCost) {
        const v = row.costPrice;
        patch.costPrice =
          v == null || (typeof v === "number" && !Number.isFinite(v))
            ? null
            : Math.round(Number(v) * 100) / 100;
      }
      if (hasPrice) {
        const v = row.price;
        patch.price =
          v == null || (typeof v === "number" && !Number.isFinite(v))
            ? null
            : Math.round(Number(v) * 100) / 100;
      }

      await this.update(found.id, patch);
      updated += 1;
    }

    return { updated, skipped, notFound };
  }

  async setImage(id: string, filename: string) {
    const current = await this.get(id);
    await this.database.db
      .update(pg.products)
      .set({
        imageUrl: `/uploads/products/${filename}`,
        updatedAt: now(),
      })
      .where(eq(pg.products.id, id));
    // ลบไฟล์เก่าถ้าอยู่ใต้ /uploads/products/
    if (current.imageUrl?.startsWith("/uploads/products/")) {
      const old = join(process.cwd(), current.imageUrl.replace(/^\//, ""));
      if (existsSync(old) && !old.endsWith(filename)) {
        try {
          unlinkSync(old);
        } catch {
          // ignore
        }
      }
    }
    return this.get(id);
  }

  async clearImage(id: string) {
    const current = await this.get(id);
    await this.database.db
      .update(pg.products)
      .set({ imageUrl: null, updatedAt: now() })
      .where(eq(pg.products.id, id));
    if (current.imageUrl?.startsWith("/uploads/products/")) {
      const old = join(process.cwd(), current.imageUrl.replace(/^\//, ""));
      if (existsSync(old)) {
        try {
          unlinkSync(old);
        } catch {
          // ignore
        }
      }
    }
    return this.get(id);
  }

  async remove(id: string) {
    const current = await this.get(id);
    await this.database.db
      .update(pg.products)
      .set({ deletedAt: now(), updatedAt: now() })
      .where(eq(pg.products.id, id));
    return current;
  }
}
