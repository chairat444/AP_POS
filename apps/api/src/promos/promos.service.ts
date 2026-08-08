import {
  BadRequestException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from "@nestjs/common";
import { and, asc, eq, gt, isNull, isNotNull } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { pg } from "@ap-pos/db";
import { DatabaseService } from "../db/database.service";
import type { PromoRecord, UpsertPromoDto } from "./promo.types";

function now() {
  return new Date();
}

function toRecord(row: typeof pg.promos.$inferSelect): PromoRecord {
  return {
    id: row.id,
    productCode: row.productCode,
    buyQty: row.buyQty,
    payAmount: Number(row.payAmount),
    label: row.label,
    active: Boolean(row.active),
    updatedAt: row.updatedAt.toISOString(),
  };
}

@Injectable()
export class PromosService implements OnModuleInit {
  constructor(private readonly database: DatabaseService) {}

  async onModuleInit() {
    await this.seed();
  }

  private async seed() {
    // ไม่ seed โปรโมชัน demo
  }

  async list(opts: { activeOnly?: boolean } = {}) {
    const rows = await this.database.db
      .select()
      .from(pg.promos)
      .where(isNull(pg.promos.deletedAt))
      .orderBy(asc(pg.promos.label));
    let list = rows.map(toRecord);
    if (opts.activeOnly) list = list.filter((p) => p.active);
    return { promos: list };
  }

  async listSince(since?: string | null) {
    if (!since) return (await this.list({ activeOnly: true })).promos;
    const rows = await this.database.db
      .select()
      .from(pg.promos)
      .where(
        and(
          isNull(pg.promos.deletedAt),
          gt(pg.promos.updatedAt, new Date(since)),
        ),
      );
    return rows.map(toRecord).filter((p) => p.active);
  }

  async listDeletedSince(since?: string | null) {
    if (!since) return [] as Array<{ id: string; updatedAt: string }>;
    const rows = await this.database.db
      .select()
      .from(pg.promos)
      .where(
        and(
          isNotNull(pg.promos.deletedAt),
          gt(pg.promos.deletedAt, new Date(since)),
        ),
      );
    return rows.map((r) => ({
      id: r.id,
      updatedAt: (r.deletedAt ?? r.updatedAt).toISOString(),
    }));
  }

  async get(id: string) {
    const rows = await this.database.db
      .select()
      .from(pg.promos)
      .where(and(eq(pg.promos.id, id), isNull(pg.promos.deletedAt)))
      .limit(1);
    if (!rows[0]) throw new NotFoundException("Promo not found");
    return toRecord(rows[0]);
  }

  async create(dto: UpsertPromoDto) {
    this.validate(dto);
    const id = `promo-${randomUUID().slice(0, 8)}`;
    await this.database.db.insert(pg.promos).values({
      id,
      productCode: dto.productCode.trim(),
      buyQty: Math.floor(dto.buyQty),
      payAmount: String(dto.payAmount),
      label: dto.label.trim(),
      active: dto.active === false ? 0 : 1,
      updatedAt: now(),
      deletedAt: null,
    });
    return this.get(id);
  }

  async update(id: string, dto: Partial<UpsertPromoDto>) {
    const current = await this.get(id);
    const next = {
      productCode: dto.productCode?.trim() ?? current.productCode,
      buyQty: dto.buyQty == null ? current.buyQty : Math.floor(dto.buyQty),
      payAmount: dto.payAmount == null ? current.payAmount : Number(dto.payAmount),
      label: dto.label?.trim() ?? current.label,
      active: dto.active == null ? current.active : Boolean(dto.active),
    };
    this.validate(next);
    await this.database.db
      .update(pg.promos)
      .set({
        productCode: next.productCode,
        buyQty: next.buyQty,
        payAmount: String(next.payAmount),
        label: next.label,
        active: next.active ? 1 : 0,
        updatedAt: now(),
      })
      .where(eq(pg.promos.id, id));
    return this.get(id);
  }

  async remove(id: string) {
    const current = await this.get(id);
    await this.database.db
      .update(pg.promos)
      .set({ deletedAt: now(), updatedAt: now(), active: 0 })
      .where(eq(pg.promos.id, id));
    return current;
  }

  private validate(dto: {
    productCode: string;
    buyQty: number;
    payAmount: number;
    label: string;
  }) {
    if (!dto.productCode?.trim()) {
      throw new BadRequestException("กรุณาระบุรหัสสินค้า");
    }
    if (!dto.label?.trim()) throw new BadRequestException("กรุณาระบุชื่อโปรโม");
    if (!Number.isFinite(dto.buyQty) || dto.buyQty < 2) {
      throw new BadRequestException("จำนวนซื้อต้องอย่างน้อย 2");
    }
    if (!Number.isFinite(dto.payAmount) || dto.payAmount <= 0) {
      throw new BadRequestException("ยอดจ่ายต้องมากกว่า 0");
    }
  }
}
