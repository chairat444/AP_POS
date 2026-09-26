import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  forwardRef,
} from "@nestjs/common";
import { and, desc, eq, gte, inArray, isNull, lte, ne, or, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { pg } from "@ap-pos/db";
import { DatabaseService } from "../db/database.service";
import { ExpensesService } from "../expenses/expenses.service";
import { NotifyService } from "../notify/notify.service";
import { TerminalsService } from "../terminals/terminals.service";
import type { ShiftRecord, SyncedShiftAudit, SyncedShiftPayload } from "./shift.types";

function num(v: string | number | null | undefined, fallback = 0) {
  if (v == null || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** ค่าคอมรายวัน — สูตรเดียวกับ packages/shared commission.ts */
function calcDailyCommission(
  daySales: number,
  config: {
    enabled: boolean;
    startSales: number;
    stepSales: number;
    amountPerStep: number;
  },
) {
  const sales = Math.max(0, num(daySales));
  const startSales = Math.max(0, config.startSales);
  const stepSales = Math.max(1, config.stepSales);
  const amountPerStep = Math.max(0, config.amountPerStep);
  if (
    !config.enabled ||
    amountPerStep <= 0 ||
    startSales <= 0 ||
    sales < startSales
  ) {
    return { amount: 0, steps: 0 };
  }
  const steps = Math.floor((sales - startSales) / stepSales) + 1;
  return { amount: steps * amountPerStep, steps };
}

/** ค่าแรงวันอาทิตย์เมื่อมาขาย (บาท) — คอมยังคิดตามเรทของแต่ละคน */
const SUNDAY_WAGE_BAHT = 800;

function isBangkokSunday(day: string) {
  const label = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Bangkok",
    weekday: "short",
  }).format(new Date(`${day}T12:00:00+07:00`));
  return label === "Sun";
}

/** ค่าแรงเริ่มต้นของวัน: อาทิตย์ = 800 · วันอื่น = ตามที่ตั้งในพนักงาน */
function dailyWageForDate(day: string, baseDailyWage: number) {
  if (isBangkokSunday(day)) return SUNDAY_WAGE_BAHT;
  return Math.round(num(baseDailyWage, 0) * 100) / 100;
}

function formatCommissionRule(config: {
  enabled: boolean;
  startSales: number;
  stepSales: number;
  amountPerStep: number;
}) {
  if (!config.enabled) return "ไม่คิดค่าคอม";
  return `เริ่ม ${config.startSales.toLocaleString("th-TH")}฿ ได้ ${config.amountPerStep.toLocaleString("th-TH")} · ทุก +${config.stepSales.toLocaleString("th-TH")}฿ ได้ +${config.amountPerStep.toLocaleString("th-TH")}`;
}

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function toRecord(row: typeof pg.shifts.$inferSelect): ShiftRecord {
  return {
    id: row.id,
    branchId: row.branchId,
    terminalId: row.terminalId,
    staffId: row.staffId,
    staffCode: row.staffCode,
    staffName: row.staffName,
    openedAt: row.openedAt.toISOString(),
    closedAt: row.closedAt?.toISOString() ?? null,
    openCash: num(row.openCash),
    closeCash: row.closeCash == null ? null : num(row.closeCash),
    expectedCash: row.expectedCash == null ? null : num(row.expectedCash),
    variance: row.variance == null ? null : num(row.variance),
    status: row.status,
    billCount: row.billCount ?? 0,
    grossTotal: num(row.grossTotal),
    closeNote: row.closeNote,
    summary: parseJson(row.summaryJson, null),
    cashMoves: parseJson(row.cashMovesJson, []),
    cashCounts: parseJson(row.cashCountsJson, []),
    updatedAt: row.updatedAt.toISOString(),
  };
}

@Injectable()
export class ShiftsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly terminals: TerminalsService,
    @Inject(forwardRef(() => ExpensesService))
    private readonly expenses: ExpensesService,
    private readonly notify: NotifyService,
  ) {}

  private async liveSalesByShift(shiftIds: string[]) {
    const map = new Map<
      string,
      { billCount: number; grossTotal: number; cashTotal: number }
    >();
    if (!shiftIds.length) return map;

    const saleRows = await this.database.db
      .select({
        shiftId: pg.sales.shiftId,
        billCount: sql<number>`count(*)::int`,
        grossTotal: sql<string>`coalesce(sum(${pg.sales.total}), 0)`,
      })
      .from(pg.sales)
      .where(
        and(
          inArray(pg.sales.shiftId, shiftIds),
          eq(pg.sales.status, "completed"),
        ),
      )
      .groupBy(pg.sales.shiftId);
    for (const r of saleRows) {
      if (!r.shiftId) continue;
      map.set(r.shiftId, {
        billCount: Number(r.billCount ?? 0),
        grossTotal: num(r.grossTotal),
        cashTotal: 0,
      });
    }

    const cashRows = await this.database.db
      .select({
        shiftId: pg.sales.shiftId,
        cashTotal: sql<string>`coalesce(sum(${pg.salePayments.amount}), 0)`,
      })
      .from(pg.salePayments)
      .innerJoin(pg.sales, eq(pg.salePayments.saleId, pg.sales.id))
      .where(
        and(
          inArray(pg.sales.shiftId, shiftIds),
          eq(pg.sales.status, "completed"),
          eq(pg.salePayments.method, "cash"),
        ),
      )
      .groupBy(pg.sales.shiftId);
    for (const r of cashRows) {
      if (!r.shiftId) continue;
      const cur = map.get(r.shiftId) ?? {
        billCount: 0,
        grossTotal: 0,
        cashTotal: 0,
      };
      cur.cashTotal = num(r.cashTotal);
      map.set(r.shiftId, cur);
    }
    return map;
  }

  /** คาดในลิ้นชัก = เงินทอนเริ่ม + ขายเงินสด + นำเข้า − นำออก */
  private computeExpectedCash(
    openCash: number,
    cashSales: number,
    cashMoves: unknown[],
    summary: Record<string, unknown> | null,
  ) {
    let cashIn = 0;
    let cashOut = 0;
    const moves = Array.isArray(cashMoves) ? cashMoves : [];
    for (const raw of moves) {
      const m = raw as Record<string, unknown>;
      const amount = num(m.amount as string | number);
      if (String(m.direction) === "in") cashIn += amount;
      else cashOut += amount;
    }
    if (!moves.length && summary) {
      cashIn = num(summary.cashInTotal as string | number);
      cashOut = num(summary.cashOutTotal as string | number);
    }
    return Math.round((openCash + cashSales + cashIn - cashOut) * 100) / 100;
  }

  async list(opts: {
    branchId?: string;
    terminalId?: string;
    status?: string;
    from?: string;
    to?: string;
  } = {}) {
    const conditions = [];
    if (opts.branchId) conditions.push(eq(pg.shifts.branchId, opts.branchId));
    if (opts.terminalId)
      conditions.push(eq(pg.shifts.terminalId, opts.terminalId));
    if (opts.status) conditions.push(eq(pg.shifts.status, opts.status));
    if (opts.from) conditions.push(gte(pg.shifts.openedAt, new Date(opts.from)));
    if (opts.to) conditions.push(lte(pg.shifts.openedAt, new Date(opts.to)));

    const rows = await this.database.db
      .select()
      .from(pg.shifts)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(pg.shifts.openedAt))
      .limit(500);

    const terminalIds = [...new Set(rows.map((r) => r.terminalId))];
    const terminalMap = new Map<string, { code: string; name: string }>();
    for (const tid of terminalIds) {
      try {
        const t = await this.terminals.get(tid);
        terminalMap.set(tid, { code: t.code, name: t.name });
      } catch {
        terminalMap.set(tid, { code: tid.slice(0, 8), name: tid });
      }
    }

    const branchRows = await this.database.db.select().from(pg.branches);
    const branchMap = new Map(branchRows.map((b) => [b.id, b.name]));

    const voidByShift = new Map<
      string,
      { lineCount: number; lineAmount: number; billCount: number; billAmount: number }
    >();
    if (rows.length) {
      const auditRows = await this.database.db
        .select({
          shiftId: pg.shiftAudits.shiftId,
          type: pg.shiftAudits.type,
          amount: pg.shiftAudits.amount,
        })
        .from(pg.shiftAudits)
        .where(
          inArray(
            pg.shiftAudits.shiftId,
            rows.map((r) => r.id),
          ),
        );
      for (const a of auditRows) {
        const cur = voidByShift.get(a.shiftId) ?? {
          lineCount: 0,
          lineAmount: 0,
          billCount: 0,
          billAmount: 0,
        };
        const amt = num(a.amount);
        if (a.type === "bill_cancel") {
          cur.billCount += 1;
          cur.billAmount += amt;
        } else {
          cur.lineCount += 1;
          cur.lineAmount += amt;
        }
        voidByShift.set(a.shiftId, cur);
      }
    }

    const liveSales = await this.liveSalesByShift(rows.map((r) => r.id));

    return {
      shifts: rows.map((row) => {
        const rec = toRecord(row);
        const term = terminalMap.get(row.terminalId);
        const fromTable = voidByShift.get(row.id);
        const summary = (rec.summary ?? {}) as Record<string, unknown>;
        const voidStats = fromTable ?? {
          lineCount: Number(summary.voidLineCount ?? 0),
          lineAmount: Number(summary.voidLineAmount ?? 0),
          billCount: Number(summary.voidBillCount ?? 0),
          billAmount: Number(summary.voidBillAmount ?? 0),
        };
        const live = liveSales.get(row.id);
        const summaryObj = (rec.summary ?? {}) as Record<string, unknown>;
        // กะเปิด: คำนวณคาดในลิ้นชักจากบิลที่ sync แล้ว (สแนปช็อตกะไม่อัปทุกบิล)
        const expectedCash =
          rec.status === "open"
            ? this.computeExpectedCash(
                rec.openCash,
                live?.cashTotal ?? 0,
                rec.cashMoves,
                summaryObj,
              )
            : rec.expectedCash;
        return {
          ...rec,
          // ยอดจากบิลที่ sync แล้ว — ไม่พึ่งสแนปช็อตกะที่อาจค้าง
          billCount: live?.billCount ?? rec.billCount,
          grossTotal: live?.grossTotal ?? rec.grossTotal,
          expectedCash,
          terminalCode: term?.code ?? null,
          terminalName: term?.name ?? null,
          branchName: branchMap.get(row.branchId) ?? null,
          voidStats,
        };
      }),
    };
  }

  /**
   * กะที่เปิดอยู่ของพนักงาน — ใช้กัน PIN/พนักงานซ้ำข้ามเครื่อง
   * excludeTerminalId = เครื่องนี้เอง (กู้รอบ/เปิดซ้ำเครื่องเดิมได้)
   */
  async findOpenByStaff(opts: {
    staffId?: string | null;
    staffCode?: string | null;
    excludeTerminalId?: string | null;
  }) {
    const staffId = String(opts.staffId ?? "").trim();
    const staffCode = String(opts.staffCode ?? "").trim();
    if (!staffId && !staffCode) {
      return { open: false as const };
    }

    const conditions = [eq(pg.shifts.status, "open")];
    if (staffId && staffCode) {
      conditions.push(
        or(eq(pg.shifts.staffId, staffId), eq(pg.shifts.staffCode, staffCode))!,
      );
    } else if (staffId) {
      conditions.push(eq(pg.shifts.staffId, staffId));
    } else {
      conditions.push(eq(pg.shifts.staffCode, staffCode));
    }
    if (opts.excludeTerminalId?.trim()) {
      conditions.push(ne(pg.shifts.terminalId, opts.excludeTerminalId.trim()));
    }

    const rows = await this.database.db
      .select()
      .from(pg.shifts)
      .where(and(...conditions))
      .orderBy(desc(pg.shifts.openedAt))
      .limit(1);
    const row = rows[0];
    if (!row) return { open: false as const };

    let terminalName: string | null = null;
    let terminalCode: string | null = null;
    try {
      const t = await this.terminals.get(row.terminalId);
      terminalName = t.name;
      terminalCode = t.code;
    } catch {
      /* ignore */
    }
    const branchRows = await this.database.db
      .select({ name: pg.branches.name })
      .from(pg.branches)
      .where(eq(pg.branches.id, row.branchId))
      .limit(1);

    return {
      open: true as const,
      shiftId: row.id,
      staffId: row.staffId,
      staffCode: row.staffCode,
      staffName: row.staffName,
      branchId: row.branchId,
      branchName: branchRows[0]?.name ?? null,
      terminalId: row.terminalId,
      terminalName,
      terminalCode,
      openedAt: row.openedAt?.toISOString?.() ?? String(row.openedAt),
    };
  }

  async get(id: string) {
    const rows = await this.database.db
      .select()
      .from(pg.shifts)
      .where(eq(pg.shifts.id, id))
      .limit(1);
    if (!rows[0]) throw new NotFoundException("Shift not found");
    const rec = toRecord(rows[0]);
    let terminal: { code: string; name: string } | null = null;
    try {
      const t = await this.terminals.get(rec.terminalId);
      terminal = { code: t.code, name: t.name };
    } catch {
      /* ignore */
    }
    const branchRows = await this.database.db
      .select()
      .from(pg.branches)
      .where(eq(pg.branches.id, rec.branchId))
      .limit(1);
    const live = (await this.liveSalesByShift([id])).get(id);
    const summaryObj = (rec.summary ?? {}) as Record<string, unknown>;
    const expectedCash =
      rec.status === "open"
        ? this.computeExpectedCash(
            rec.openCash,
            live?.cashTotal ?? 0,
            rec.cashMoves,
            summaryObj,
          )
        : rec.expectedCash;
    return {
      ...rec,
      billCount: live?.billCount ?? rec.billCount,
      grossTotal: live?.grossTotal ?? rec.grossTotal,
      expectedCash,
      terminalCode: terminal?.code ?? null,
      terminalName: terminal?.name ?? null,
      branchName: branchRows[0]?.name ?? null,
      audits: await this.listAudits(id),
    };
  }

  async listAudits(shiftId: string) {
    const rows = await this.database.db
      .select()
      .from(pg.shiftAudits)
      .where(eq(pg.shiftAudits.shiftId, shiftId))
      .orderBy(desc(pg.shiftAudits.createdAt));

    if (rows.length) {
      return rows.map((row) => ({
        id: row.id,
        shiftId: row.shiftId,
        branchId: row.branchId,
        terminalId: row.terminalId,
        staffId: row.staffId,
        staffName: row.staffName,
        type: row.type,
        barcode: row.barcode,
        productName: row.productName,
        qty: row.qty == null ? null : num(row.qty),
        amount: num(row.amount),
        billTotalBefore:
          row.billTotalBefore == null ? null : num(row.billTotalBefore),
        itemCountBefore: row.itemCountBefore,
        createdAt: row.createdAt.toISOString(),
      }));
    }

    // fallback: รอบเก่าที่เก็บ audits ใน summary_json อย่างเดียว
    const shiftRows = await this.database.db
      .select({ summaryJson: pg.shifts.summaryJson })
      .from(pg.shifts)
      .where(eq(pg.shifts.id, shiftId))
      .limit(1);
    const summary = parseJson<Record<string, unknown> | null>(
      shiftRows[0]?.summaryJson,
      null,
    );
    const legacy = Array.isArray(summary?.audits) ? summary.audits : [];
    return legacy.map((raw, i) => {
      const a = raw as Record<string, unknown>;
      return {
        id: String(a.id ?? `${shiftId}:legacy:${i}`),
        shiftId,
        branchId: String(a.branchId ?? ""),
        terminalId: String(a.terminalId ?? ""),
        staffId: a.staffId == null ? null : String(a.staffId),
        staffName: String(a.staffName ?? "-"),
        type: String(a.type ?? "line_void"),
        barcode: a.barcode == null ? null : String(a.barcode),
        productName: a.productName == null ? null : String(a.productName),
        qty: a.qty == null ? null : num(a.qty as string | number),
        amount: num(a.amount as string | number),
        billTotalBefore:
          a.billTotalBefore == null
            ? null
            : num(a.billTotalBefore as string | number),
        itemCountBefore:
          a.itemCountBefore == null ? null : Number(a.itemCountBefore),
        createdAt: String(a.at ?? a.createdAt ?? new Date().toISOString()),
      };
    });
  }

  async acceptAudits(audits: SyncedShiftAudit[]) {
    const accepted: string[] = [];
    for (const a of audits) {
      if (!a?.id || !a.shiftId || !a.type) continue;
      await this.upsertAudit(a);
      accepted.push(a.id);
    }
    return { accepted };
  }

  private async upsertAudit(a: SyncedShiftAudit) {
    const values = {
      id: a.id,
      shiftId: a.shiftId,
      branchId: a.branchId,
      terminalId: a.terminalId,
      staffId: a.staffId ?? null,
      staffName: a.staffName || "-",
      type: a.type,
      barcode: a.barcode ?? null,
      productName: a.productName ?? null,
      qty: a.qty == null ? null : String(a.qty),
      amount: String(a.amount ?? 0),
      billTotalBefore:
        a.billTotalBefore == null ? null : String(a.billTotalBefore),
      itemCountBefore:
        a.itemCountBefore == null ? null : Math.floor(a.itemCountBefore),
      createdAt: new Date(a.at || Date.now()),
      syncedAt: new Date(),
    };
    const existing = await this.database.db
      .select({ id: pg.shiftAudits.id })
      .from(pg.shiftAudits)
      .where(eq(pg.shiftAudits.id, a.id))
      .limit(1);
    if (existing[0]) {
      await this.database.db
        .update(pg.shiftAudits)
        .set(values)
        .where(eq(pg.shiftAudits.id, a.id));
    } else {
      await this.database.db.insert(pg.shiftAudits).values(values);
    }
  }

  async report(opts: { branchId?: string; from?: string; to?: string } = {}) {
    const { shifts } = await this.list({
      ...opts,
      status: "closed",
    });
    const summary = {
      shiftCount: shifts.length,
      billCount: shifts.reduce((s, x) => s + x.billCount, 0),
      grossTotal: shifts.reduce((s, x) => s + x.grossTotal, 0),
      openCashTotal: shifts.reduce((s, x) => s + x.openCash, 0),
      closeCashTotal: shifts.reduce((s, x) => s + (x.closeCash ?? 0), 0),
      expectedCashTotal: shifts.reduce((s, x) => s + (x.expectedCash ?? 0), 0),
      varianceTotal: shifts.reduce((s, x) => s + (x.variance ?? 0), 0),
      shortCount: shifts.filter((x) => (x.variance ?? 0) < -0.01).length,
      overCount: shifts.filter((x) => (x.variance ?? 0) > 0.01).length,
    };

    const byBranchMap = new Map<
      string,
      {
        branchId: string;
        branchName: string | null;
        shiftCount: number;
        billCount: number;
        grossTotal: number;
        openCashTotal: number;
        closeCashTotal: number;
        expectedCashTotal: number;
        varianceTotal: number;
        shortCount: number;
        overCount: number;
      }
    >();
    for (const x of shifts) {
      const cur = byBranchMap.get(x.branchId) ?? {
        branchId: x.branchId,
        branchName: x.branchName ?? null,
        shiftCount: 0,
        billCount: 0,
        grossTotal: 0,
        openCashTotal: 0,
        closeCashTotal: 0,
        expectedCashTotal: 0,
        varianceTotal: 0,
        shortCount: 0,
        overCount: 0,
      };
      cur.shiftCount += 1;
      cur.billCount += x.billCount;
      cur.grossTotal += x.grossTotal;
      cur.openCashTotal += x.openCash;
      cur.closeCashTotal += x.closeCash ?? 0;
      cur.expectedCashTotal += x.expectedCash ?? 0;
      cur.varianceTotal += x.variance ?? 0;
      if ((x.variance ?? 0) < -0.01) cur.shortCount += 1;
      if ((x.variance ?? 0) > 0.01) cur.overCount += 1;
      if (!cur.branchName && x.branchName) cur.branchName = x.branchName;
      byBranchMap.set(x.branchId, cur);
    }

    const byBranch = [...byBranchMap.values()].sort(
      (a, b) => b.grossTotal - a.grossTotal,
    );

    return { summary, byBranch, shifts };
  }

  async upsertFromSync(payload: SyncedShiftPayload) {
    const existing = await this.database.db
      .select({
        id: pg.shifts.id,
        status: pg.shifts.status,
        cashCountsJson: pg.shifts.cashCountsJson,
        cashMovesJson: pg.shifts.cashMovesJson,
      })
      .from(pg.shifts)
      .where(eq(pg.shifts.id, payload.id))
      .limit(1);
    const wasClosed = existing[0]?.status === "closed";
    // outbox/restore เก่าห้ามเปิดรอบที่ปิดบนเซิร์ฟแล้ว
    if (wasClosed && payload.status !== "closed") {
      return { id: payload.id };
    }

    // กันพนักงานคนเดียวกันเปิดรอบค้างบนเครื่องอื่น
    if (
      payload.status === "open" &&
      (payload.staffId || payload.staffCode) &&
      payload.terminalId
    ) {
      const other = await this.findOpenByStaff({
        staffId: payload.staffId,
        staffCode: payload.staffCode,
        excludeTerminalId: payload.terminalId,
      });
      if (other.open && other.shiftId !== payload.id) {
        const where =
          other.terminalName || other.terminalCode || other.terminalId || "เครื่องอื่น";
        throw new ConflictException(
          `พนักงานคนนี้เปิดรอบอยู่ที่ ${where} แล้ว — ปิดรอบเครื่องนั้นก่อน`,
        );
      }
    }

    const prevFloatIds = new Set(
      parseJson<Array<{ id?: string; purpose?: string }>>(
        existing[0]?.cashCountsJson,
        [],
      )
        .filter((c) => c?.purpose === "float" && c.id)
        .map((c) => String(c.id)),
    );
    const prevMoveIds = new Set(
      parseJson<Array<{ id?: string }>>(existing[0]?.cashMovesJson, [])
        .filter((m) => m?.id)
        .map((m) => String(m.id)),
    );

    const values = {
      id: payload.id,
      branchId: payload.branchId,
      terminalId: payload.terminalId,
      staffId: payload.staffId ?? null,
      staffCode: payload.staffCode ?? null,
      staffName: payload.staffName,
      openedAt: new Date(payload.openedAt),
      closedAt: payload.closedAt ? new Date(payload.closedAt) : null,
      openCash: String(payload.openCash ?? 0),
      closeCash:
        payload.closeCash == null ? null : String(payload.closeCash),
      expectedCash:
        payload.expectedCash == null ? null : String(payload.expectedCash),
      variance: payload.variance == null ? null : String(payload.variance),
      status: payload.status,
      billCount: payload.billCount ?? 0,
      grossTotal: String(payload.grossTotal ?? 0),
      closeNote: payload.closeNote ?? null,
      summaryJson: payload.summary ? JSON.stringify(payload.summary) : null,
      cashMovesJson: JSON.stringify(payload.cashMoves ?? []),
      cashCountsJson: JSON.stringify(payload.cashCounts ?? []),
      updatedAt: new Date(),
    };

    if (existing[0]) {
      await this.database.db
        .update(pg.shifts)
        .set(values)
        .where(eq(pg.shifts.id, payload.id));
    } else {
      await this.database.db.insert(pg.shifts).values(values);
    }

    if (payload.terminalId) {
      await this.terminals.touch(payload.terminalId).catch(() => undefined);
    }

    const moves = Array.isArray(payload.cashMoves) ? payload.cashMoves : [];
    await this.expenses
      .syncFromCashMoves({
        shiftId: payload.id,
        branchId: payload.branchId,
        terminalId: payload.terminalId,
        staffId: payload.staffId,
        staffName: payload.staffName,
        cashMoves: moves as Array<{
          id?: string;
          at?: string;
          staffId?: string;
          staffName?: string;
          direction?: string;
          amount?: number;
          reason?: string;
          note?: string;
        }>,
      })
      .catch(() => undefined);

    // รอบเก่าส่ง audits ใน summary — ย้ายเข้าตารางหลักถ้ายังไม่มี
    const summary = payload.summary as Record<string, unknown> | null | undefined;
    const legacyAudits = Array.isArray(summary?.audits) ? summary.audits : [];
    for (const raw of legacyAudits) {
      const a = raw as Record<string, unknown>;
      if (!a?.id) continue;
      await this.upsertAudit({
        id: String(a.id),
        shiftId: payload.id,
        branchId: payload.branchId,
        terminalId: payload.terminalId,
        staffId: a.staffId == null ? payload.staffId : String(a.staffId),
        staffName: String(a.staffName ?? payload.staffName),
        type: String(a.type ?? "line_void"),
        at: String(a.at ?? a.createdAt ?? payload.openedAt),
        barcode: a.barcode == null ? null : String(a.barcode),
        productName: a.productName == null ? null : String(a.productName),
        qty: a.qty == null ? null : Number(a.qty),
        amount: Number(a.amount ?? 0),
        billTotalBefore:
          a.billTotalBefore == null ? null : Number(a.billTotalBefore),
        itemCountBefore:
          a.itemCountBefore == null ? null : Number(a.itemCountBefore),
      }).catch(() => undefined);
    }

    // Discord — เปิดรอบ / นับทอน / เข้า-ออกเงิน / ปิดรอบ (กัน sync ซ้ำ)
    if (payload.status === "open" && !existing[0]) {
      void this.notify.notifyShiftOpen(payload);
    }
    if (payload.status === "open" && existing[0] && !wasClosed) {
      const newFloat = (Array.isArray(payload.cashCounts) ? payload.cashCounts : [])
        .filter((c) => {
          const row = c as { id?: string; purpose?: string };
          return (
            row?.purpose === "float" &&
            row.id &&
            !prevFloatIds.has(String(row.id))
          );
        });
      if (newFloat.length) {
        void this.notify.notifyFloatCount(payload);
      }

      const newMoves = (Array.isArray(payload.cashMoves) ? payload.cashMoves : [])
        .filter((m) => {
          const row = m as { id?: string };
          return row?.id && !prevMoveIds.has(String(row.id));
        }) as Array<{
          id?: string;
          direction?: string;
          amount?: number;
          reason?: string;
          note?: string;
          at?: string;
          staffName?: string;
        }>;
      for (const move of newMoves) {
        void this.notify.notifyCashMove(
          {
            branchId: payload.branchId,
            staffName: payload.staffName,
            terminalId: payload.terminalId,
            terminalName: payload.terminalName,
          },
          move,
        );
      }
    }
    if (payload.status === "closed" && !wasClosed) {
      void this.notify.notifyShiftClose(payload);
    }

    return { id: payload.id };
  }

  async acceptMany(shifts: SyncedShiftPayload[]) {
    const accepted: string[] = [];
    const rejected: Array<{ id: string; message: string }> = [];
    for (const s of shifts) {
      try {
        await this.upsertFromSync(s);
        accepted.push(s.id);
      } catch (e) {
        if (e instanceof ConflictException) {
          const res = e.getResponse();
          const raw =
            typeof res === "string"
              ? res
              : Array.isArray((res as { message?: unknown }).message)
                ? (res as { message: string[] }).message.join(", ")
                : String(
                    (res as { message?: string }).message ??
                      e.message ??
                      "พนักงานเปิดรอบอยู่เครื่องอื่นแล้ว",
                  );
          rejected.push({ id: s.id, message: raw });
          continue;
        }
        throw e;
      }
    }
    return { accepted, rejected };
  }

  /**
   * ยอดขายรอบปิดแล้วของพนักงานในวันเดียวกัน (โซน Asia/Bangkok)
   * ใช้คำนวณค่าคอมต่อวันตอนปิดรอบ
   */
  async priorClosedGrossToday(opts: {
    staffId: string;
    excludeShiftId?: string;
  }) {
    const { staffId, excludeShiftId } = opts;
    if (!staffId) return { priorGrossTotal: 0, shiftCount: 0 };

    // ขอบเขตวันในไทย: 00:00–24:00 Asia/Bangkok → UTC
    const fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Bangkok",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const day = fmt.format(new Date()); // YYYY-MM-DD
    const start = new Date(`${day}T00:00:00+07:00`);
    const end = new Date(`${day}T23:59:59.999+07:00`);

    const rows = await this.database.db
      .select({
        id: pg.shifts.id,
        grossTotal: pg.shifts.grossTotal,
      })
      .from(pg.shifts)
      .where(
        and(
          eq(pg.shifts.staffId, staffId),
          eq(pg.shifts.status, "closed"),
          gte(pg.shifts.openedAt, start),
          lte(pg.shifts.openedAt, end),
        ),
      );

    let priorGrossTotal = 0;
    let shiftCount = 0;
    for (const row of rows) {
      if (excludeShiftId && row.id === excludeShiftId) continue;
      priorGrossTotal += num(row.grossTotal);
      shiftCount += 1;
    }
    return { priorGrossTotal, shiftCount, day };
  }

  /**
   * สรุปค่าคอมรายเดือน — รวมต่อคน + รายวัน
   * คิดตามกฎปัจจุบันของพนักงาน จากยอดขายรอบปิดต่อวัน (Asia/Bangkok)
   */
  async commissionReport(opts: {
    year: number;
    month: number;
    branchId?: string;
    staffId?: string;
  }) {
    const year = Math.max(2000, Math.min(2100, Math.floor(opts.year)));
    const month = Math.max(1, Math.min(12, Math.floor(opts.month)));
    const ym = `${year}-${String(month).padStart(2, "0")}`;
    const lastDay = new Date(year, month, 0).getDate();
    const from = new Date(`${ym}-01T00:00:00+07:00`);
    const to = new Date(
      `${ym}-${String(lastDay).padStart(2, "0")}T23:59:59.999+07:00`,
    );

    const dayFmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Bangkok",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });

    const shiftConditions = [
      eq(pg.shifts.status, "closed"),
      gte(pg.shifts.openedAt, from),
      lte(pg.shifts.openedAt, to),
    ];
    if (opts.branchId) {
      shiftConditions.push(eq(pg.shifts.branchId, opts.branchId));
    }
    if (opts.staffId) {
      shiftConditions.push(eq(pg.shifts.staffId, opts.staffId));
    }

    const shiftRows = await this.database.db
      .select()
      .from(pg.shifts)
      .where(and(...shiftConditions))
      .orderBy(desc(pg.shifts.openedAt));

    const staffRows = await this.database.db
      .select()
      .from(pg.staff)
      .where(isNull(pg.staff.deletedAt));

    type StaffCfg = {
      id: string;
      code: string;
      name: string;
      enabled: boolean;
      startSales: number;
      stepSales: number;
      amountPerStep: number;
      dailyWage: number;
      active: boolean;
    };

    const staffById = new Map<string, StaffCfg>();
    for (const s of staffRows) {
      if (s.code === "admin") continue;
      staffById.set(s.id, {
        id: s.id,
        code: s.code,
        name: s.name,
        enabled: Boolean(s.commissionEnabled),
        startSales: num(s.commissionStartSales, 8000),
        stepSales: num(s.commissionStepSales, 1000),
        amountPerStep: num(s.commissionPerStep, 100),
        dailyWage: num(s.dailyWage, 0),
        active: Boolean(s.active),
      });
    }

    // รวมยอดขายต่อคนต่อวัน + รายละเอียดรอบ
    type DayBucket = {
      date: string;
      daySales: number;
      shiftCount: number;
      shifts: Array<{
        id: string;
        openedAt: string;
        closedAt: string | null;
        branchId: string;
        terminalId: string;
        grossTotal: number;
        billCount: number;
      }>;
    };

    const byStaffDay = new Map<string, Map<string, DayBucket>>();

    const ensureStaff = (id: string, code: string | null, name: string) => {
      if (staffById.has(id)) return staffById.get(id)!;
      const cfg: StaffCfg = {
        id,
        code: code || id.slice(0, 8),
        name: name || "พนักงาน",
        enabled: false,
        startSales: 8000,
        stepSales: 1000,
        amountPerStep: 100,
        dailyWage: 0,
        active: true,
      };
      staffById.set(id, cfg);
      return cfg;
    };

    for (const row of shiftRows) {
      const staffId = row.staffId || `name:${row.staffName}`;
      const cfg = row.staffId
        ? ensureStaff(row.staffId, row.staffCode, row.staffName)
        : ensureStaff(staffId, row.staffCode, row.staffName);

      // ถ้ายังไม่เปิดคอมใน master แต่มี summary.commission จากรอบ — เปิดตาม snapshot
      const summary = parseJson<Record<string, unknown> | null>(
        row.summaryJson,
        null,
      );
      const snap = summary?.commission as
        | {
            startSales?: number;
            stepSales?: number;
            amountPerStep?: number;
          }
        | undefined;
      if (!cfg.enabled && snap?.amountPerStep) {
        cfg.enabled = true;
        cfg.startSales = num(snap.startSales, cfg.startSales);
        cfg.stepSales = num(snap.stepSales, cfg.stepSales);
        cfg.amountPerStep = num(snap.amountPerStep, cfg.amountPerStep);
      }

      const day = dayFmt.format(row.openedAt);
      if (!byStaffDay.has(staffId)) byStaffDay.set(staffId, new Map());
      const days = byStaffDay.get(staffId)!;
      if (!days.has(day)) {
        days.set(day, {
          date: day,
          daySales: 0,
          shiftCount: 0,
          shifts: [],
        });
      }
      const bucket = days.get(day)!;
      const gross = num(row.grossTotal);
      bucket.daySales += gross;
      bucket.shiftCount += 1;
      bucket.shifts.push({
        id: row.id,
        openedAt: row.openedAt.toISOString(),
        closedAt: row.closedAt?.toISOString() ?? null,
        branchId: row.branchId,
        terminalId: row.terminalId,
        grossTotal: gross,
        billCount: row.billCount ?? 0,
      });
    }

    // คนที่เปิดคอม / มีค่าแรงรายวัน — ใส่รายการแม้ไม่มีรอบในเดือน
    for (const cfg of staffById.values()) {
      if (opts.staffId && cfg.id !== opts.staffId) continue;
      if (!cfg.enabled && cfg.dailyWage <= 0) continue;
      if (!byStaffDay.has(cfg.id)) byStaffDay.set(cfg.id, new Map());
    }

    const fromDate = ym + "-01";
    const toDate = `${ym}-${String(lastDay).padStart(2, "0")}`;
    const wageOverrideConds = [
      gte(pg.staffDayWages.workDate, fromDate),
      lte(pg.staffDayWages.workDate, toDate),
    ];
    if (opts.staffId) {
      wageOverrideConds.push(eq(pg.staffDayWages.staffId, opts.staffId));
    }
    const wageOverrideRows = await this.database.db
      .select()
      .from(pg.staffDayWages)
      .where(and(...wageOverrideConds));
    const wageOverride = new Map<string, { wage: number; note: string | null }>();
    for (const row of wageOverrideRows) {
      wageOverride.set(`${row.staffId}|${row.workDate}`, {
        wage: Math.round(num(row.wage, 0) * 100) / 100,
        note: row.note ?? null,
      });
    }

    const people = [];
    for (const [staffId, daysMap] of byStaffDay) {
      const cfg = staffById.get(staffId);
      if (!cfg) continue;
      if (opts.staffId && cfg.id !== opts.staffId) continue;

      const baseDailyWage = Math.round(cfg.dailyWage * 100) / 100;
      const days = [...daysMap.values()]
        .sort((a, b) => b.date.localeCompare(a.date))
        .map((d) => {
          const calc = calcDailyCommission(d.daySales, {
            enabled: cfg.enabled,
            startSales: cfg.startSales,
            stepSales: cfg.stepSales,
            amountPerStep: cfg.amountPerStep,
          });
          const ov = wageOverride.get(`${staffId}|${d.date}`);
          const wageDefault = dailyWageForDate(d.date, baseDailyWage);
          const wage = ov != null ? ov.wage : wageDefault;
          return {
            date: d.date,
            daySales: Math.round(d.daySales * 100) / 100,
            shiftCount: d.shiftCount,
            wage,
            wageDefault,
            wageAdjusted: ov != null,
            wageNote: ov?.note ?? null,
            commission: calc.amount,
            steps: calc.steps,
            dayIncome: Math.round((wage + calc.amount) * 100) / 100,
            shifts: d.shifts,
          };
        });

      const salesTotal = days.reduce((s, d) => s + d.daySales, 0);
      const commissionTotal = days.reduce((s, d) => s + d.commission, 0);
      const daysWithPay = days.filter((d) => d.commission > 0).length;
      const dayCount = days.length;
      const wageTotal =
        Math.round(days.reduce((s, d) => s + d.wage, 0) * 100) / 100;
      const incomeTotal =
        Math.round((wageTotal + commissionTotal) * 100) / 100;

      // ซ่อนคนที่ไม่มีค่าแรง ไม่เปิดคอม และไม่มียอดในเดือน
      if (
        baseDailyWage <= 0 &&
        !cfg.enabled &&
        salesTotal <= 0 &&
        commissionTotal <= 0 &&
        wageTotal <= 0
      ) {
        continue;
      }

      people.push({
        staffId: cfg.id,
        staffCode: cfg.code,
        staffName: cfg.name,
        active: cfg.active,
        commissionEnabled: cfg.enabled,
        rule: formatCommissionRule({
          enabled: cfg.enabled,
          startSales: cfg.startSales,
          stepSales: cfg.stepSales,
          amountPerStep: cfg.amountPerStep,
        }),
        startSales: cfg.startSales,
        stepSales: cfg.stepSales,
        amountPerStep: cfg.amountPerStep,
        dailyWage: baseDailyWage,
        dayCount,
        daysWithPay,
        shiftCount: days.reduce((s, d) => s + d.shiftCount, 0),
        salesTotal: Math.round(salesTotal * 100) / 100,
        wageTotal,
        commissionTotal,
        incomeTotal,
        days,
      });
    }

    people.sort(
      (a, b) =>
        b.incomeTotal - a.incomeTotal ||
        a.staffName.localeCompare(b.staffName, "th"),
    );

    const summary = {
      year,
      month,
      from: from.toISOString(),
      to: to.toISOString(),
      staffCount: people.length,
      staffWithPay: people.filter((p) => p.commissionTotal > 0).length,
      salesTotal:
        Math.round(people.reduce((s, p) => s + p.salesTotal, 0) * 100) / 100,
      wageTotal:
        Math.round(people.reduce((s, p) => s + p.wageTotal, 0) * 100) / 100,
      commissionTotal: people.reduce((s, p) => s + p.commissionTotal, 0),
      incomeTotal:
        Math.round(people.reduce((s, p) => s + p.incomeTotal, 0) * 100) / 100,
      shiftCount: people.reduce((s, p) => s + p.shiftCount, 0),
    };

    return { summary, people };
  }

  /** ปรับ/ล้างค่าแรงของวันนั้น (เช่น ครึ่งวัน) */
  async upsertDayWage(dto: {
    staffId: string;
    date: string;
    wage: number | null;
    note?: string | null;
  }) {
    const staffId = dto.staffId?.trim();
    const date = dto.date?.trim();
    if (!staffId) throw new BadRequestException("ต้องระบุพนักงาน");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "")) {
      throw new BadRequestException("วันที่ต้องเป็น YYYY-MM-DD");
    }

    const staffRows = await this.database.db
      .select()
      .from(pg.staff)
      .where(and(eq(pg.staff.id, staffId), isNull(pg.staff.deletedAt)))
      .limit(1);
    if (!staffRows[0]) throw new NotFoundException("ไม่พบพนักงาน");

    const existing = await this.database.db
      .select()
      .from(pg.staffDayWages)
      .where(
        and(
          eq(pg.staffDayWages.staffId, staffId),
          eq(pg.staffDayWages.workDate, date),
        ),
      )
      .limit(1);

    // wage = null → ล้างค่าปรับ กลับไปใช้อัตรามาตรฐาน (อาทิตย์ = 800)
    if (dto.wage == null || Number.isNaN(Number(dto.wage))) {
      if (existing[0]) {
        await this.database.db
          .delete(pg.staffDayWages)
          .where(eq(pg.staffDayWages.id, existing[0].id));
      }
      const wageDefault = dailyWageForDate(
        date!,
        num(staffRows[0].dailyWage, 0),
      );
      return {
        staffId,
        date,
        wage: wageDefault,
        wageDefault,
        wageAdjusted: false,
        note: null,
      };
    }

    const wage = Math.max(0, Math.round(Number(dto.wage) * 100) / 100);
    const note = dto.note?.trim() || null;
    const now = new Date();
    if (existing[0]) {
      await this.database.db
        .update(pg.staffDayWages)
        .set({
          wage: String(wage),
          note,
          updatedAt: now,
        })
        .where(eq(pg.staffDayWages.id, existing[0].id));
    } else {
      await this.database.db.insert(pg.staffDayWages).values({
        id: `sdw-${randomUUID().slice(0, 10)}`,
        staffId,
        workDate: date,
        wage: String(wage),
        note,
        updatedAt: now,
      });
    }

    return {
      staffId,
      date,
      wage,
      wageDefault: dailyWageForDate(date!, num(staffRows[0].dailyWage, 0)),
      wageAdjusted: true,
      note,
    };
  }
}
