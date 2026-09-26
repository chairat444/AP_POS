import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  forwardRef,
} from "@nestjs/common";
import { and, asc, eq, gte, isNull, lte, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { pg } from "@ap-pos/db";
import { DatabaseService } from "../db/database.service";
import { ShiftsService } from "../shifts/shifts.service";
import { calcDailyCommission } from "@ap-pos/shared";
import type {
  CashBookDaySummary,
  CashBookDirection,
  CashBookEntryRecord,
  CashBookKind,
  CashBookMonthReport,
  UpsertCashBookEntryDto,
} from "./cash-book.types";

/** ค่าแรง ปอ: 500 ก่อนกลางเดือน 8 แล้วเป็น 800 */
const OWNER_DAILY_BAHT_OLD = 500;
const OWNER_DAILY_BAHT_NEW = 800;
/** เริ่มคิด 800 ตั้งแต่วันนี้ (ประมาณกลางเดือน 8) */
const OWNER_RATE_FROM = "2026-08-16";
/** ค่าเช่าต่อสาขา ต่อวัน — เฉพาะสาขาที่เปิดแล้ว */
const RENT_PER_BRANCH_BAHT = 500;
/** สาขาที่ยังไม่เปิด ไม่คิดค่าเช่าอัตโนมัติ */
const RENT_EXCLUDED_BRANCH_IDS = new Set(["branch-003"]);

/** ค่าแรงแอ๊ด รายวัน (แก้/ลบได้) */
const AD_WAGE_BAHT = 300;
/** ค่าไปโรงเรียนลูก จ–ศ (แก้/ลบได้) */
const SCHOOL_FEE_BAHT = 160;

/**
 * ค่าแรง+คอมก่อนขึ้นระบบ (ยังไม่มีรอบของพนักงานจริง)
 * เจ็ดเสมียน → พลอย · หลุมดิน → นุ่น
 * คิดจากยอดขายสาขา ถ้าวันนั้นยังไม่มีรายการจากรอบของคนนี้
 */
const PRE_SYSTEM_BRANCH_STAFF: Array<{
  branchId: string;
  staffId: string;
  fromDay: string;
  untilDay: string;
}> = [
  {
    branchId: "branch-002",
    staffId: "staff-002-ap",
    fromDay: "2026-03-31",
    untilDay: "2026-08-29",
  },
  {
    branchId: "branch-001",
    staffId: "staff-002-ap2",
    fromDay: "2026-03-31",
    untilDay: "2026-09-04",
  },
];

function ownerDailyBaht(day: string) {
  return day >= OWNER_RATE_FROM ? OWNER_DAILY_BAHT_NEW : OWNER_DAILY_BAHT_OLD;
}

/** จ–ศ ตามปฏิทินไทย (0=อา … 6=ส) */
function bangkokWeekday(day: string) {
  const label = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Bangkok",
    weekday: "short",
  }).format(new Date(`${day}T12:00:00+07:00`));
  const map: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return map[label] ?? 0;
}

function isBangkokWeekday(day: string) {
  const w = bangkokWeekday(day);
  return w >= 1 && w <= 5;
}

function isBangkokSunday(day: string) {
  return bangkokWeekday(day) === 0;
}

