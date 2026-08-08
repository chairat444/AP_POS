import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, asc, eq, isNull } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { pg } from "@ap-pos/db";
import { DatabaseService } from "../db/database.service";
import type {
  ClaimTerminalDto,
  RegisterTerminalDto,
  TerminalRecord,
  UpsertTerminalDto,
} from "./terminal.types";
import { normalizePaperWidth } from "./terminal.types";

function now() {
  return new Date();
}

const DEFAULT_HOURS = "เปิดบริการทุกวัน 09.00 - 20.00 น.";
const DEFAULT_PHONES = "ติดต่อ 084 912 3509, 092 494 5442";

function toRecord(row: typeof pg.terminals.$inferSelect): TerminalRecord {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    branchId: row.branchId,
    active: Boolean(row.active),
    paperWidth: normalizePaperWidth(row.paperWidth),
    autoPrint: row.autoPrint !== 0,
    printSilent: row.printSilent !== 0,
    printerName: row.printerName?.trim() || null,
    receiptFooterHours: row.receiptFooterHours ?? null,
    receiptFooterPhones: row.receiptFooterPhones ?? null,
    lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

@Injectable()
export class TerminalsService {
  constructor(private readonly database: DatabaseService) {}

  async list(opts: { branchId?: string; activeOnly?: boolean } = {}) {
    const rows = await this.database.db
      .select()
      .from(pg.terminals)
      .where(isNull(pg.terminals.deletedAt))
      .orderBy(asc(pg.terminals.code));
    let list = rows.map(toRecord);
    if (opts.branchId) list = list.filter((t) => t.branchId === opts.branchId);
    if (opts.activeOnly) list = list.filter((t) => t.active);
    return { terminals: list };
  }

  async nextCode() {
    const rows = await this.database.db
      .select({ code: pg.terminals.code })
      .from(pg.terminals);
    let max = 0;
    for (const row of rows) {
      const m = /^T?(\d+)$/i.exec((row.code ?? "").trim());
      if (!m) continue;
      const n = Number(m[1]);
      if (n > max) max = n;
    }
    return { code: `T${String(max + 1).padStart(2, "0")}` };
  }

  async get(id: string) {
    const rows = await this.database.db
      .select()
      .from(pg.terminals)
      .where(and(eq(pg.terminals.id, id), isNull(pg.terminals.deletedAt)))
      .limit(1);
    if (!rows[0]) throw new NotFoundException("Terminal not found");
    return toRecord(rows[0]);
  }

  async create(dto: UpsertTerminalDto) {
    if (!dto.name?.trim()) throw new BadRequestException("กรุณาระบุชื่อเครื่อง");
    if (!dto.branchId?.trim()) throw new BadRequestException("กรุณาเลือกสาขา");
    const code = (dto.code?.trim() || (await this.nextCode()).code).toUpperCase();
    const clash = await this.database.db
      .select({ id: pg.terminals.id })
      .from(pg.terminals)
      .where(eq(pg.terminals.code, code))
      .limit(1);
    if (clash[0]) throw new BadRequestException("รหัสเครื่องซ้ำ");
    const id = `terminal-${randomUUID().slice(0, 8)}`;
    const ts = now();
    await this.database.db.insert(pg.terminals).values({
      id,
      code,
      name: dto.name.trim(),
      branchId: dto.branchId.trim(),
      active: dto.active === false ? 0 : 1,
      paperWidth: normalizePaperWidth(dto.paperWidth),
      autoPrint: dto.autoPrint === false ? 0 : 1,
      printSilent: dto.printSilent === false ? 0 : 1,
      printerName: dto.printerName?.trim() || null,
      receiptFooterHours:
        dto.receiptFooterHours?.trim() || DEFAULT_HOURS,
      receiptFooterPhones:
        dto.receiptFooterPhones?.trim() || DEFAULT_PHONES,
      lastSeenAt: null,
      updatedAt: ts,
      deletedAt: null,
    });
    return this.get(id);
  }

  async update(id: string, dto: Partial<UpsertTerminalDto>) {
    const current = await this.get(id);
    const code = (dto.code?.trim() ?? current.code).toUpperCase();
    if (code !== current.code) {
      const clash = await this.database.db
        .select({ id: pg.terminals.id })
        .from(pg.terminals)
        .where(eq(pg.terminals.code, code))
        .limit(1);
      if (clash[0] && clash[0].id !== id) {
        throw new BadRequestException("รหัสเครื่องซ้ำ");
      }
    }
    await this.database.db
      .update(pg.terminals)
      .set({
        code,
        name: dto.name?.trim() ?? current.name,
        branchId: dto.branchId?.trim() ?? current.branchId,
        active:
          dto.active == null ? (current.active ? 1 : 0) : dto.active ? 1 : 0,
        paperWidth:
          dto.paperWidth != null
            ? normalizePaperWidth(dto.paperWidth)
            : current.paperWidth,
        autoPrint:
          dto.autoPrint == null
            ? current.autoPrint
              ? 1
              : 0
            : dto.autoPrint
              ? 1
              : 0,
        printSilent:
          dto.printSilent == null
            ? current.printSilent
              ? 1
              : 0
            : dto.printSilent
              ? 1
              : 0,
        printerName:
          dto.printerName !== undefined
            ? dto.printerName?.trim() || null
            : current.printerName,
        receiptFooterHours:
          dto.receiptFooterHours !== undefined
            ? dto.receiptFooterHours?.trim() || DEFAULT_HOURS
            : current.receiptFooterHours,
        receiptFooterPhones:
          dto.receiptFooterPhones !== undefined
            ? dto.receiptFooterPhones?.trim() || DEFAULT_PHONES
            : current.receiptFooterPhones,
        updatedAt: now(),
      })
      .where(eq(pg.terminals.id, id));
    return this.get(id);
  }

  async remove(id: string) {
    const current = await this.get(id);
    await this.database.db
      .update(pg.terminals)
      .set({ deletedAt: now(), updatedAt: now(), active: 0 })
      .where(eq(pg.terminals.id, id));
    return current;
  }

  /** POS ผูกกับเครื่องที่มีอยู่แล้วเท่านั้น — ไม่สร้างเครื่องใหม่จากชื่อพิมพ์เอง */
  async claim(dto: ClaimTerminalDto) {
    if (!dto.id?.trim()) throw new BadRequestException("กรุณาเลือกเครื่อง POS");
    if (!dto.branchId?.trim()) throw new BadRequestException("กรุณาเลือกสาขา");
    const rows = await this.database.db
      .select()
      .from(pg.terminals)
      .where(
        and(eq(pg.terminals.id, dto.id.trim()), isNull(pg.terminals.deletedAt)),
      )
      .limit(1);
    if (!rows[0]) {
      throw new NotFoundException("ไม่พบเครื่อง POS นี้ในระบบ");
    }
    const row = rows[0];
    if (!row.active) {
      throw new BadRequestException("เครื่องนี้ถูกปิดใช้งานแล้ว");
    }
    if (row.branchId !== dto.branchId.trim()) {
      throw new BadRequestException("เครื่องนี้ไม่ได้อยู่ในสาขาที่เลือก");
    }
    const ts = now();
    await this.database.db
      .update(pg.terminals)
      .set({ lastSeenAt: ts, updatedAt: ts })
      .where(eq(pg.terminals.id, row.id));
    return this.get(row.id);
  }

  /** Admin / legacy — สร้างหรืออัปเดตเครื่อง */
  async register(dto: RegisterTerminalDto) {
    if (!dto.name?.trim()) throw new BadRequestException("กรุณาระบุชื่อเครื่อง");
    if (!dto.branchId?.trim()) throw new BadRequestException("กรุณาเลือกสาขา");
    const ts = now();
    if (dto.id?.trim()) {
      const rows = await this.database.db
        .select()
        .from(pg.terminals)
        .where(eq(pg.terminals.id, dto.id.trim()))
        .limit(1);
      if (rows[0]) {
        await this.database.db
          .update(pg.terminals)
          .set({
            name: dto.name.trim(),
            branchId: dto.branchId.trim(),
            active: 1,
            lastSeenAt: ts,
            updatedAt: ts,
            deletedAt: null,
          })
          .where(eq(pg.terminals.id, dto.id.trim()));
        return this.get(dto.id.trim());
      }
    }
    const code = (dto.code?.trim() || (await this.nextCode()).code).toUpperCase();
    const id = dto.id?.trim() || `terminal-${randomUUID().slice(0, 8)}`;
    await this.database.db.insert(pg.terminals).values({
      id,
      code,
      name: dto.name.trim(),
      branchId: dto.branchId.trim(),
      active: 1,
      paperWidth: "80mm",
      autoPrint: 1,
      printSilent: 1,
      receiptFooterHours: DEFAULT_HOURS,
      receiptFooterPhones: DEFAULT_PHONES,
      lastSeenAt: ts,
      updatedAt: ts,
      deletedAt: null,
    });
    return this.get(id);
  }

  async touch(id: string) {
    await this.database.db
      .update(pg.terminals)
      .set({ lastSeenAt: now(), updatedAt: now() })
      .where(eq(pg.terminals.id, id));
  }
}
