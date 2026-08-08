import {
  BadRequestException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from "@nestjs/common";
import { and, asc, eq, isNull } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { pg } from "@ap-pos/db";
import { DatabaseService } from "../db/database.service";
import { AuthService } from "../auth/auth.service";
import type { StaffRecord, StaffRole, UpsertStaffDto } from "./staff.types";

function now() {
  return new Date();
}

function num(v: string | number | null | undefined, fallback: number) {
  if (v == null || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function toRecord(row: typeof pg.staff.$inferSelect): StaffRecord {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    pin: row.pin,
    role: row.role as StaffRole,
    canLoginAdmin: Boolean(row.canLoginAdmin),
    active: Boolean(row.active),
    hasPassword: Boolean(row.passwordHash),
    commissionEnabled: Boolean(row.commissionEnabled),
    commissionStartSales: num(row.commissionStartSales, 8000),
    commissionStepSales: num(row.commissionStepSales, 1000),
    commissionPerStep: num(row.commissionPerStep, 100),
    dailyWage: num(row.dailyWage, 0),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function normalizeCommission(dto: Partial<UpsertStaffDto>) {
  const enabled = Boolean(dto.commissionEnabled);
  const start = num(dto.commissionStartSales, 8000);
  const step = num(dto.commissionStepSales, 1000);
  const per = num(dto.commissionPerStep, 100);
  if (enabled) {
    if (start <= 0) {
      throw new BadRequestException("ยอดขายเริ่มได้คอมต้องมากกว่า 0");
    }
    if (step <= 0) {
      throw new BadRequestException("ขั้นยอดขายต้องมากกว่า 0");
    }
    if (per < 0) {
      throw new BadRequestException("ค่าคอมต่อขั้นต้องไม่ติดลบ");
    }
  }
  return {
    commissionEnabled: enabled ? 1 : 0,
    commissionStartSales: String(Math.max(0, start)),
    commissionStepSales: String(Math.max(1, step)),
    commissionPerStep: String(Math.max(0, per)),
  };
}

@Injectable()
export class StaffService implements OnModuleInit {
  constructor(
    private readonly database: DatabaseService,
    private readonly auth: AuthService,
  ) {}

  async onModuleInit() {
    await this.seed();
  }

  private async seed() {
    const existing = await this.database.db.select().from(pg.staff).limit(1);
    if (existing.length) return;

    await this.database.db.insert(pg.staff).values({
      id: "staff-admin",
      code: "admin",
      name: "ผู้ดูแลระบบ",
      pin: "0000",
      passwordHash: this.auth.hashPassword("admin123"),
      role: "admin",
      canLoginAdmin: 1,
      active: 1,
      commissionEnabled: 0,
      commissionStartSales: "8000",
      commissionStepSales: "1000",
      commissionPerStep: "100",
      monthlyWage: "0",
      dailyWage: "0",
      updatedAt: now(),
      deletedAt: null,
    });
  }

  async list() {
    const rows = await this.database.db
      .select()
      .from(pg.staff)
      .where(isNull(pg.staff.deletedAt))
      .orderBy(asc(pg.staff.code));
    return { staff: rows.map(toRecord) };
  }

  async nextCode() {
    const rows = await this.database.db
      .select({ code: pg.staff.code })
      .from(pg.staff);
    let max = 0;
    for (const row of rows) {
      const m = /^(\d+)$/.exec((row.code ?? "").trim());
      if (!m) continue;
      const n = Number(m[1]);
      if (n > max) max = n;
    }
    return { code: String(max + 1).padStart(2, "0") };
  }

  async get(id: string) {
    const rows = await this.database.db
      .select()
      .from(pg.staff)
      .where(and(eq(pg.staff.id, id), isNull(pg.staff.deletedAt)))
      .limit(1);
    if (!rows[0]) throw new NotFoundException("Staff not found");
    return toRecord(rows[0]);
  }

  async create(dto: UpsertStaffDto) {
    if (!dto.name?.trim()) throw new BadRequestException("กรุณาระบุชื่อ");
    const code = dto.code?.trim() || (await this.nextCode()).code;
    const canLoginAdmin = Boolean(dto.canLoginAdmin);
    if (canLoginAdmin && !dto.password?.trim()) {
      throw new BadRequestException("บัญชี Admin ต้องตั้งรหัสผ่าน");
    }
    const commission = normalizeCommission(dto);
    const dailyWage = Math.max(0, num(dto.dailyWage, 0));
    const id = `staff-${randomUUID().slice(0, 8)}`;
    await this.database.db.insert(pg.staff).values({
      id,
      code,
      name: dto.name.trim(),
      pin: (dto.pin ?? "0000").replace(/\D/g, "").slice(0, 6) || "0000",
      passwordHash: dto.password?.trim()
        ? this.auth.hashPassword(dto.password.trim())
        : null,
      role: dto.role ?? "cashier",
      canLoginAdmin: canLoginAdmin ? 1 : 0,
      active: dto.active === false ? 0 : 1,
      ...commission,
      monthlyWage: "0",
      dailyWage: String(dailyWage),
      updatedAt: now(),
      deletedAt: null,
    });
    return this.get(id);
  }

  async update(id: string, dto: Partial<UpsertStaffDto>) {
    const current = await this.get(id);
    const canLoginAdmin =
      dto.canLoginAdmin == null ? current.canLoginAdmin : Boolean(dto.canLoginAdmin);

    const commission = normalizeCommission({
      commissionEnabled:
        dto.commissionEnabled == null
          ? current.commissionEnabled
          : dto.commissionEnabled,
      commissionStartSales:
        dto.commissionStartSales == null
          ? current.commissionStartSales
          : dto.commissionStartSales,
      commissionStepSales:
        dto.commissionStepSales == null
          ? current.commissionStepSales
          : dto.commissionStepSales,
      commissionPerStep:
        dto.commissionPerStep == null
          ? current.commissionPerStep
          : dto.commissionPerStep,
    });

    const patch: Partial<typeof pg.staff.$inferInsert> = {
      code: dto.code?.trim() ?? current.code,
      name: dto.name?.trim() ?? current.name,
      pin:
        dto.pin == null
          ? current.pin
          : dto.pin.replace(/\D/g, "").slice(0, 6) || current.pin,
      role: dto.role ?? current.role,
      canLoginAdmin: canLoginAdmin ? 1 : 0,
      active: dto.active == null ? (current.active ? 1 : 0) : dto.active ? 1 : 0,
      ...commission,
      dailyWage: String(
        Math.max(
          0,
          dto.dailyWage == null
            ? current.dailyWage
            : num(dto.dailyWage, current.dailyWage),
        ),
      ),
      updatedAt: now(),
    };

    if (dto.password !== undefined) {
      const trimmed = dto.password.trim();
      patch.passwordHash = trimmed ? this.auth.hashPassword(trimmed) : null;
    }

    const willHavePassword =
      patch.passwordHash !== undefined
        ? Boolean(patch.passwordHash)
        : current.hasPassword;
    if (canLoginAdmin && !willHavePassword) {
      throw new BadRequestException("บัญชี Admin ต้องมีรหัสผ่าน");
    }

    await this.database.db.update(pg.staff).set(patch).where(eq(pg.staff.id, id));
    return this.get(id);
  }

  async remove(id: string) {
    const current = await this.get(id);
    if (current.code === "admin") {
      throw new BadRequestException("ห้ามลบบัญชี admin หลัก");
    }
    await this.database.db
      .update(pg.staff)
      .set({ deletedAt: now(), updatedAt: now(), active: 0 })
      .where(eq(pg.staff.id, id));
    return current;
  }
}
