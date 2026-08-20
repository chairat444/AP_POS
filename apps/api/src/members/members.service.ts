import {
  BadRequestException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from "@nestjs/common";
import { and, asc, eq, gt, isNull } from "drizzle-orm";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { pg } from "@ap-pos/db";
import { DatabaseService } from "../db/database.service";
import type { MemberRecord, UpsertMemberDto } from "./member.types";

export type PointHistoryEntry = {
  id: string;
  delta: number;
  reason: string;
  saleId: string | null;
  billNo: string | null;
  branchId: string;
  branchName: string | null;
  createdAt: string;
  balanceAfter: number;
};

const JSON_SEED = join(process.cwd(), "data", "members.json");

function now() {
  return new Date();
}

function toRecord(row: typeof pg.customers.$inferSelect): MemberRecord {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    phone: row.phone ?? "",
    points: row.points,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function clampPoints(points: number | undefined): number {
  return Math.max(0, Math.floor(points ?? 0));
}

function normalizePhone(phone: string | undefined | null): string {
  return String(phone ?? "").replace(/\D/g, "");
}

@Injectable()
export class MembersService implements OnModuleInit {
  constructor(private readonly database: DatabaseService) {}

  async onModuleInit() {
    const existing = await this.database.db.select().from(pg.customers).limit(1);
    if (existing.length) return;
    await this.seed();
  }

  private async seed() {
    if (!existsSync(JSON_SEED)) return;
    const rows = JSON.parse(readFileSync(JSON_SEED, "utf8")) as MemberRecord[];
    for (const m of rows) {
      await this.database.db.insert(pg.customers).values({
        id: m.id,
        code: m.code,
        name: m.name,
        phone: m.phone ?? null,
        points: m.points,
        updatedAt: new Date(m.updatedAt),
        deletedAt: null,
      });
    }
  }

  async list() {
    const rows = await this.database.db
      .select()
      .from(pg.customers)
      .where(isNull(pg.customers.deletedAt))
      .orderBy(asc(pg.customers.name));
    return {
      members: rows.map(toRecord),
      syncedAt: now().toISOString(),
    };
  }

  async listSince(since?: string | null) {
    const rows = await this.database.db
      .select()
      .from(pg.customers)
      .where(
        since
          ? and(isNull(pg.customers.deletedAt), gt(pg.customers.updatedAt, new Date(since)))
          : isNull(pg.customers.deletedAt),
      );
    return rows.map(toRecord);
  }

  async listDeletedSince(since?: string | null) {
    const rows = await this.database.db.select().from(pg.customers);
    return rows
      .filter((r) => r.deletedAt)
      .filter((r) => !since || r.deletedAt!.toISOString() > since)
      .map((r) => ({ id: r.id, updatedAt: r.deletedAt!.toISOString() }));
  }

  async nextMemberCode() {
    const rows = await this.database.db
      .select({ code: pg.customers.code })
      .from(pg.customers);
    let max = 0;
    for (const row of rows) {
      const m = /^C?(\d+)$/i.exec((row.code ?? "").trim());
      if (!m) continue;
      const n = Number(m[1]);
      if (n > max) max = n;
    }
    return { code: `C${String(max + 1).padStart(5, "0")}` };
  }

  async get(id: string) {
    const rows = await this.database.db
      .select()
      .from(pg.customers)
      .where(and(eq(pg.customers.id, id), isNull(pg.customers.deletedAt)))
      .limit(1);
    if (!rows[0]) throw new NotFoundException("Member not found");
    return toRecord(rows[0]);
  }

  async create(dto: UpsertMemberDto) {
    const id = `m-${randomUUID().slice(0, 8)}`;
    const code = dto.code?.trim() || (await this.nextMemberCode()).code;
    const points = clampPoints(dto.points);
    const name = dto.name.trim();
    const phone = normalizePhone(dto.phone);
    if (!name) throw new BadRequestException("กรอกชื่อสมาชิก");
    if (!phone) throw new BadRequestException("กรอกเบอร์โทร");
    if (phone.length < 9) throw new BadRequestException("เบอร์โทรไม่ครบ");
    await this.database.db.insert(pg.customers).values({
      id,
      code,
      name,
      phone,
      points,
      updatedAt: now(),
      deletedAt: null,
    });
    if (points > 0) {
      await this.writeLedger({
        customerId: id,
        delta: points,
        reason: "admin_adjust",
        branchId: "admin",
      });
    }
    return this.get(id);
  }

  async update(id: string, dto: Partial<UpsertMemberDto>) {
    const current = await this.get(id);
    const nextPoints =
      dto.points == null ? current.points : clampPoints(dto.points);
    const nextPhone =
      dto.phone == null ? current.phone : normalizePhone(dto.phone);
    await this.database.db
      .update(pg.customers)
      .set({
        code: dto.code?.trim() ?? current.code,
        name: dto.name?.trim() ?? current.name,
        phone: nextPhone,
        points: nextPoints,
        updatedAt: now(),
      })
      .where(eq(pg.customers.id, id));
    const delta = nextPoints - current.points;
    if (delta !== 0) {
      await this.writeLedger({
        customerId: id,
        delta,
        reason: "admin_adjust",
        branchId: "admin",
      });
    }
    return this.get(id);
  }

  async remove(id: string) {
    const current = await this.get(id);
    await this.database.db
      .update(pg.customers)
      .set({ deletedAt: now(), updatedAt: now() })
      .where(eq(pg.customers.id, id));
    return current;
  }

  async applyPointDelta(id: string, delta: number) {
    const current = await this.get(id);
    const points = Math.max(0, Math.floor(current.points + delta));
    await this.database.db
      .update(pg.customers)
      .set({ points, updatedAt: now() })
      .where(eq(pg.customers.id, id));
    return this.get(id);
  }

  /** ค้นหาสมาชิกจากชื่อ / รหัส / เบอร์ (สำหรับหน้าประวัติแต้ม) */
  async findForPointsHistory(q: string) {
    const s = q.trim().toLowerCase();
    const digits = s.replace(/\D/g, "");
    if (!s) return [];
    const rows = await this.database.db
      .select()
      .from(pg.customers)
      .where(isNull(pg.customers.deletedAt))
      .orderBy(asc(pg.customers.name));
    return rows
      .map(toRecord)
      .filter((m) => {
        const phone = (m.phone ?? "").replace(/\D/g, "");
        return (
          m.name.toLowerCase().includes(s) ||
          m.code.toLowerCase().includes(s) ||
          (digits.length > 0 && phone.includes(digits)) ||
          (m.phone ?? "").toLowerCase().includes(s)
        );
      })
      .slice(0, 30);
  }

  async pointsHistory(customerId: string) {
    const member = await this.get(customerId);
    const rows = await this.database.db
      .select({
        id: pg.pointLedger.id,
        delta: pg.pointLedger.delta,
        reason: pg.pointLedger.reason,
        saleId: pg.pointLedger.saleId,
        branchId: pg.pointLedger.branchId,
        createdAt: pg.pointLedger.createdAt,
        billNo: pg.sales.billNo,
        branchName: pg.branches.name,
      })
      .from(pg.pointLedger)
      .leftJoin(pg.sales, eq(pg.sales.id, pg.pointLedger.saleId))
      .leftJoin(pg.branches, eq(pg.branches.id, pg.pointLedger.branchId))
      .where(eq(pg.pointLedger.customerId, customerId))
      .orderBy(asc(pg.pointLedger.createdAt), asc(pg.pointLedger.id));

    let running = 0;
    const entries: PointHistoryEntry[] = rows.map((r) => {
      running += r.delta;
      return {
        id: r.id,
        delta: r.delta,
        reason: r.reason,
        saleId: r.saleId,
        billNo: r.billNo ?? null,
        branchId: r.branchId,
        branchName:
          r.branchId === "admin" ? "แอดมิน" : (r.branchName ?? null),
        createdAt: r.createdAt.toISOString(),
        balanceAfter: running,
      };
    });

    return {
      member,
      entries: entries.slice().reverse(),
      ledgerSum: running,
    };
  }

  private async writeLedger(entry: {
    customerId: string;
    delta: number;
    reason: string;
    branchId: string;
    saleId?: string | null;
  }) {
    await this.database.db.insert(pg.pointLedger).values({
      id: `adj-${randomUUID().slice(0, 12)}`,
      customerId: entry.customerId,
      saleId: entry.saleId ?? null,
      delta: entry.delta,
      reason: entry.reason,
      branchId: entry.branchId,
      createdAt: now(),
    });
  }
}
