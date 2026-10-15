import {
  BadRequestException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from "@nestjs/common";
import { and, asc, desc, eq, gt, isNull, max, ne, sql } from "drizzle-orm";
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

function toRecord(
  row: typeof pg.customers.$inferSelect,
  lastUsedAt?: Date | null,
): MemberRecord {
  const created =
    row.createdAt instanceof Date
      ? row.createdAt
      : row.updatedAt instanceof Date
        ? row.updatedAt
        : now();
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    phone: row.phone ?? "",
    points: row.points,
    createdAt: created.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    lastUsedAt: lastUsedAt ? lastUsedAt.toISOString() : null,
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
      const created = m.createdAt ? new Date(m.createdAt) : new Date(m.updatedAt);
      await this.database.db.insert(pg.customers).values({
        id: m.id,
        code: m.code,
        name: m.name,
        phone: m.phone ?? null,
        points: m.points,
        createdAt: created,
        updatedAt: new Date(m.updatedAt),
        deletedAt: null,
      });
    }
  }

  /** หาสมาชิกที่ยังไม่ลบและเบอร์ตรง (normalize แล้ว) · ไม่แก้ข้อมูลเก่าที่ซ้ำอยู่แล้ว */
  private async findActiveByPhone(phone: string, excludeId?: string) {
    if (!phone) return null;
    const phoneMatch = sql`regexp_replace(coalesce(${pg.customers.phone}, ''), '[^0-9]', '', 'g') = ${phone}`;
    const rows = await this.database.db
      .select()
      .from(pg.customers)
      .where(
        excludeId
          ? and(
              isNull(pg.customers.deletedAt),
              phoneMatch,
              ne(pg.customers.id, excludeId),
            )
          : and(isNull(pg.customers.deletedAt), phoneMatch),
      )
      .limit(1);
    return rows[0] ? toRecord(rows[0]) : null;
  }

  /** หน้า kiosk ลูกค้า — ค้นด้วยเบอร์เท่านั้น · ไม่คืนรายชื่อทั้งร้าน */
  async lookupByPhone(phoneRaw: string) {
    const phone = normalizePhone(phoneRaw);
    if (phone.length < 9) {
      throw new BadRequestException("กรอกเบอร์โทรให้ครบ");
    }
    if (phone.length > 12) {
      throw new BadRequestException("เบอร์โทรไม่ถูกต้อง");
    }
    const member = await this.findActiveByPhone(phone);
    if (!member) {
      return { found: false as const };
    }
    return {
      found: true as const,
      code: member.code,
      name: member.name,
      points: member.points,
    };
  }

  /** POS ค้นสมาชิกด้วยเบอร์ตอนออนไลน์ — คืนข้อมูลเต็มเพื่อใส่แคชเครื่อง */
  async getByPhoneForPos(phoneRaw: string): Promise<MemberRecord | null> {
    const phone = normalizePhone(phoneRaw);
    if (phone.length < 9 || phone.length > 12) return null;
    return this.findActiveByPhone(phone);
  }

  /** สมัครจาก kiosk — บังคับแต้มเริ่ม 0 · ห้ามตั้งแต้มเอง */
  async registerFromKiosk(dto: { name?: string; phone?: string }) {
    return this.create({
      name: String(dto.name ?? ""),
      phone: String(dto.phone ?? ""),
      points: 0,
    });
  }

  async list() {
    const rows = await this.database.db
      .select({
        customer: pg.customers,
        lastUsedAt: max(pg.pointLedger.createdAt),
      })
      .from(pg.customers)
      .leftJoin(
        pg.pointLedger,
        eq(pg.pointLedger.customerId, pg.customers.id),
      )
      .where(isNull(pg.customers.deletedAt))
      .groupBy(pg.customers.id)
      .orderBy(desc(pg.customers.createdAt));
    return {
      members: rows.map((r) => toRecord(r.customer, r.lastUsedAt)),
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
    return rows.map((r) => toRecord(r));
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
    const dup = await this.findActiveByPhone(phone);
    if (dup) {
      throw new BadRequestException(
        `เบอร์นี้มีสมาชิกแล้ว (${dup.code} ${dup.name})`,
      );
    }
    const ts = now();
    await this.database.db.insert(pg.customers).values({
      id,
      code,
      name,
      phone,
      points,
      createdAt: ts,
      updatedAt: ts,
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
    if (nextPhone && nextPhone !== normalizePhone(current.phone)) {
      const dup = await this.findActiveByPhone(nextPhone, id);
      if (dup) {
        throw new BadRequestException(
          `เบอร์นี้มีสมาชิกแล้ว (${dup.code} ${dup.name})`,
        );
      }
    }
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
    const tokens = s.split(/\s+/).filter(Boolean);
    const alpha = s.replace(/[0-9０-９]+/g, " ").replace(/\s+/g, " ").trim();
    const rows = await this.database.db
      .select()
      .from(pg.customers)
      .where(isNull(pg.customers.deletedAt))
      .orderBy(asc(pg.customers.name));

    type Scored = ReturnType<typeof toRecord> & { _score: number };
    const scored: Scored[] = [];

    for (const raw of rows) {
      const m = toRecord(raw);
      const name = m.name.toLowerCase();
      const code = m.code.toLowerCase();
      const phoneRaw = (m.phone ?? "").toLowerCase();
      const phone = phoneRaw.replace(/\D/g, "");

      let score = 0;
      if (name === s || code === s || phone === digits) score = 100;
      else if (name.includes(s) || code.includes(s)) score = 80;
      else if (digits.length >= 6 && phone.includes(digits)) score = 70;
      else if (digits.length >= 9 && phone.endsWith(digits.slice(-9))) score = 75;
      else if (
        alpha &&
        digits.length >= 3 &&
        name.includes(alpha) &&
        phone.includes(digits)
      ) {
        score = 85;
      } else if (tokens.length > 1) {
        const ok = tokens.every((t) => {
          const tDigits = t.replace(/\D/g, "");
          return (
            name.includes(t) ||
            code.includes(t) ||
            phoneRaw.includes(t) ||
            (tDigits.length >= 3 && phone.includes(tDigits))
          );
        });
        if (ok) score = 60;
      } else if (digits.length >= 6 && phone.includes(digits)) {
        score = 50;
      } else if (phoneRaw.includes(s)) {
        score = 40;
      }
      // ไม่ใช้เบอร์สั้น ๆ อย่าง "092" เดี่ยว ๆ — ชนคนเยอะจนคนที่ถูกหลุดจาก top 30

      if (score > 0) scored.push({ ...m, _score: score });
    }

    return scored
      .sort((a, b) => b._score - a._score || a.name.localeCompare(b.name, "th"))
      .slice(0, 30)
      .map(({ _score: _s, ...m }) => m);
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

    const isOpening = (reason: string) =>
      reason.startsWith("migrate opening");

    // migrate เคยใส่ opening = แต้มปัจจุบัน ทั้งที่มีประวัติบิลแล้ว → รวมซ้ำ
    // ถ้ายอดจากรายการอื่นตรงกับแต้มปัจจุบันแล้ว ไม่นับ opening ซ้ำ
    const nonOpeningSum = rows
      .filter((r) => !isOpening(r.reason))
      .reduce((s, r) => s + r.delta, 0);
    const skipRedundantOpening =
      rows.some((r) => isOpening(r.reason)) &&
      rows.some((r) => !isOpening(r.reason)) &&
      nonOpeningSum === member.points;

    let running = 0;
    const entries: PointHistoryEntry[] = [];
    for (const r of rows) {
      if (skipRedundantOpening && isOpening(r.reason)) continue;
      running += r.delta;
      entries.push({
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
      });
    }

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