function num(v: unknown, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function now() {
  return new Date();
}

function bangkokToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function isIsoDay(v: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(v);
}

function isIsoMonth(v: string) {
  return /^\d{4}-\d{2}$/.test(v);
}

function daysInMonth(month: string) {
  const [y, m] = month.split("-").map(Number);
  return new Date(y!, m!, 0).getDate();
}

function lastAutoDayInMonth(month: string) {
  const today = bangkokToday();
  const last = daysInMonth(month);
  if (month > today.slice(0, 7)) return 0;
  if (month < today.slice(0, 7)) return last;
  return Number(today.slice(8, 10));
}

type AutoLine = {
  sourceKey: string;
  entryDate: string;
  direction: CashBookDirection;
  kind: CashBookKind;
  branchId?: string | null;
  amount: number;
  description: string;
  note?: string | null;
  /**
   * sync = เขียนทับทุกครั้ง (ยอดขาย/ค่าแรงระบบ)
   * flex = สร้างครั้งเดียว แก้/ลบได้ ไม่เขียนทับ
   */
  mode?: "sync" | "flex";
};

@Injectable()
export class CashBookService {
  constructor(
    private readonly database: DatabaseService,
    @Inject(forwardRef(() => ShiftsService))
    private readonly shifts: ShiftsService,
  ) {}

  private toRecord(
    row: typeof pg.cashBookEntries.$inferSelect,
    names?: { branchName?: string | null; categoryName?: string | null },
  ): CashBookEntryRecord {
    const sourceKey = row.sourceKey ?? null;
    return {
      id: row.id,
      entryDate: row.entryDate,
      direction: row.direction as CashBookDirection,
      kind: row.kind as CashBookKind,
      branchId: row.branchId ?? null,
      branchName: names?.branchName ?? null,
      categoryId: row.categoryId ?? null,
      categoryName: names?.categoryName ?? null,
      amount: num(row.amount),
      description: row.description ?? null,
      note: row.note ?? null,
      sourceKey,
      auto: Boolean(sourceKey),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private validateDto(dto: UpsertCashBookEntryDto) {
    if (!isIsoDay(dto.entryDate)) {
      throw new BadRequestException("วันที่ไม่ถูกต้อง");
    }
    if (dto.direction !== "in" && dto.direction !== "out") {
      throw new BadRequestException("ทิศทางต้องเป็น in หรือ out");
    }
    const kind = dto.kind;
    if (!["sale", "loan", "expense", "other"].includes(kind)) {
      throw new BadRequestException("ชนิดรายการไม่ถูกต้อง");
    }
    const amount = Math.round(num(dto.amount) * 100) / 100;
    if (!(amount > 0)) throw new BadRequestException("จำนวนเงินต้องมากกว่า 0");

    if (kind === "sale") {
      if (dto.direction !== "in") {
        throw new BadRequestException("รายได้ต้องเป็นเงินเข้า");
      }
      if (!dto.branchId?.trim()) {
        throw new BadRequestException("เลือกรายได้ต้องระบุสาขา");
      }
    }
    if (kind === "expense" && dto.direction !== "out") {
      throw new BadRequestException("ค่าใช้จ่ายต้องเป็นเงินออก");
    }
    // loan: เข้า = ยืมจากเจ้าของ · ออก = คืนเจ้าของ
    if (kind === "loan" || kind === "other") {
      if (!String(dto.description ?? "").trim()) {
        throw new BadRequestException("กรอกรายละเอียด");
      }
    }
    if (kind === "expense" && !dto.categoryId?.trim()) {
      if (!String(dto.description ?? "").trim()) {
        throw new BadRequestException("เลือกประเภท หรือกรอกรายละเอียด");
      }
    }
    return amount;
  }

  private async activeBranches() {
    const rows = await this.database.db
      .select({ id: pg.branches.id, name: pg.branches.name })
      .from(pg.branches)
      .where(and(eq(pg.branches.active, 1), isNull(pg.branches.deletedAt)))
      .orderBy(asc(pg.branches.name));
    return rows;
  }

  /** สาขาที่เปิดแล้ว — ใช้คิดค่าเช่ารายวัน */
  private async rentBranches() {
    const rows = await this.activeBranches();
    return rows.filter((b) => !RENT_EXCLUDED_BRANCH_IDS.has(b.id));
  }

  private async salesByBranchForDay(day: string) {
    const start = new Date(`${day}T00:00:00+07:00`);
    const end = new Date(`${day}T23:59:59.999+07:00`);
    const rows = await this.database.db
      .select({
        branchId: pg.sales.branchId,
        branchName: pg.branches.name,
        method: pg.salePayments.method,
        amount: sql<string>`sum(${pg.salePayments.amount})`,
        billCount: sql<number>`count(distinct ${pg.sales.id})::int`,
      })
      .from(pg.salePayments)
      .innerJoin(pg.sales, eq(pg.salePayments.saleId, pg.sales.id))
      .leftJoin(pg.branches, eq(pg.sales.branchId, pg.branches.id))
      .where(
        and(
          eq(pg.sales.status, "completed"),
          gte(pg.sales.createdAt, start),
          lte(pg.sales.createdAt, end),
        ),
      )
      .groupBy(pg.sales.branchId, pg.branches.name, pg.salePayments.method);

    type Agg = {
      branchId: string;
      branchName: string;
      cash: number;
      transfer: number;
      government: number;
      transferBills: number;
      billCount: number;
    };
    const map = new Map<string, Agg>();
    for (const r of rows) {
      const cur = map.get(r.branchId) ?? {
        branchId: r.branchId,
        branchName: r.branchName ?? r.branchId,
        cash: 0,
        transfer: 0,
        government: 0,
        transferBills: 0,
        billCount: 0,
      };
      const amount = Math.round(num(r.amount) * 100) / 100;
      const bills = Number(r.billCount) || 0;
      if (r.method === "cash") cur.cash += amount;
      else if (r.method === "transfer") {
        cur.transfer += amount;
        cur.transferBills += bills;
      } else if (r.method === "government") cur.government += amount;
      cur.billCount = Math.max(cur.billCount, bills);
      map.set(r.branchId, cur);
    }

    return [...map.values()]
      .map((r) => ({
        ...r,
        cash: Math.round(r.cash * 100) / 100,
        transfer: Math.round(r.transfer * 100) / 100,
        government: Math.round(r.government * 100) / 100,
        transferBills: r.transferBills,
        amount: Math.round((r.cash + r.transfer + r.government) * 100) / 100,
      }))
      .filter((r) => r.amount > 0);
  }

  /** จำนวนบิลเงินโอน ต่อวัน×สาขา ในเดือน */
  private async transferBillsByDayBranch(month: string) {
    const from = `${month}-01`;
    const to = `${month}-${String(daysInMonth(month)).padStart(2, "0")}`;
    const start = new Date(`${from}T00:00:00+07:00`);
    const end = new Date(`${to}T23:59:59.999+07:00`);
    const dayFmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Bangkok",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const rows = await this.database.db
      .select({
        createdAt: pg.sales.createdAt,
        branchId: pg.sales.branchId,
        saleId: pg.sales.id,
      })
      .from(pg.salePayments)
      .innerJoin(pg.sales, eq(pg.salePayments.saleId, pg.sales.id))
      .where(
        and(
          eq(pg.sales.status, "completed"),
          eq(pg.salePayments.method, "transfer"),
          gte(pg.sales.createdAt, start),
          lte(pg.sales.createdAt, end),
        ),
      );

    const map = new Map<string, Set<string>>();
    for (const r of rows) {
      const day = dayFmt.format(r.createdAt);
      const key = `${day}:${r.branchId}`;
      if (!map.has(key)) map.set(key, new Set());
      map.get(key)!.add(r.saleId);
    }
    const out = new Map<string, number>();
    for (const [k, ids] of map) out.set(k, ids.size);
    return out;
  }

  private async staffPayForDay(day: string) {
    const [y, m] = day.split("-").map(Number);
    const report = await this.shifts.commissionReport({
      year: y!,
      month: m!,
    });
    const out: Array<{
      staffId: string;
      staffName: string;
      wage: number;
      commission: number;
      amount: number;
      note?: string | null;
    }> = [];
    for (const person of report.people) {
      const d = person.days.find((x) => x.date === day);
      if (!d) continue;
      const amount = Math.round((d.wage + d.commission) * 100) / 100;
      if (amount <= 0) continue;
      out.push({
        staffId: person.staffId,
        staffName: person.staffName,
        wage: d.wage,
        commission: d.commission,
        amount,
      });
    }
    const pre = await this.preSystemStaffPayForDay(day, new Set(out.map((p) => p.staffId)));
    return [...out, ...pre];
  }

  /** ยอดขายสาขา (บาท) ของวัน — สำหรับค่าแรงก่อนขึ้นระบบ */
  private async branchSalesTotalForDay(day: string, branchId: string) {
    const start = new Date(`${day}T00:00:00+07:00`);
    const end = new Date(`${day}T23:59:59.999+07:00`);
    const rows = await this.database.db
      .select({
        total: sql<string>`coalesce(sum(${pg.sales.total}), 0)`,
      })
      .from(pg.sales)
      .where(
        and(
          eq(pg.sales.status, "completed"),
          eq(pg.sales.branchId, branchId),
          gte(pg.sales.createdAt, start),
          lte(pg.sales.createdAt, end),
        ),
      );
    return Math.round(num(rows[0]?.total) * 100) / 100;
  }

  private async loadStaffPayConfig(staffId: string) {
    const rows = await this.database.db
      .select({
        id: pg.staff.id,
        name: pg.staff.name,
        dailyWage: pg.staff.dailyWage,
        commissionEnabled: pg.staff.commissionEnabled,
        commissionStartSales: pg.staff.commissionStartSales,
        commissionStepSales: pg.staff.commissionStepSales,
        commissionPerStep: pg.staff.commissionPerStep,
      })
      .from(pg.staff)
      .where(and(eq(pg.staff.id, staffId), isNull(pg.staff.deletedAt)))
      .limit(1);
    const s = rows[0];
    if (!s) return null;
    return {
      id: s.id,
      name: s.name,
      dailyWage: Math.round(num(s.dailyWage) * 100) / 100,
      enabled: Boolean(s.commissionEnabled),
      startSales: num(s.commissionStartSales, 8000),
      stepSales: num(s.commissionStepSales, 1000),
      amountPerStep: num(s.commissionPerStep, 100),
    };
  }

  private async preSystemStaffPayForDay(
    day: string,
    alreadyPaid: Set<string>,
  ) {
    const out: Array<{
      staffId: string;
      staffName: string;
      wage: number;
      commission: number;
      amount: number;
      note?: string | null;
    }> = [];

    for (const rule of PRE_SYSTEM_BRANCH_STAFF) {
      if (day < rule.fromDay || day > rule.untilDay) continue;
      if (alreadyPaid.has(rule.staffId)) continue;

      const daySales = await this.branchSalesTotalForDay(day, rule.branchId);
      if (daySales <= 0) continue;

      const cfg = await this.loadStaffPayConfig(rule.staffId);
      if (!cfg) continue;

      const wage = isBangkokSunday(day)
        ? 800
        : cfg.dailyWage;
      const commission = calcDailyCommission(daySales, {
        enabled: cfg.enabled,
        startSales: cfg.startSales,
        stepSales: cfg.stepSales,
        amountPerStep: cfg.amountPerStep,
      }).amount;
      const amount = Math.round((wage + commission) * 100) / 100;
      if (amount <= 0) continue;

      out.push({
        staffId: cfg.id,
        staffName: cfg.name,
        wage,
        commission,
        amount,
        note: `ก่อนขึ้นระบบ · ยอดขายสาขา ${daySales.toFixed(2)}`,
      });
      alreadyPaid.add(rule.staffId);
    }
    return out;
  }

  private async drawerExpensesForDay(day: string) {
    const start = new Date(`${day}T00:00:00+07:00`);
    const end = new Date(`${day}T23:59:59.999+07:00`);
    const rows = await this.database.db
      .select({
        id: pg.expenses.id,
        branchId: pg.expenses.branchId,
        amount: pg.expenses.amount,
        description: pg.expenses.description,
        categoryName: pg.expenseCategories.name,
      })
      .from(pg.expenses)
      .leftJoin(
        pg.expenseCategories,
        eq(pg.expenses.categoryId, pg.expenseCategories.id),
      )
      .where(
        and(
          isNull(pg.expenses.deletedAt),
          eq(pg.expenses.paidFrom, "drawer"),
          gte(pg.expenses.spentAt, start),
          lte(pg.expenses.spentAt, end),
        ),
      );

    return rows
      .map((r) => ({
        id: r.id,
        branchId: r.branchId,
        amount: Math.round(num(r.amount) * 100) / 100,
        description:
          (r.description || "").trim() ||
          r.categoryName ||
          "จ่ายจากลิ้นชัก",
      }))
      .filter((r) => r.amount > 0);
  }

  private buildAutoLines(opts: {
    day: string;
    branches: Array<{ id: string; name: string }>;
    sales: Array<{
      branchId: string;
      branchName: string;
      cash: number;
      transfer: number;
      government: number;
      amount: number;
      billCount: number;
    }>;
    staffPay: Array<{
      staffId: string;
      staffName: string;
      wage: number;
      commission: number;
      amount: number;
      note?: string | null;
    }>;
    drawerExpenses?: Array<{
      id: string;
      branchId: string | null;
      amount: number;
      description: string;
    }>;
  }): AutoLine[] {
    const { day, branches, sales, staffPay, drawerExpenses = [] } = opts;
    const lines: AutoLine[] = [];

    for (const s of sales) {
      if (s.cash > 0) {
        lines.push({
          sourceKey: `auto:sale:cash:${day}:${s.branchId}`,
          entryDate: day,
          direction: "in",
          kind: "sale",
          branchId: s.branchId,
          amount: s.cash,
          description: "เงินสด",
          note: `ยอดขาย ${s.branchName}`,
        });
      }
      if (s.transfer > 0) {
        lines.push({
          sourceKey: `auto:sale:xfer:${day}:${s.branchId}`,
          entryDate: day,
          direction: "in",
          kind: "sale",
          branchId: s.branchId,
          amount: s.transfer,
          description: "เงินโอน",
          note: `ยอดขาย ${s.branchName}`,
        });
      }
      if (s.government > 0) {
        lines.push({
          sourceKey: `auto:sale:gov:${day}:${s.branchId}`,
          entryDate: day,
          direction: "in",
          kind: "sale",
          branchId: s.branchId,
          amount: s.government,
          description: "สวัสดิการ",
          note: `ยอดขาย ${s.branchName}`,
        });
      }
    }

    // ชีทบัญชีไม่มีค่าแรง/เจ้าของ/ค่าเช่า — ใส่จากระบบเสมอ
    for (const p of staffPay) {
      const parts: string[] = [];
      if (p.wage > 0) parts.push(`ค่าแรง ${p.wage.toFixed(2)}`);
      if (p.commission > 0) parts.push(`คอม ${p.commission.toFixed(2)}`);
      lines.push({
        sourceKey: `auto:staff:${day}:${p.staffId}`,
        entryDate: day,
        direction: "out",
        kind: "expense",
        amount: p.amount,
        description: `ค่าแรง+คอม · ${p.staffName}`,
        note:
          p.note?.trim() ||
          parts.join(" · ") ||
          "อัตโนมัติจากรอบขาย",
      });
    }

    lines.push({
      sourceKey: `auto:owner:${day}`,
      entryDate: day,
      direction: "out",
      kind: "expense",
      amount: ownerDailyBaht(day),
      description: "ค่าแรง · ปอ",
      note:
        day >= OWNER_RATE_FROM
          ? "อัตโนมัติรายวัน 800 (ตั้งแต่กลางเดือน 8)"
          : "อัตโนมัติรายวัน 500 (ก่อนกลางเดือน 8)",
    });

    // รายจ่ายประจำที่แก้/ลบได้ — ไม่เขียนทับถ้าเคยแก้แล้ว
    lines.push({
      sourceKey: `auto:flex:ad-wage:${day}`,
      entryDate: day,
      direction: "out",
      kind: "expense",
      amount: AD_WAGE_BAHT,
      description: "ค่าแรง · แอ๊ด",
      note: "ประจำรายวัน 300 · แก้/ลบได้",
      mode: "flex",
    });
    if (isBangkokWeekday(day)) {
      lines.push({
        sourceKey: `auto:flex:school:${day}`,
        entryDate: day,
        direction: "out",
        kind: "expense",
        amount: SCHOOL_FEE_BAHT,
        description: "ค่าไปโรงเรียนลูก",
        note: "จ–ศ วันละ 160 · แก้/ลบได้",
        mode: "flex",
      });
    }

    for (const b of branches) {
      if (RENT_EXCLUDED_BRANCH_IDS.has(b.id)) continue;
      lines.push({
        sourceKey: `auto:rent:${day}:${b.id}`,
        entryDate: day,
        direction: "out",
        kind: "expense",
        branchId: b.id,
        amount: RENT_PER_BRANCH_BAHT,
        description: `ค่าเช่า · ${b.name}`,
        note: "อัตโนมัติรายวัน สาขาละ 500",
      });
    }

    // จ่ายจากลิ้นชัก POS → สมุดรายวัน (ต้นทางอยู่ที่เมนูค่าใช้จ่าย)
    for (const e of drawerExpenses) {
      lines.push({
        sourceKey: `auto:drawer-exp:${e.id}`,
        entryDate: day,
        direction: "out",
        kind: "expense",
        branchId: e.branchId,
        amount: e.amount,
        description: e.description,
        note: "อัตโนมัติจากค่าใช้จ่ายลิ้นชัก",
      });
    }

    return lines;
  }

  private async upsertAutoLine(line: AutoLine) {
    const existing = await this.database.db
      .select()
      .from(pg.cashBookEntries)
      .where(eq(pg.cashBookEntries.sourceKey, line.sourceKey))
      .limit(1);

    if (existing[0]) {
      // flex: คงค่าที่ผู้ใช้แก้/ลบไว้ ไม่เขียนทับ ไม่กู้คืน
      if (line.mode === "flex") return;

      await this.database.db
        .update(pg.cashBookEntries)
        .set({
          entryDate: line.entryDate,
          direction: line.direction,
          kind: line.kind,
          branchId: line.branchId?.trim() || null,
          amount: String(line.amount),
          description: line.description,
          note: line.note ?? null,
          updatedAt: now(),
          deletedAt: null,
        })
        .where(eq(pg.cashBookEntries.id, existing[0].id));
      return;
    }

    await this.database.db.insert(pg.cashBookEntries).values({
      id: `cbe-${randomUUID().slice(0, 10)}`,
      entryDate: line.entryDate,
      direction: line.direction,
      kind: line.kind,
      branchId: line.branchId?.trim() || null,
      categoryId: null,
      amount: String(line.amount),
      description: line.description,
      note: line.note ?? null,
      sourceKey: line.sourceKey,
      updatedAt: now(),
      deletedAt: null,
    });
  }

  private drawerExpenseSourceKey(expenseId: string) {
    return `auto:drawer-exp:${expenseId}`;
  }

  private async softDeleteBySourceKey(sourceKey: string) {
    await this.database.db
      .update(pg.cashBookEntries)
      .set({ deletedAt: now(), updatedAt: now() })
      .where(
        and(
          eq(pg.cashBookEntries.sourceKey, sourceKey),
          isNull(pg.cashBookEntries.deletedAt),
        ),
      );
  }

  /**
   * ซิงก์ค่าใช้จ่ายลิ้นชักเข้าสมุดทันทีตอนสร้าง/แก้/ลบ
   * (ensureAuto ยัง backfill ได้ถ้าเปิดสมุดทีหลัง)
   */
  async syncDrawerExpense(opts: {
    id: string;
    paidFrom: string;
    amount: number;
    description?: string | null;
    categoryName?: string | null;
    branchId?: string | null;
    spentAt: Date | string;
    deleted?: boolean;
  }) {
    const sourceKey = this.drawerExpenseSourceKey(opts.id);
    const amount = Math.round(num(opts.amount) * 100) / 100;
    const paidFrom = opts.paidFrom === "external" ? "external" : "drawer";
    if (opts.deleted || paidFrom !== "drawer" || amount <= 0) {
      await this.softDeleteBySourceKey(sourceKey);
      return { ok: true, synced: false };
    }

    const spentAt =
      opts.spentAt instanceof Date ? opts.spentAt : new Date(opts.spentAt);
    const entryDate = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Bangkok",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(spentAt);

    await this.upsertAutoLine({
      sourceKey,
      entryDate,
      direction: "out",
      kind: "expense",
      branchId: opts.branchId ?? null,
      amount,
      description:
        (opts.description || "").trim() ||
        opts.categoryName ||
        "จ่ายจากลิ้นชัก",
      note: "อัตโนมัติจากค่าใช้จ่ายลิ้นชัก",
    });
    return { ok: true, synced: true };
  }

  /** ลบรายการ auto ที่ไม่ควรมีแล้ว (เช่น ไม่มียอดขายสาขานั้น) — ไม่แตะรายการ import */
  private async pruneAutoForDay(day: string, keepKeys: Set<string>) {
    const rows = await this.database.db
      .select({ id: pg.cashBookEntries.id, sourceKey: pg.cashBookEntries.sourceKey })
      .from(pg.cashBookEntries)
      .where(
        and(
          eq(pg.cashBookEntries.entryDate, day),
          isNull(pg.cashBookEntries.deletedAt),
          sql`${pg.cashBookEntries.sourceKey} LIKE 'auto:%'`,
        ),
      );

    for (const row of rows) {
      if (!row.sourceKey || keepKeys.has(row.sourceKey)) continue;
      await this.database.db
        .update(pg.cashBookEntries)
        .set({ deletedAt: now(), updatedAt: now() })
        .where(eq(pg.cashBookEntries.id, row.id));
    }
  }

  /** สร้าง/อัปเดตรายการอัตโนมัติของวันนั้น */
  async ensureAutoForDay(day: string) {
    if (!isIsoDay(day)) throw new BadRequestException("วันที่ไม่ถูกต้อง");
    if (day > bangkokToday()) return { day, upserted: 0 };

    const [branches, sales, staffPay, drawerExpenses] = await Promise.all([
      this.rentBranches(),
      this.salesByBranchForDay(day),
      this.staffPayForDay(day),
      this.drawerExpensesForDay(day),
    ]);

    const lines = this.buildAutoLines({
      day,
      branches,
      sales,
      staffPay,
      drawerExpenses,
    });
    for (const line of lines) await this.upsertAutoLine(line);
    await this.pruneAutoForDay(day, new Set(lines.map((l) => l.sourceKey)));
    return { day, upserted: lines.length };
  }

  async ensureAutoForMonth(month: string) {
    if (!isIsoMonth(month)) throw new BadRequestException("เดือนไม่ถูกต้อง");
    const endDay = lastAutoDayInMonth(month);
    if (endDay <= 0) return { month, days: 0 };

    const [y, m] = month.split("-").map(Number);
    const [branches, report] = await Promise.all([
      this.rentBranches(),
      this.shifts.commissionReport({ year: y!, month: m! }),
    ]);

    const staffByDay = new Map<
      string,
      Array<{
        staffId: string;
        staffName: string;
        wage: number;
        commission: number;
        amount: number;
        note?: string | null;
      }>
    >();
    for (const person of report.people) {
      for (const d of person.days) {
        const amount = Math.round((d.wage + d.commission) * 100) / 100;
        if (amount <= 0) continue;
        if (!staffByDay.has(d.date)) staffByDay.set(d.date, []);
        staffByDay.get(d.date)!.push({
          staffId: person.staffId,
          staffName: person.staffName,
          wage: d.wage,
          commission: d.commission,
          amount,
        });
      }
    }

    const from = `${month}-01`;
    const to = `${month}-${String(endDay).padStart(2, "0")}`;
    const start = new Date(`${from}T00:00:00+07:00`);
    const end = new Date(`${to}T23:59:59.999+07:00`);
    const dayFmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Bangkok",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });

    // ยอดขายรวมต่อสาขาต่อวัน — สำหรับค่าแรงก่อนขึ้นระบบ
    const branchDaySales = new Map<string, Map<string, number>>();
    const branchSaleRows = await this.database.db
      .select({
        createdAt: pg.sales.createdAt,
        branchId: pg.sales.branchId,
        total: pg.sales.total,
      })
      .from(pg.sales)
      .where(
        and(
          eq(pg.sales.status, "completed"),
          gte(pg.sales.createdAt, start),
          lte(pg.sales.createdAt, end),
        ),
      );
    for (const row of branchSaleRows) {
      const day = dayFmt.format(row.createdAt);
      if (!branchDaySales.has(day)) branchDaySales.set(day, new Map());
      const map = branchDaySales.get(day)!;
      map.set(
        row.branchId,
        Math.round((num(map.get(row.branchId)) + num(row.total)) * 100) / 100,
      );
    }

    const staffCfgCache = new Map<
      string,
      Awaited<ReturnType<CashBookService["loadStaffPayConfig"]>>
    >();
    for (const rule of PRE_SYSTEM_BRANCH_STAFF) {
      if (!staffCfgCache.has(rule.staffId)) {
        staffCfgCache.set(
          rule.staffId,
          await this.loadStaffPayConfig(rule.staffId),
        );
      }
    }

    for (let d = 1; d <= endDay; d++) {
      const day = `${month}-${String(d).padStart(2, "0")}`;
      const existing = staffByDay.get(day) ?? [];
      const paid = new Set(existing.map((p) => p.staffId));
      for (const rule of PRE_SYSTEM_BRANCH_STAFF) {
        if (day < rule.fromDay || day > rule.untilDay) continue;
        if (paid.has(rule.staffId)) continue;
        const daySales = branchDaySales.get(day)?.get(rule.branchId) ?? 0;
        if (daySales <= 0) continue;
        const cfg = staffCfgCache.get(rule.staffId);
        if (!cfg) continue;
        const wage = isBangkokSunday(day) ? 800 : cfg.dailyWage;
        const commission = calcDailyCommission(daySales, {
          enabled: cfg.enabled,
          startSales: cfg.startSales,
          stepSales: cfg.stepSales,
          amountPerStep: cfg.amountPerStep,
        }).amount;
        const amount = Math.round((wage + commission) * 100) / 100;
        if (amount <= 0) continue;
        existing.push({
          staffId: cfg.id,
          staffName: cfg.name,
          wage,
          commission,
          amount,
          note: `ก่อนขึ้นระบบ · ยอดขายสาขา ${daySales.toFixed(2)}`,
        });
        paid.add(rule.staffId);
      }
      if (existing.length) staffByDay.set(day, existing);
    }

    const saleRows = await this.database.db
      .select({
        createdAt: pg.sales.createdAt,
        branchId: pg.sales.branchId,
        branchName: pg.branches.name,
        method: pg.salePayments.method,
        amount: pg.salePayments.amount,
        saleId: pg.sales.id,
      })
      .from(pg.salePayments)
      .innerJoin(pg.sales, eq(pg.salePayments.saleId, pg.sales.id))
      .leftJoin(pg.branches, eq(pg.sales.branchId, pg.branches.id))
      .where(
        and(
          eq(pg.sales.status, "completed"),
          gte(pg.sales.createdAt, start),
          lte(pg.sales.createdAt, end),
        ),
      );

    type SaleAgg = {
      branchId: string;
      branchName: string;
      cash: number;
      transfer: number;
      government: number;
      billIds: Set<string>;
    };
    const salesByDay = new Map<string, Map<string, SaleAgg>>();
    for (const row of saleRows) {
      const day = dayFmt.format(row.createdAt);
      if (!salesByDay.has(day)) salesByDay.set(day, new Map());
      const map = salesByDay.get(day)!;
      const cur = map.get(row.branchId) ?? {
        branchId: row.branchId,
        branchName: row.branchName ?? row.branchId,
        cash: 0,
        transfer: 0,
        government: 0,
        billIds: new Set<string>(),
      };
      const amount = num(row.amount);
      if (row.method === "cash") cur.cash += amount;
      else if (row.method === "transfer") cur.transfer += amount;
      else if (row.method === "government") cur.government += amount;
      cur.billIds.add(row.saleId);
      map.set(row.branchId, cur);
    }

    // จ่ายจากลิ้นชักทั้งเดือน — จัดกลุ่มตามวัน
    const drawerByDay = new Map<
      string,
      Array<{
        id: string;
        branchId: string | null;
        amount: number;
        description: string;
      }>
    >();
    const drawerRows = await this.database.db
      .select({
        id: pg.expenses.id,
        branchId: pg.expenses.branchId,
        amount: pg.expenses.amount,
        description: pg.expenses.description,
        categoryName: pg.expenseCategories.name,
        spentAt: pg.expenses.spentAt,
      })
      .from(pg.expenses)
      .leftJoin(
        pg.expenseCategories,
        eq(pg.expenses.categoryId, pg.expenseCategories.id),
      )
      .where(
        and(
          isNull(pg.expenses.deletedAt),
          eq(pg.expenses.paidFrom, "drawer"),
          gte(pg.expenses.spentAt, start),
          lte(pg.expenses.spentAt, end),
        ),
      );
    for (const r of drawerRows) {
      const day = dayFmt.format(r.spentAt);
      const amount = Math.round(num(r.amount) * 100) / 100;
      if (amount <= 0) continue;
      if (!drawerByDay.has(day)) drawerByDay.set(day, []);
      drawerByDay.get(day)!.push({
        id: r.id,
        branchId: r.branchId,
        amount,
        description:
          (r.description || "").trim() ||
          r.categoryName ||
          "จ่ายจากลิ้นชัก",
      });
    }

    for (let d = 1; d <= endDay; d++) {
      const day = `${month}-${String(d).padStart(2, "0")}`;
      const sales = [...(salesByDay.get(day)?.values() ?? [])].map((s) => ({
        branchId: s.branchId,
        branchName: s.branchName,
        cash: Math.round(s.cash * 100) / 100,
        transfer: Math.round(s.transfer * 100) / 100,
        government: Math.round(s.government * 100) / 100,
        amount: Math.round((s.cash + s.transfer + s.government) * 100) / 100,
        billCount: s.billIds.size,
      }));
      const lines = this.buildAutoLines({
        day,
        branches,
        sales,
        staffPay: staffByDay.get(day) ?? [],
        drawerExpenses: drawerByDay.get(day) ?? [],
      });
      for (const line of lines) await this.upsertAutoLine(line);
      await this.pruneAutoForDay(day, new Set(lines.map((l) => l.sourceKey)));
    }

    return { month, days: endDay };
  }

  async listDay(day: string) {
    const entryDate = day || bangkokToday();
    if (!isIsoDay(entryDate)) throw new BadRequestException("วันที่ไม่ถูกต้อง");

    await this.ensureAutoForDay(entryDate);

    const rows = await this.database.db
      .select({
        entry: pg.cashBookEntries,
        branchName: pg.branches.name,
        categoryName: pg.expenseCategories.name,
      })
      .from(pg.cashBookEntries)
      .leftJoin(pg.branches, eq(pg.cashBookEntries.branchId, pg.branches.id))
      .leftJoin(
        pg.expenseCategories,
        eq(pg.cashBookEntries.categoryId, pg.expenseCategories.id),
      )
      .where(
        and(
          eq(pg.cashBookEntries.entryDate, entryDate),
          isNull(pg.cashBookEntries.deletedAt),
        ),
      )
      .orderBy(asc(pg.cashBookEntries.updatedAt), asc(pg.cashBookEntries.id));

    const entries = rows.map((r) =>
      this.toRecord(r.entry, {
        branchName: r.branchName,
        categoryName: r.categoryName,
      }),
    );
    const income = entries
      .filter((e) => e.direction === "in")
      .reduce((s, e) => s + e.amount, 0);
    const expense = entries
      .filter((e) => e.direction === "out")
      .reduce((s, e) => s + e.amount, 0);
    return {
      day: entryDate,
      entries,
      summary: {
        income: Math.round(income * 100) / 100,
        expense: Math.round(expense * 100) / 100,
        net: Math.round((income - expense) * 100) / 100,
        count: entries.length,
      },
    };
  }

  async monthReport(month: string): Promise<CashBookMonthReport> {
    const m = month || bangkokToday().slice(0, 7);
    if (!isIsoMonth(m)) throw new BadRequestException("เดือนไม่ถูกต้อง");

    await this.ensureAutoForMonth(m);

    const from = `${m}-01`;
    const to = `${m}-${String(daysInMonth(m)).padStart(2, "0")}`;

    const rows = await this.database.db
      .select({
        entryDate: pg.cashBookEntries.entryDate,
        direction: pg.cashBookEntries.direction,
        kind: pg.cashBookEntries.kind,
        branchId: pg.cashBookEntries.branchId,
        branchName: pg.branches.name,
        description: pg.cashBookEntries.description,
        sourceKey: pg.cashBookEntries.sourceKey,
        amount: sql<string>`sum(${pg.cashBookEntries.amount})`,
        count: sql<number>`count(*)::int`,
      })
      .from(pg.cashBookEntries)
      .leftJoin(pg.branches, eq(pg.cashBookEntries.branchId, pg.branches.id))
      .where(
        and(
          isNull(pg.cashBookEntries.deletedAt),
          gte(pg.cashBookEntries.entryDate, from),
          lte(pg.cashBookEntries.entryDate, to),
        ),
      )
      .groupBy(
        pg.cashBookEntries.entryDate,
        pg.cashBookEntries.direction,
        pg.cashBookEntries.kind,
        pg.cashBookEntries.branchId,
        pg.branches.name,
        pg.cashBookEntries.description,
        pg.cashBookEntries.sourceKey,
      );

    const byDay = new Map<string, CashBookDaySummary>();
    const branchMap = new Map<string, string>();
    const rentByBranchMap = new Map<string, { branchId: string; branchName: string; amount: number }>();
    let bucketRent = 0;
    let bucketWage = 0;
    let bucketGoods = 0;
    let bucketRoutine = 0;
    let bucketDrawer = 0;
    let bucketManual = 0;
    let bucketOtherIn = 0;
    let cashSales = 0;
    let transferSales = 0;
    let governmentSales = 0;
    let loanIn = 0;
    let loanOut = 0;

    for (const r of rows) {
      const cur = byDay.get(r.entryDate) ?? {
        day: r.entryDate,
        income: 0,
        sales: 0,
        otherIncome: 0,
        expense: 0,
        net: 0,
        count: 0,
        salesByBranch: [],
      };
      const amount = Math.round(num(r.amount) * 100) / 100;
      const count = Number(r.count) || 0;
      const key = r.sourceKey ?? "";
      const desc = r.description ?? "";

      if (r.direction === "in") {
        cur.income += amount;
        if (r.kind === "sale" && r.branchId) {
          cur.sales += amount;
          const name = r.branchName ?? r.branchId;
          branchMap.set(r.branchId, name);
          let existing = cur.salesByBranch.find((b) => b.branchId === r.branchId);
          if (!existing) {
            existing = {
              branchId: r.branchId,
              branchName: name,
              cash: 0,
              transfer: 0,
              government: 0,
              transferBills: 0,
              amount: 0,
            };
            cur.salesByBranch.push(existing);
          }
          if (key.includes(":cash:") || desc === "เงินสด") {
            existing.cash += amount;
            cashSales += amount;
          } else if (
            key.includes(":gov:") ||
            desc === "สวัสดิการ" ||
            desc.startsWith("เงินสวัสดิการ") ||
            desc.includes("เงินรัฐ")
          ) {
            existing.government += amount;
            governmentSales += amount;
          } else if (
            key.includes(":xfer:") ||
            desc === "เงินโอน" ||
            desc.startsWith("เงินโอน")
          ) {
            existing.transfer += amount;
            transferSales += amount;
          } else {
            existing.cash += amount;
            cashSales += amount;
          }
          existing.amount = Math.round(
            (existing.cash + existing.transfer + existing.government) * 100,
          ) / 100;
          existing.cash = Math.round(existing.cash * 100) / 100;
          existing.transfer = Math.round(existing.transfer * 100) / 100;
          existing.government = Math.round(existing.government * 100) / 100;
        } else {
          cur.otherIncome += amount;
          if (r.kind === "loan") loanIn += amount;
          else bucketOtherIn += amount;
        }
      } else {
        cur.expense += amount;
        if (r.kind === "loan") loanOut += amount;
        if (key.startsWith("auto:rent:")) {
          bucketRent += amount;
          const bid = r.branchId ?? "unknown";
          const bname = r.branchName ?? bid;
          const rb = rentByBranchMap.get(bid) ?? {
            branchId: bid,
            branchName: bname,
            amount: 0,
          };
          rb.amount = Math.round((rb.amount + amount) * 100) / 100;
          rentByBranchMap.set(bid, rb);
        } else if (
          key.startsWith("auto:staff:") ||
          key.startsWith("auto:owner:") ||
          key.startsWith("auto:flex:ad-wage:")
        ) {
          bucketWage += amount;
        } else if (key.startsWith("auto:drawer-exp:")) {
          bucketDrawer += amount;
        } else if (key.startsWith("import:")) {
          bucketGoods += amount;
        } else if (key.startsWith("auto:flex:school:")) {
          bucketRoutine += amount;
        } else if (!key && r.kind !== "loan") {
          // กรอกเอง → นับในวัตถุดิบด้วย (สรุปกลุ่มจ่าย)
          bucketGoods += amount;
          bucketManual += amount;
        }
      }
      cur.count += count;
      cur.net = Math.round((cur.income - cur.expense) * 100) / 100;
      byDay.set(r.entryDate, cur);
    }

    // เติมสาขาที่เปิดแล้ว (ยกเว้นบ้านฆ้อง) แม้วันนั้นยอด 0
    const rentBranches = await this.rentBranches();
    for (const b of rentBranches) branchMap.set(b.id, b.name);

    const days = [...byDay.values()]
      .map((d) => ({
        ...d,
        income: Math.round(d.income * 100) / 100,
        sales: Math.round(d.sales * 100) / 100,
        otherIncome: Math.round(d.otherIncome * 100) / 100,
        expense: Math.round(d.expense * 100) / 100,
        salesByBranch: [...d.salesByBranch].sort((a, b) =>
          a.branchName.localeCompare(b.branchName, "th"),
        ),
      }))
      .sort((a, b) => b.day.localeCompare(a.day));

    const transferBillMap = await this.transferBillsByDayBranch(m);
    let transferBillsTotal = 0;
    for (const d of days) {
      for (const b of d.salesByBranch) {
        const n = transferBillMap.get(`${d.day}:${b.branchId}`) ?? 0;
        b.transferBills = n;
        transferBillsTotal += n;
      }
    }

    const income = days.reduce((s, d) => s + d.income, 0);
    const sales = days.reduce((s, d) => s + d.sales, 0);
    const otherIncome = days.reduce((s, d) => s + d.otherIncome, 0);
    const expense = days.reduce((s, d) => s + d.expense, 0);
    return {
      month: m,
      branches: [...branchMap.entries()]
        .map(([id, name]) => ({ id, name }))
        .sort((a, b) => a.name.localeCompare(b.name, "th")),
      summary: {
        income: Math.round(income * 100) / 100,
        sales: Math.round(sales * 100) / 100,
        otherIncome: Math.round(otherIncome * 100) / 100,
        expense: Math.round(expense * 100) / 100,
        net: Math.round((income - expense) * 100) / 100,
        count: days.reduce((s, d) => s + d.count, 0),
      },
      buckets: {
        rent: Math.round(bucketRent * 100) / 100,
        rentByBranch: [...rentByBranchMap.values()].sort((a, b) =>
          a.branchName.localeCompare(b.branchName, "th"),
        ),
        wage: Math.round(bucketWage * 100) / 100,
        goods: Math.round(bucketGoods * 100) / 100,
        routine: Math.round(bucketRoutine * 100) / 100,
        drawer: Math.round(bucketDrawer * 100) / 100,
        manual: Math.round(bucketManual * 100) / 100,
        cashSales: Math.round(cashSales * 100) / 100,
        transferSales: Math.round(transferSales * 100) / 100,
        transferBills: transferBillsTotal,
        governmentSales: Math.round(governmentSales * 100) / 100,
        otherIn: Math.round(bucketOtherIn * 100) / 100,
        loanIn: Math.round(loanIn * 100) / 100,
        loanOut: Math.round(loanOut * 100) / 100,
      },
      days,
    };
  }

  async listDescriptions() {
    const rows = await this.database.db
      .select({
        description: pg.cashBookEntries.description,
        count: sql<number>`count(*)::int`,
        lastDate: sql<string>`max(${pg.cashBookEntries.entryDate})`,
      })
      .from(pg.cashBookEntries)
      .where(
        and(
          isNull(pg.cashBookEntries.deletedAt),
          sql`coalesce(trim(${pg.cashBookEntries.description}), '') <> ''`,
          sql`(
            ${pg.cashBookEntries.sourceKey} IS NULL
            OR ${pg.cashBookEntries.sourceKey} LIKE 'import:%'
            OR ${pg.cashBookEntries.sourceKey} LIKE 'auto:staff:%'
            OR ${pg.cashBookEntries.sourceKey} LIKE 'auto:owner:%'
            OR ${pg.cashBookEntries.sourceKey} LIKE 'auto:rent:%'
            OR ${pg.cashBookEntries.sourceKey} LIKE 'auto:flex:%'
          )`,
        ),
      )
      .groupBy(pg.cashBookEntries.description)
      .orderBy(
        sql`count(*) DESC`,
        sql`max(${pg.cashBookEntries.entryDate}) DESC`,
      )
      .limit(120);

    const descriptions = [
      "ยืมจากเจ้าของ (ปอ)",
      "คืนเจ้าของ (ปอ)",
      ...rows.map((r) => (r.description ?? "").trim()).filter(Boolean),
    ];
    // unique keep order
    const seen = new Set<string>();
    const unique = descriptions.filter((d) => {
      if (seen.has(d)) return false;
      seen.add(d);
      return true;
    });

    return { descriptions: unique.slice(0, 120) };
  }

  async create(dto: UpsertCashBookEntryDto) {
    const amount = this.validateDto(dto);
    const id = `cbe-${randomUUID().slice(0, 10)}`;
    await this.database.db.insert(pg.cashBookEntries).values({
      id,
      entryDate: dto.entryDate,
      direction: dto.direction,
      kind: dto.kind,
      branchId: dto.branchId?.trim() || null,
      categoryId: dto.categoryId?.trim() || null,
      amount: String(amount),
      description: dto.description?.trim() || null,
      note: dto.note?.trim() || null,
      sourceKey: null,
      updatedAt: now(),
      deletedAt: null,
    });
    return this.get(id);
  }

  async get(id: string) {
    const rows = await this.database.db
      .select({
        entry: pg.cashBookEntries,
        branchName: pg.branches.name,
        categoryName: pg.expenseCategories.name,
      })
      .from(pg.cashBookEntries)
      .leftJoin(pg.branches, eq(pg.cashBookEntries.branchId, pg.branches.id))
      .leftJoin(
        pg.expenseCategories,
        eq(pg.cashBookEntries.categoryId, pg.expenseCategories.id),
      )
      .where(
        and(eq(pg.cashBookEntries.id, id), isNull(pg.cashBookEntries.deletedAt)),
      )
      .limit(1);
    if (!rows[0]) throw new NotFoundException("ไม่พบรายการ");
    return this.toRecord(rows[0].entry, {
      branchName: rows[0].branchName,
      categoryName: rows[0].categoryName,
    });
  }

  async update(id: string, dto: Partial<UpsertCashBookEntryDto>) {
    const current = await this.get(id);
    if (this.isSystemLocked(current.sourceKey)) {
      throw new BadRequestException("รายการอัตโนมัติจากระบบแก้ไขไม่ได้");
    }
    const next: UpsertCashBookEntryDto = {
      entryDate: dto.entryDate ?? current.entryDate,
      direction: dto.direction ?? current.direction,
      kind: dto.kind ?? current.kind,
      branchId: dto.branchId !== undefined ? dto.branchId : current.branchId,
      categoryId:
        dto.categoryId !== undefined ? dto.categoryId : current.categoryId,
      amount: dto.amount ?? current.amount,
      description:
        dto.description !== undefined ? dto.description : current.description,
      note: dto.note !== undefined ? dto.note : current.note,
    };
    const amount = this.validateDto(next);
    await this.database.db
      .update(pg.cashBookEntries)
      .set({
        entryDate: next.entryDate,
        direction: next.direction,
        kind: next.kind,
        branchId: next.branchId?.trim() || null,
        categoryId: next.categoryId?.trim() || null,
        amount: String(amount),
        description: next.description?.trim() || null,
        note: next.note?.trim() || null,
        updatedAt: now(),
      })
      .where(eq(pg.cashBookEntries.id, id));
    return this.get(id);
  }

  async remove(id: string) {
    const current = await this.get(id);
    if (this.isSystemLocked(current.sourceKey)) {
      throw new BadRequestException("รายการอัตโนมัติจากระบบลบไม่ได้");
    }
    await this.database.db
      .update(pg.cashBookEntries)
      .set({ deletedAt: now(), updatedAt: now() })
      .where(eq(pg.cashBookEntries.id, id));
    return { ok: true };
  }

  /** ล็อกเฉพาะออโต้ระบบ (ยอดขาย/ค่าแรง/ค่าเช่า/ลิ้นชัก) — ชีท + ประจำแก้ได้ */
  private isSystemLocked(sourceKey: string | null | undefined) {
    if (!sourceKey) return false;
    if (sourceKey.startsWith("import:")) return false;
    if (sourceKey.startsWith("auto:flex:")) return false;
    return true;
  }
}
