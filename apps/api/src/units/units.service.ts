import {
  ConflictException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from "@nestjs/common";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { pg } from "@ap-pos/db";
import { DatabaseService } from "../db/database.service";
import type { ProductUnitRecord, UpsertProductUnitDto } from "./unit.types";

function now() {
  return new Date();
}

function normalizeName(name: string) {
  return name.trim().replace(/\s+/g, " ");
}

function toRecord(row: typeof pg.productUnits.$inferSelect): ProductUnitRecord {
  return {
    id: row.id,
    name: row.name,
    updatedAt: row.updatedAt.toISOString(),
  };
}

@Injectable()
export class UnitsService implements OnModuleInit {
  constructor(private readonly database: DatabaseService) {}

  async onModuleInit() {
    await this.seedDefaults();
    await this.backfillFromProducts();
  }

  private async seedDefaults() {
    const defaults = ["ชิ้น", "กก.", "แพ็ค", "มัด", "ขวด", "กล่อง", "ถุง"];
    for (const name of defaults) {
      await this.ensureUnit(name);
    }
  }

  private async backfillFromProducts() {
    const rows = await this.database.db
      .selectDistinct({ unit: pg.products.unit })
      .from(pg.products)
      .where(isNull(pg.products.deletedAt));
    for (const row of rows) {
      if (row.unit?.trim()) await this.ensureUnit(row.unit);
    }
  }

  async list() {
    const rows = await this.database.db
      .select()
      .from(pg.productUnits)
      .where(isNull(pg.productUnits.deletedAt))
      .orderBy(asc(pg.productUnits.name));
    return {
      units: rows.map(toRecord),
      syncedAt: now().toISOString(),
    };
  }

  async get(id: string) {
    const rows = await this.database.db
      .select()
      .from(pg.productUnits)
      .where(and(eq(pg.productUnits.id, id), isNull(pg.productUnits.deletedAt)))
      .limit(1);
    if (!rows[0]) throw new NotFoundException("Unit not found");
    return toRecord(rows[0]);
  }

  /** หาหน่วยจากชื่อ (trim) — ไม่พบคืน null */
  async findByName(raw: string): Promise<ProductUnitRecord | null> {
    const name = normalizeName(raw);
    if (!name) return null;
    const rows = await this.database.db
      .select()
      .from(pg.productUnits)
      .where(
        and(
          isNull(pg.productUnits.deletedAt),
          sql`lower(${pg.productUnits.name}) = lower(${name})`,
        ),
      )
      .limit(1);
    return rows[0] ? toRecord(rows[0]) : null;
  }

  /** มีแล้วใช้ของเดิม / ไม่มีสร้างใหม่ — คืนชื่อที่เก็บจริง */
  async ensureUnit(raw: string): Promise<string> {
    const name = normalizeName(raw) || "ชิ้น";
    const existing = await this.findByName(name);
    if (existing) return existing.name;

    const id = `u-${randomUUID().slice(0, 8)}`;
    await this.database.db.insert(pg.productUnits).values({
      id,
      name,
      updatedAt: now(),
      deletedAt: null,
    });
    return name;
  }

  async create(dto: UpsertProductUnitDto) {
    const name = await this.ensureUnit(dto.name);
    const found = await this.findByName(name);
    return found!;
  }

  async update(id: string, dto: Partial<UpsertProductUnitDto>) {
    const current = await this.get(id);
    const name = normalizeName(dto.name ?? current.name) || current.name;
    const clash = await this.findByName(name);
    if (clash && clash.id !== id) {
      throw new ConflictException("Unit name already exists");
    }
    await this.database.db
      .update(pg.productUnits)
      .set({ name, updatedAt: now() })
      .where(eq(pg.productUnits.id, id));
    return this.get(id);
  }

  async remove(id: string) {
    const current = await this.get(id);
    await this.database.db
      .update(pg.productUnits)
      .set({ deletedAt: now(), updatedAt: now() })
      .where(eq(pg.productUnits.id, id));
    return current;
  }
}
