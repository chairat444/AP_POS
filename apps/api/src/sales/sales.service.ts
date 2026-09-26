import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { and, desc, eq, gte, inArray, isNull, lte, sql, type SQL } from "drizzle-orm";
import { pg } from "@ap-pos/db";
import { DatabaseService } from "../db/database.service";
import {
  buildCostLookup,
  costBasisQty,
  isFreshKgProduct,
  priceBillProfit,
  pricePerKgForLine,
  rankFreshLines,
  type CostCatalogItem,
  type CostLookup,
} from "./sale-profit";

export type ReportQuery = {
  from?: string;
  to?: string;
  branchId?: string;
  paymentMethod?: string;
  groupBy?: "day" | "month" | "year";
  limit?: number;
  /** false = ไม่ส่งรายการบิล (ใช้ตอนสรุปปี/เดือน) */
  includeSales?: boolean;
};

function bangkokDayStart(isoDate: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) {
    return new Date(`${isoDate}T00:00:00.000+07:00`);
  }
  return new Date(isoDate);
}

function bangkokDayEnd(isoDate: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) {
    return new Date(`${isoDate}T23:59:59.999+07:00`);
  }
  return new Date(isoDate);
}

function todayBangkokStart() {
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  return bangkokDayStart(day);
}

/** ต้นเดือนปัจจุบัน (Asia/Bangkok) เช่น 2026-09-01 */
function thisMonthBangkokStart() {
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  return bangkokDayStart(`${day.slice(0, 7)}-01`);
}

/** เริ่มเติมกำไรบิลเก่า — สิงหา 2026 (เดือนแรกที่อยากเช็คคร่าวๆ) */
function profitBackfillFrom() {
  return bangkokDayStart("2026-08-01");
}

function bangkokPeriod(d: Date, groupBy: "day" | "month" | "year") {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const y = parts.find((p) => p.type === "year")?.value ?? "0000";
  const m = parts.find((p) => p.type === "month")?.value ?? "01";
  const day = parts.find((p) => p.type === "day")?.value ?? "01";
  if (groupBy === "year") return y;
  if (groupBy === "month") return `${y}-${m}`;
  return `${y}-${m}-${day}`;
}

@Injectable()
export class SalesService implements OnModuleInit {
  private readonly logger = new Logger(SalesService.name);
  private backfillPromise: Promise<void> | null = null;

  constructor(private readonly database: DatabaseService) {}

  onModuleInit() {
    void this.ensureProfitBackfill();
    void this.ensureKgPriceBackfill();
    void this.ensureFreshKgCostRepair();
  }

  private saleFilters(opts?: ReportQuery): SQL | undefined {
    const filters: SQL[] = [eq(pg.sales.status, "completed")];
    if (opts?.from) filters.push(gte(pg.sales.createdAt, bangkokDayStart(opts.from)));
    if (opts?.to) filters.push(lte(pg.sales.createdAt, bangkokDayEnd(opts.to)));
    if (opts?.branchId) filters.push(eq(pg.sales.branchId, opts.branchId));
    return and(...filters);
  }

  /** รายการบิล — แสดงทั้ง completed/voided เพื่อค้นหาได้ */
  private listFilters(opts?: ReportQuery): SQL | undefined {
    const filters: SQL[] = [];
    if (opts?.from) filters.push(gte(pg.sales.createdAt, bangkokDayStart(opts.from)));
    if (opts?.to) filters.push(lte(pg.sales.createdAt, bangkokDayEnd(opts.to)));
    if (opts?.branchId) filters.push(eq(pg.sales.branchId, opts.branchId));
    return filters.length ? and(...filters) : undefined;
  }

  async list(opts?: ReportQuery) {
    const limit = Math.min(Math.max(opts?.limit ?? 100, 1), 500);
    const where = this.listFilters(opts);

    let saleIdsWithMethod: string[] | null = null;
    if (opts?.paymentMethod) {
      const payRows = await this.database.db
        .selectDistinct({ saleId: pg.salePayments.saleId })
        .from(pg.salePayments)
        .where(eq(pg.salePayments.method, opts.paymentMethod));
      saleIdsWithMethod = payRows.map((r) => r.saleId);
      if (!saleIdsWithMethod.length) {
        return {
          sales: [] as ReturnType<SalesService["mapSale"]>[],
          cancels: await this.listCancels(opts),
        };
      }
    }

    const rows = await this.database.db
      .select()
      .from(pg.sales)
      .where(where)
      .orderBy(desc(pg.sales.createdAt))
      .limit(Math.max(limit * 3, limit));

    const filtered = saleIdsWithMethod
      ? rows.filter((r) => saleIdsWithMethod!.includes(r.id)).slice(0, limit)
      : rows.slice(0, limit);

    const payments = filtered.length
      ? await this.database.db
          .select()
          .from(pg.salePayments)
          .where(
            sql`${pg.salePayments.saleId} in (${sql.join(
              filtered.map((s) => sql`${s.id}`),
              sql`, `,
            )})`,
          )
      : [];

    const payBySale = new Map<string, typeof payments>();
    for (const p of payments) {
      const list = payBySale.get(p.saleId) ?? [];
      list.push(p);
      payBySale.set(p.saleId, list);
    }

    return {
      sales: filtered.map((r) => this.mapSale(r, payBySale.get(r.id) ?? [])),
      cancels: await this.listCancels(opts),
    };
  }

  /**
   * ยกเลิกรายการ / ยกเลิกบิลจาก POS (เก็บใน shift_audits ไม่ใช่ sales.voided)
   */
  async listCancels(opts?: ReportQuery) {
    const limit = Math.min(Math.max(opts?.limit ?? 300, 1), 500);
    const filters: SQL[] = [];
    if (opts?.from) {
      filters.push(gte(pg.shiftAudits.createdAt, bangkokDayStart(opts.from)));
    }
    if (opts?.to) {
      filters.push(lte(pg.shiftAudits.createdAt, bangkokDayEnd(opts.to)));
    }
    if (opts?.branchId) {
      filters.push(eq(pg.shiftAudits.branchId, opts.branchId));
    }
    const where = filters.length ? and(...filters) : undefined;

    const rows = await this.database.db
      .select({
        id: pg.shiftAudits.id,
        shiftId: pg.shiftAudits.shiftId,
        branchId: pg.shiftAudits.branchId,
        branchName: pg.branches.name,
        terminalId: pg.shiftAudits.terminalId,
        staffId: pg.shiftAudits.staffId,
        staffName: pg.shiftAudits.staffName,
        type: pg.shiftAudits.type,
        barcode: pg.shiftAudits.barcode,
        productName: pg.shiftAudits.productName,
        qty: pg.shiftAudits.qty,
        amount: pg.shiftAudits.amount,
        billTotalBefore: pg.shiftAudits.billTotalBefore,
        itemCountBefore: pg.shiftAudits.itemCountBefore,
        createdAt: pg.shiftAudits.createdAt,
      })
      .from(pg.shiftAudits)
      .leftJoin(pg.branches, eq(pg.shiftAudits.branchId, pg.branches.id))
      .where(where)
      .orderBy(desc(pg.shiftAudits.createdAt))
      .limit(limit);

    return rows.map((r) => ({
      id: r.id,
      shiftId: r.shiftId,
      branchId: r.branchId,
      branchName: r.branchName ?? null,
      terminalId: r.terminalId,
      staffId: r.staffId ?? null,
      staffName: r.staffName,
      type: r.type,
      barcode: r.barcode ?? null,
      productName: r.productName ?? null,
      qty: r.qty == null ? null : Number(r.qty),
      amount: Number(r.amount),
      billTotalBefore:
        r.billTotalBefore == null ? null : Number(r.billTotalBefore),
      itemCountBefore: r.itemCountBefore ?? null,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  async getById(id: string) {
    const rows = await this.database.db
      .select()
      .from(pg.sales)
      .where(eq(pg.sales.id, id))
      .limit(1);
    if (!rows[0]) return null;

    const payments = await this.database.db
      .select()
      .from(pg.salePayments)
      .where(eq(pg.salePayments.saleId, id));
    const lines = await this.database.db
      .select()
      .from(pg.saleLines)
      .where(eq(pg.saleLines.saleId, id));

    return {
      ...this.mapSale(rows[0], payments),
      lines: lines.map((l) => ({
        id: l.id,
        barcode: l.barcode,
        productCode: l.productCode,
        name: l.name,
        qty: Number(l.qty),
        unit: l.unit,
        unitPrice: Number(l.unitPrice),
        discount: Number(l.discount),
        lineTotal: Number(l.lineTotal),
        netRevenue: l.netRevenue == null ? null : Number(l.netRevenue),
        costStatus: l.costStatus,
        unitCost: l.unitCost == null ? null : Number(l.unitCost),
        lineCost: l.lineCost == null ? null : Number(l.lineCost),
        lineProfit: l.lineProfit == null ? null : Number(l.lineProfit),
        pricePerKg: l.pricePerKg == null ? null : Number(l.pricePerKg),
      })),
    };
  }

  /**
   * แก้ทุน/ราคาต่อกก. บนบรรทัดบิล — master สินค้าไม่เปลี่ยน
   * ยอดเงินในบิล (lineTotal / payments) ไม่แตะ
   */
  async updateLineCost(
    saleId: string,
    lineId: string,
    body: {
      unitCost?: number | null;
      pricePerKg?: number | null;
      clearCost?: boolean;
    },
  ) {
    const saleRows = await this.database.db
      .select()
      .from(pg.sales)
      .where(eq(pg.sales.id, saleId))
      .limit(1);
    if (!saleRows[0]) return null;

    const lineRows = await this.database.db
      .select()
      .from(pg.saleLines)
      .where(and(eq(pg.saleLines.id, lineId), eq(pg.saleLines.saleId, saleId)))
      .limit(1);
    const line = lineRows[0];
    if (!line) return null;

    const round2 = (n: number) => Math.round(n * 100) / 100;
    const qty = Number(line.qty) || 0;
    const net =
      line.netRevenue == null ? Number(line.lineTotal) : Number(line.netRevenue);

    let nextStatus = line.costStatus;
    let nextUnitCost =
      line.unitCost == null ? null : Number(line.unitCost);
    let nextLineCost =
      line.lineCost == null ? null : Number(line.lineCost);
    let nextLineProfit =
      line.lineProfit == null ? null : Number(line.lineProfit);
    let nextPricePerKg =
      line.pricePerKg == null ? null : Number(line.pricePerKg);

    if (Object.prototype.hasOwnProperty.call(body, "pricePerKg")) {
      const v = body.pricePerKg;
      nextPricePerKg =
        v == null || v === ("" as unknown)
          ? null
          : round2(Number(v));
      if (nextPricePerKg != null && !(nextPricePerKg > 0)) nextPricePerKg = null;
    }

    if (body.clearCost) {
      nextStatus = "missing";
      nextUnitCost = null;
      nextLineCost = null;
      nextLineProfit = null;
    } else if (Object.prototype.hasOwnProperty.call(body, "unitCost")) {
      const v = body.unitCost;
      if (v == null || Number.isNaN(Number(v))) {
        nextStatus = "missing";
        nextUnitCost = null;
        nextLineCost = null;
        nextLineProfit = null;
      } else {
        nextUnitCost = round2(Number(v));
        nextStatus = "known";
      }
    }

    // มีราคาขาย/กก. · ทุน/กก. × (ยอดขาย ÷ ราคาขาย/กก.) · ไม่มีก็ × qty
    if (nextStatus === "known" && nextUnitCost != null) {
      const basis = costBasisQty(
        {
          barcode: line.barcode,
          productCode: line.productCode,
          qty,
        },
        net,
        nextPricePerKg,
      );
      nextLineCost = round2(nextUnitCost * basis);
      nextLineProfit = round2(net - nextLineCost);
    } else if (nextStatus === "missing") {
      nextLineCost = null;
      nextLineProfit = null;
    }

    await this.database.db
      .update(pg.saleLines)
      .set({
        costStatus: nextStatus,
        unitCost: this.money(nextUnitCost),
        lineCost: this.money(nextLineCost),
        lineProfit: this.money(nextLineProfit),
        netRevenue: this.money(net),
        pricePerKg: this.money(nextPricePerKg),
        kgPriced: 1,
      })
      .where(eq(pg.saleLines.id, lineId));

    await this.recomputeSaleProfit(saleId);
    return this.getById(saleId);
  }

  private async recomputeSaleProfit(saleId: string) {
    const lines = await this.database.db
      .select()
      .from(pg.saleLines)
      .where(eq(pg.saleLines.saleId, saleId));
    const round2 = (n: number) => Math.round(n * 100) / 100;
    let profit = 0;
    let costAmount = 0;
    let knownRevenue = 0;
    let missingRevenue = 0;
    let missingLineCount = 0;
    let estimatedProfit = 0;
    let estimatedRevenue = 0;
    for (const l of lines) {
      const net =
        l.netRevenue == null ? Number(l.lineTotal) : Number(l.netRevenue);
      if (l.costStatus === "missing" || l.costStatus == null) {
        missingRevenue += net;
        missingLineCount += 1;
        continue;
      }
      profit += Number(l.lineProfit ?? 0);
      costAmount += Number(l.lineCost ?? 0);
      if (l.costStatus === "estimated") {
        estimatedProfit += Number(l.lineProfit ?? 0);
        estimatedRevenue += net;
      } else {
        knownRevenue += net;
      }
    }
    await this.database.db
      .update(pg.sales)
      .set({
        profit: this.money(round2(profit)),
        costAmount: this.money(round2(costAmount)),
        knownRevenue: this.money(round2(knownRevenue)),
        missingRevenue: this.money(round2(missingRevenue)),
        missingLineCount,
        estimatedProfit: this.money(round2(estimatedProfit)),
        estimatedRevenue: this.money(round2(estimatedRevenue)),
      })
      .where(eq(pg.sales.id, saleId));
  }

  private mapSale(
    r: typeof pg.sales.$inferSelect,
    payments: (typeof pg.salePayments.$inferSelect)[],
  ) {
    return {
      id: r.id,
      billNo: r.billNo,
      branchId: r.branchId,
      terminalId: r.terminalId,
      shiftId: r.shiftId ?? null,
      customerId: r.customerId,
      customerName: r.customerName,
      subtotal: Number(r.subtotal),
      discount: Number(r.discount),
      total: Number(r.total),
      paid: Number(r.paid),
      change: Number(r.change),
      pointsRedeemed: r.pointsRedeemed,
      pointsEarned: r.pointsEarned,
      status: r.status,
      profit: r.profit == null ? null : Number(r.profit),
      costAmount: r.costAmount == null ? null : Number(r.costAmount),
      knownRevenue: r.knownRevenue == null ? null : Number(r.knownRevenue),
      missingRevenue:
        r.missingRevenue == null ? null : Number(r.missingRevenue),
      missingLineCount: r.missingLineCount ?? 0,
      estimatedProfit:
        r.estimatedProfit == null ? null : Number(r.estimatedProfit),
      estimatedRevenue:
        r.estimatedRevenue == null ? null : Number(r.estimatedRevenue),
      createdAt: r.createdAt.toISOString(),
      syncedAt: r.syncedAt?.toISOString() ?? null,
      payments: payments.map((p) => ({
        method: p.method,
        amount: Number(p.amount),
        tendered: p.tendered == null ? null : Number(p.tendered),
      })),
    };
  }

  async summary() {
    await this.ensureKgPriceBackfill();
    const start = todayBangkokStart();
    const todayIso = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Bangkok",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    const yesterdayDate = new Date(`${todayIso}T12:00:00.000+07:00`);
    yesterdayDate.setDate(yesterdayDate.getDate() - 1);
    const yesterdayIso = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Bangkok",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(yesterdayDate);
    const yesterdayStart = bangkokDayStart(yesterdayIso);
    const yesterdayEnd = bangkokDayEnd(yesterdayIso);
    const last7Iso = (() => {
      const d = new Date(`${todayIso}T12:00:00.000+07:00`);
      d.setDate(d.getDate() - 6);
      return new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Bangkok",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(d);
    })();
    const last7Start = bangkokDayStart(last7Iso);
    const last56Iso = (() => {
      const d = new Date(`${todayIso}T12:00:00.000+07:00`);
      d.setDate(d.getDate() - 55);
      return new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Bangkok",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(d);
    })();
    const last56Start = bangkokDayStart(last56Iso);
    const thisYear = Number(todayIso.slice(0, 4));
    const prevYear = thisYear - 1;
    const yearRangeStart = bangkokDayStart(`${prevYear}-01-01`);
    const currentMonth = Number(todayIso.slice(5, 7));

    const daySql = sql<string>`to_char(${pg.sales.createdAt} at time zone 'Asia/Bangkok', 'YYYY-MM-DD')`;
    const monthSql = sql<string>`to_char(${pg.sales.createdAt} at time zone 'Asia/Bangkok', 'YYYY-MM')`;
    const yearSql = sql<string>`to_char(${pg.sales.createdAt} at time zone 'Asia/Bangkok', 'YYYY')`;
    // PostgreSQL DOW: 0=อา … 6=ส → จ=0 … อา=6
    const weekdaySql = sql<number>`((extract(dow from ${pg.sales.createdAt} at time zone 'Asia/Bangkok')::int + 6) % 7)`;

    const [
      todayRows,
      yesterdayRows,
      allRows,
      productCount,
      memberCount,
      branchRowsRaw,
      weekDayBranchRows,
      weekdayDayBranchRows,
      monthBranchRows,
      yearBranchRows,
      todayPayRows,
      freshLineRows,
    ] = await Promise.all([
      this.database.db
        .select({
          billCount: sql<number>`count(*)::int`,
          grossTotal: sql<string>`coalesce(sum(${pg.sales.total}), 0)`,
        })
        .from(pg.sales)
        .where(
          and(eq(pg.sales.status, "completed"), gte(pg.sales.createdAt, start)),
        ),
      this.database.db
        .select({
          billCount: sql<number>`count(*)::int`,
          grossTotal: sql<string>`coalesce(sum(${pg.sales.total}), 0)`,
        })
        .from(pg.sales)
        .where(
          and(
            eq(pg.sales.status, "completed"),
            gte(pg.sales.createdAt, yesterdayStart),
            lte(pg.sales.createdAt, yesterdayEnd),
          ),
        ),
      this.database.db
        .select({
          billCount: sql<number>`count(*)::int`,
          grossTotal: sql<string>`coalesce(sum(${pg.sales.total}), 0)`,
        })
        .from(pg.sales)
        .where(eq(pg.sales.status, "completed")),
      this.database.db
        .select({ c: sql<number>`count(*)::int` })
        .from(pg.products)
        .where(sql`${pg.products.deletedAt} is null`),
      this.database.db
        .select({ c: sql<number>`count(*)::int` })
        .from(pg.customers)
        .where(sql`${pg.customers.deletedAt} is null`),
      this.database.db
        .select()
        .from(pg.branches)
        .where(isNull(pg.branches.deletedAt)),
      this.database.db
        .select({
          date: daySql,
          branchId: pg.sales.branchId,
          billCount: sql<number>`count(*)::int`,
          grossTotal: sql<string>`coalesce(sum(${pg.sales.total}), 0)`,
        })
        .from(pg.sales)
        .where(
          and(
            eq(pg.sales.status, "completed"),
            gte(pg.sales.createdAt, last7Start),
          ),
        )
        .groupBy(daySql, pg.sales.branchId),
      this.database.db
        .select({
          weekday: weekdaySql,
          date: daySql,
          branchId: pg.sales.branchId,
          billCount: sql<number>`count(*)::int`,
          grossTotal: sql<string>`coalesce(sum(${pg.sales.total}), 0)`,
        })
        .from(pg.sales)
        .where(
          and(
            eq(pg.sales.status, "completed"),
            gte(pg.sales.createdAt, last56Start),
          ),
        )
        .groupBy(weekdaySql, daySql, pg.sales.branchId),
      this.database.db
        .select({
          ym: monthSql,
          branchId: pg.sales.branchId,
          billCount: sql<number>`count(*)::int`,
          grossTotal: sql<string>`coalesce(sum(${pg.sales.total}), 0)`,
        })
        .from(pg.sales)
        .where(
          and(
            eq(pg.sales.status, "completed"),
            gte(pg.sales.createdAt, yearRangeStart),
          ),
        )
        .groupBy(monthSql, pg.sales.branchId),
      this.database.db
        .select({
          year: yearSql,
          branchId: pg.sales.branchId,
          billCount: sql<number>`count(*)::int`,
          grossTotal: sql<string>`coalesce(sum(${pg.sales.total}), 0)`,
        })
        .from(pg.sales)
        .where(eq(pg.sales.status, "completed"))
        .groupBy(yearSql, pg.sales.branchId)
        .orderBy(yearSql),
      this.database.db
        .select({
          method: pg.salePayments.method,
          amount: sql<string>`coalesce(sum(${pg.salePayments.amount}), 0)`,
          count: sql<number>`count(*)::int`,
        })
        .from(pg.salePayments)
        .innerJoin(pg.sales, eq(pg.salePayments.saleId, pg.sales.id))
        .where(
          and(
            eq(pg.sales.status, "completed"),
            gte(pg.sales.createdAt, start),
            sql`${pg.salePayments.method} <> 'points'`,
          ),
        )
        .groupBy(pg.salePayments.method),
      this.database.db
        .select({
          createdAt: pg.sales.createdAt,
          barcode: pg.saleLines.barcode,
          productCode: pg.saleLines.productCode,
          name: pg.saleLines.name,
          qty: pg.saleLines.qty,
          lineTotal: pg.saleLines.lineTotal,
          pricePerKg: pg.saleLines.pricePerKg,
        })
        .from(pg.saleLines)
        .innerJoin(pg.sales, eq(pg.saleLines.saleId, pg.sales.id))
        .where(
          and(
            eq(pg.sales.status, "completed"),
            gte(pg.sales.createdAt, last7Start),
            sql`(
              ${pg.saleLines.barcode} like '9%'
              or coalesce(${pg.saleLines.productCode}, '') like '9%'
            )`,
          ),
        ),
    ]);

    const branchRows = branchRowsRaw.filter((b) => Boolean(b.active));
    const branchNameMap = new Map(
      branchRows.map((b) => [b.id, b.name] as const),
    );
    const rankBranch = (name: string) =>
      /หลุมดิน/.test(name) ? 0 : /เจ็ดเสมียน/.test(name) ? 1 : 2;

    const branchIds = new Set<string>(branchRows.map((b) => b.id));
    for (const r of weekDayBranchRows) branchIds.add(r.branchId);
    for (const r of yearBranchRows) branchIds.add(r.branchId);
    const branches = [...branchIds]
      .map((id) => ({
        id,
        name: branchNameMap.get(id) ?? id,
      }))
      .sort((a, b) => {
        const d = rankBranch(a.name) - rankBranch(b.name);
        return d !== 0 ? d : a.name.localeCompare(b.name, "th");
      });

    const dayMap = new Map<
      string,
      {
        date: string;
        billCount: number;
        grossTotal: number;
        byBranch: Map<string, { billCount: number; grossTotal: number }>;
      }
    >();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(`${todayIso}T12:00:00.000+07:00`);
      d.setDate(d.getDate() - i);
      const iso = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Bangkok",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(d);
      dayMap.set(iso, {
        date: iso,
        billCount: 0,
        grossTotal: 0,
        byBranch: new Map(),
      });
    }
    for (const r of weekDayBranchRows) {
      const cur = dayMap.get(r.date);
      if (!cur) continue;
      const amount = Number(r.grossTotal ?? 0);
      const bills = r.billCount ?? 0;
      cur.billCount += bills;
      cur.grossTotal += amount;
      cur.byBranch.set(r.branchId, {
        billCount: bills,
        grossTotal: amount,
      });
    }

    const last7Days = [...dayMap.values()].map((d) => {
      const [, m, day] = d.date.split("-").map(Number);
      return {
        date: d.date,
        label: `${day}/${m}`,
        billCount: d.billCount,
        grossTotal: Math.round(d.grossTotal * 100) / 100,
        byBranch: branches.map((b) => {
          const hit = d.byBranch.get(b.id);
          return {
            branchId: b.id,
            branchName: b.name,
            billCount: hit?.billCount ?? 0,
            grossTotal: Math.round((hit?.grossTotal ?? 0) * 100) / 100,
          };
        }),
      };
    });

    const todayByBranchMap = new Map<
      string,
      { billCount: number; grossTotal: number }
    >();
    for (const r of weekDayBranchRows) {
      if (r.date !== todayIso) continue;
      todayByBranchMap.set(r.branchId, {
        billCount: r.billCount ?? 0,
        grossTotal: Number(r.grossTotal ?? 0),
      });
    }
    const todayByBranch = branches
      .map((b) => {
        const hit = todayByBranchMap.get(b.id);
        return {
          branchId: b.id,
          branchName: b.name,
          billCount: hit?.billCount ?? 0,
          grossTotal: Math.round((hit?.grossTotal ?? 0) * 100) / 100,
        };
      })
      .filter((b) => b.billCount > 0 || branches.length <= 3);

    const payMap = new Map<string, { amount: number; count: number }>();
    for (const p of todayPayRows) {
      payMap.set(p.method, {
        amount: Number(p.amount ?? 0),
        count: p.count ?? 0,
      });
    }
    const payOrder = ["cash", "transfer", "government"];
    const todayByPayment = [
      ...payOrder.filter((m) => payMap.has(m)),
      ...[...payMap.keys()].filter((m) => !payOrder.includes(m)),
    ].map((method) => {
      const hit = payMap.get(method)!;
      return {
        method,
        amount: Math.round(hit.amount * 100) / 100,
        count: hit.count,
      };
    });

    const weekGross = last7Days.reduce((s, d) => s + d.grossTotal, 0);
    const weekBillCount = last7Days.reduce((s, d) => s + d.billCount, 0);

    const weekdayLabels = ["จ", "อ", "พ", "พฤ", "ศ", "ส", "อา"] as const;
    const weekdayNames = [
      "จันทร์",
      "อังคาร",
      "พุธ",
      "พฤหัส",
      "ศุกร์",
      "เสาร์",
      "อาทิตย์",
    ] as const;
    const weekdayBuckets = weekdayLabels.map((_, i) => ({
      weekday: i,
      label: weekdayLabels[i]!,
      name: weekdayNames[i]!,
      billCount: 0,
      grossTotal: 0,
      dates: new Set<string>(),
      byBranch: new Map<
        string,
        { billCount: number; grossTotal: number; dates: Set<string> }
      >(),
    }));
    for (const r of weekdayDayBranchRows) {
      const mon0 = Number(r.weekday);
      const bucket = weekdayBuckets[mon0];
      if (!bucket) continue;
      const amount = Number(r.grossTotal ?? 0);
      const bills = r.billCount ?? 0;
      bucket.dates.add(r.date);
      bucket.billCount += bills;
      bucket.grossTotal += amount;
      const br = bucket.byBranch.get(r.branchId) ?? {
        billCount: 0,
        grossTotal: 0,
        dates: new Set<string>(),
      };
      br.billCount += bills;
      br.grossTotal += amount;
      br.dates.add(r.date);
      bucket.byBranch.set(r.branchId, br);
    }
    const byWeekday = weekdayBuckets.map((b) => {
      const dayCount = b.dates.size || 0;
      const grossTotal = Math.round(b.grossTotal * 100) / 100;
      const avgGross =
        dayCount > 0 ? Math.round((grossTotal / dayCount) * 100) / 100 : 0;
      const byBranch = branches.map((br) => {
        const hit = b.byBranch.get(br.id);
        const branchGross = Math.round((hit?.grossTotal ?? 0) * 100) / 100;
        const branchDayCount = hit?.dates.size ?? 0;
        const avg =
          dayCount > 0
            ? Math.round((branchGross / dayCount) * 100) / 100
            : 0;
        return {
          branchId: br.id,
          branchName: br.name,
          billCount: hit?.billCount ?? 0,
          grossTotal: branchGross,
          dayCount: branchDayCount,
          avgGross: avg,
        };
      });
      return {
        weekday: b.weekday,
        label: b.label,
        name: b.name,
        dayCount,
        billCount: b.billCount,
        grossTotal,
        avgGross,
        byBranch,
      };
    });
    const bestWeekday = [...byWeekday]
      .filter((d) => d.dayCount > 0)
      .sort((a, b) => b.avgGross - a.avgGross || b.grossTotal - a.grossTotal)[0];

    const monthBucket = new Map<
      string,
      {
        billCount: number;
        grossTotal: number;
        byBranch: Map<string, { billCount: number; grossTotal: number }>;
      }
    >();
    for (const r of monthBranchRows) {
      const cur = monthBucket.get(r.ym) ?? {
        billCount: 0,
        grossTotal: 0,
        byBranch: new Map(),
      };
      const amount = Number(r.grossTotal ?? 0);
      const bills = r.billCount ?? 0;
      cur.billCount += bills;
      cur.grossTotal += amount;
      cur.byBranch.set(r.branchId, {
        billCount: bills,
        grossTotal: amount,
      });
      monthBucket.set(r.ym, cur);
    }
    const monthLabels = [
      "ม.ค.",
      "ก.พ.",
      "มี.ค.",
      "เม.ย.",
      "พ.ค.",
      "มิ.ย.",
      "ก.ค.",
      "ส.ค.",
      "ก.ย.",
      "ต.ค.",
      "พ.ย.",
      "ธ.ค.",
    ] as const;
    const mapMonthBranches = (
      hit:
        | {
            billCount: number;
            grossTotal: number;
            byBranch: Map<string, { billCount: number; grossTotal: number }>;
          }
        | undefined,
    ) =>
      branches.map((b) => {
        const row = hit?.byBranch.get(b.id);
        return {
          branchId: b.id,
          branchName: b.name,
          billCount: row?.billCount ?? 0,
          grossTotal: Math.round((row?.grossTotal ?? 0) * 100) / 100,
        };
      });
    const byMonthCompare = monthLabels.map((label, i) => {
      const month = i + 1;
      const mm = String(month).padStart(2, "0");
      const thisKey = `${thisYear}-${mm}`;
      const prevKey = `${prevYear}-${mm}`;
      const thisHit = monthBucket.get(thisKey);
      const prevHit = monthBucket.get(prevKey);
      const thisGross = Math.round((thisHit?.grossTotal ?? 0) * 100) / 100;
      const prevGross = Math.round((prevHit?.grossTotal ?? 0) * 100) / 100;
      let deltaPct: number | null = null;
      if (prevGross > 0) {
        deltaPct = Math.round(((thisGross - prevGross) / prevGross) * 1000) / 10;
      } else if (thisGross > 0) {
        deltaPct = 100;
      }
      return {
        month,
        label,
        thisYear: {
          year: thisYear,
          billCount: thisHit?.billCount ?? 0,
          grossTotal: thisGross,
          byBranch: mapMonthBranches(thisHit),
        },
        prevYear: {
          year: prevYear,
          billCount: prevHit?.billCount ?? 0,
          grossTotal: prevGross,
          byBranch: mapMonthBranches(prevHit),
        },
        deltaPct,
      };
    });
    const bestMonthThisYear = [...byMonthCompare]
      .filter((m) => m.thisYear.grossTotal > 0)
      .sort((a, b) => b.thisYear.grossTotal - a.thisYear.grossTotal)[0];
    const ytdThis = byMonthCompare.reduce(
      (s, m) => s + m.thisYear.grossTotal,
      0,
    );
    const ytdPrev = byMonthCompare.reduce((s, m) => {
      if (m.month > currentMonth) return s;
      return s + m.prevYear.grossTotal;
    }, 0);
    const ytdThisPartial = byMonthCompare.reduce((s, m) => {
      if (m.month > currentMonth) return s;
      return s + m.thisYear.grossTotal;
    }, 0);

    const yearBranchMap = new Map<
      number,
      Map<string, { billCount: number; grossTotal: number }>
    >();
    const yearTotals = new Map<
      number,
      { billCount: number; grossTotal: number }
    >();
    for (const r of yearBranchRows) {
      const year = Number(r.year);
      const map = yearBranchMap.get(year) ?? new Map();
      const gross = Math.round(Number(r.grossTotal ?? 0) * 100) / 100;
      const bills = r.billCount ?? 0;
      map.set(r.branchId, { billCount: bills, grossTotal: gross });
      yearBranchMap.set(year, map);
      const tot = yearTotals.get(year) ?? { billCount: 0, grossTotal: 0 };
      tot.billCount += bills;
      tot.grossTotal += gross;
      yearTotals.set(year, tot);
    }
    const byYear = [...yearTotals.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([year, tot]) => {
        const branchMap = yearBranchMap.get(year);
        return {
          year,
          billCount: tot.billCount,
          grossTotal: Math.round(tot.grossTotal * 100) / 100,
          byBranch: branches.map((b) => {
            const hit = branchMap?.get(b.id);
            return {
              branchId: b.id,
              branchName: b.name,
              billCount: hit?.billCount ?? 0,
              grossTotal: hit?.grossTotal ?? 0,
            };
          }),
        };
      });
    const bestYear = [...byYear].sort(
      (a, b) => b.grossTotal - a.grossTotal,
    )[0];

    return {
      today: {
        billCount: todayRows[0]?.billCount ?? 0,
        grossTotal: Number(todayRows[0]?.grossTotal ?? 0),
      },
      yesterday: {
        billCount: yesterdayRows[0]?.billCount ?? 0,
        grossTotal: Number(yesterdayRows[0]?.grossTotal ?? 0),
      },
      week: {
        billCount: weekBillCount,
        grossTotal: Math.round(weekGross * 100) / 100,
      },
      all: {
        billCount: allRows[0]?.billCount ?? 0,
        grossTotal: Number(allRows[0]?.grossTotal ?? 0),
      },
      productCount: productCount[0]?.c ?? 0,
      memberCount: memberCount[0]?.c ?? 0,
      branches,
      last7Days,
      todayByBranch,
      todayByPayment,
      byWeekday,
      bestWeekday: bestWeekday
        ? {
            label: bestWeekday.label,
            name: bestWeekday.name,
            avgGross: bestWeekday.avgGross,
            dayCount: bestWeekday.dayCount,
            byBranch: bestWeekday.byBranch,
          }
        : null,
      weekdayRangeDays: 56,
      yearCompare: {
        thisYear,
        prevYear,
        byMonth: byMonthCompare,
        bestMonthThisYear: bestMonthThisYear
          ? {
              month: bestMonthThisYear.month,
              label: bestMonthThisYear.label,
              grossTotal: bestMonthThisYear.thisYear.grossTotal,
            }
          : null,
        ytd: {
          thisYear: Math.round(ytdThisPartial * 100) / 100,
          prevYear: Math.round(ytdPrev * 100) / 100,
          deltaPct:
            ytdPrev > 0
              ? Math.round(
                  ((ytdThisPartial - ytdPrev) / ytdPrev) * 1000,
                ) / 10
              : ytdThisPartial > 0
                ? 100
                : null,
        },
        thisYearTotal: Math.round(ytdThis * 100) / 100,
      },
      byYear,
      bestYear: bestYear
        ? {
            year: bestYear.year,
            grossTotal: bestYear.grossTotal,
            billCount: bestYear.billCount,
          }
        : null,
      freshTop: this.freshTopFromLines(freshLineRows, todayIso),
    };
  }

  async branches() {
    const fromTable = (
      await this.database.db
        .select()
        .from(pg.branches)
        .where(isNull(pg.branches.deletedAt))
    ).filter((b) => Boolean(b.active));
    const fromSales = await this.database.db
      .selectDistinct({
        branchId: pg.sales.branchId,
      })
      .from(pg.sales);

    const map = new Map<string, { id: string; code: string; name: string }>();
    for (const b of fromTable) {
      map.set(b.id, { id: b.id, code: b.code, name: b.name });
    }
    for (const s of fromSales) {
      if (!map.has(s.branchId)) {
        map.set(s.branchId, {
          id: s.branchId,
          code: s.branchId.replace(/^branch-/, ""),
          name: s.branchId,
        });
      }
    }
    if (!map.size) {
      map.set("branch-001", {
        id: "branch-001",
        code: "001",
        name: "สาขาหลุมดิน",
      });
    }
    return { branches: [...map.values()].sort((a, b) => {
      const rank = (n: string) =>
        /หลุมดิน/.test(n) ? 0 : /เจ็ดเสมียน/.test(n) ? 1 : 2;
      const d = rank(a.name) - rank(b.name);
      return d !== 0 ? d : a.code.localeCompare(b.code, "th");
    }) };
  }

  async report(opts: ReportQuery = {}) {
    const groupBy = opts.groupBy ?? "day";
    const where = this.saleFilters(opts);

    const salesRows = await this.database.db
      .select()
      .from(pg.sales)
      .where(where)
      .orderBy(desc(pg.sales.createdAt));

    let filtered = salesRows;
    if (opts.paymentMethod) {
      const payRows = await this.database.db
        .selectDistinct({ saleId: pg.salePayments.saleId })
        .from(pg.salePayments)
        .where(eq(pg.salePayments.method, opts.paymentMethod));
      const allowed = new Set(payRows.map((r) => r.saleId));
      filtered = salesRows.filter((s) => allowed.has(s.id));
    }

    const saleIds = filtered.map((s) => s.id);
    const payments =
      saleIds.length === 0
        ? []
        : await this.database.db
            .select()
            .from(pg.salePayments)
            .where(
              sql`${pg.salePayments.saleId} in (${sql.join(
                saleIds.map((id) => sql`${id}`),
                sql`, `,
              )})`,
            );

    const billCount = filtered.length;
    const grossTotal = filtered.reduce((s, r) => s + Number(r.total), 0);
    const discountTotal = filtered.reduce((s, r) => s + Number(r.discount), 0);
    const pointsEarned = filtered.reduce((s, r) => s + r.pointsEarned, 0);
    const pointsRedeemed = filtered.reduce((s, r) => s + r.pointsRedeemed, 0);

    const byPaymentMap = new Map<string, { method: string; amount: number; count: number }>();
    for (const p of payments) {
      if (p.method === "points") continue; // ส่วนลดแต้ม — ไม่นับเป็นช่องทางชำระ
      if (opts.paymentMethod && p.method !== opts.paymentMethod) continue;
      const cur = byPaymentMap.get(p.method) ?? {
        method: p.method,
        amount: 0,
        count: 0,
      };
      cur.amount += Number(p.amount);
      cur.count += 1;
      byPaymentMap.set(p.method, cur);
    }

    const byBranchMap = new Map<
      string,
      {
        branchId: string;
        billCount: number;
        grossTotal: number;
        discountTotal: number;
        pointsEarned: number;
        pointsRedeemed: number;
      }
    >();
    for (const s of filtered) {
      const cur = byBranchMap.get(s.branchId) ?? {
        branchId: s.branchId,
        billCount: 0,
        grossTotal: 0,
        discountTotal: 0,
        pointsEarned: 0,
        pointsRedeemed: 0,
      };
      cur.billCount += 1;
      cur.grossTotal += Number(s.total);
      cur.discountTotal += Number(s.discount);
      cur.pointsEarned += s.pointsEarned;
      cur.pointsRedeemed += s.pointsRedeemed;
      byBranchMap.set(s.branchId, cur);
    }

    const branchIds = [...byBranchMap.keys()];
    const branchNameMap = new Map<string, string>();
    if (branchIds.length) {
      const branchRows = await this.database.db
        .select({
          id: pg.branches.id,
          name: pg.branches.name,
          code: pg.branches.code,
        })
        .from(pg.branches)
        .where(
          sql`${pg.branches.id} in (${sql.join(
            branchIds.map((id) => sql`${id}`),
            sql`, `,
          )})`,
        );
      for (const b of branchRows) {
        branchNameMap.set(b.id, b.name || b.code || b.id);
      }
    }

    // เงินโอน → ใช้ PromptPay ที่ snapshot ตอน sync (รัฐไม่นับเข้าบัญชีนี้)
    const saleBranchMap = new Map(filtered.map((s) => [s.id, s.branchId]));
    const byPromptPayMap = new Map<
      string,
      {
        promptPayId: string | null;
        promptPayName: string | null;
        branchIds: Set<string>;
        amount: number;
        count: number;
      }
    >();
    for (const p of payments) {
      if (p.method !== "transfer") continue;
      if (opts.paymentMethod && p.method !== opts.paymentMethod) continue;
      const branchId = saleBranchMap.get(p.saleId);
      if (!branchId) continue;
      const promptPayId =
        String(p.promptPayId ?? "").replace(/\D/g, "") || null;
      const promptPayName = p.promptPayName?.trim() || null;
      const key = promptPayId ? `id:${promptPayId}` : `__unset__:${branchId}`;
      const cur = byPromptPayMap.get(key) ?? {
        promptPayId,
        promptPayName,
        branchIds: new Set<string>(),
        amount: 0,
        count: 0,
      };
      cur.branchIds.add(branchId);
      if (!cur.promptPayName && promptPayName) cur.promptPayName = promptPayName;
      cur.amount += Number(p.amount);
      cur.count += 1;
      byPromptPayMap.set(key, cur);
    }
    const byPromptPay = [...byPromptPayMap.values()]
      .map((r) => ({
        promptPayId: r.promptPayId,
        promptPayName: r.promptPayName,
        branchIds: [...r.branchIds],
        branchNames: [...r.branchIds]
          .map((id) => branchNameMap.get(id) ?? id)
          .sort((a, b) => a.localeCompare(b, "th")),
        amount: Math.round(r.amount * 100) / 100,
        count: r.count,
      }))
      .sort((a, b) => b.amount - a.amount);

    const seriesMap = new Map<
      string,
      {
        period: string;
        billCount: number;
        grossTotal: number;
        byBranch: Map<
          string,
          { branchId: string; billCount: number; grossTotal: number }
        >;
      }
    >();
    for (const s of filtered) {
      const period = bangkokPeriod(s.createdAt, groupBy);
      const cur = seriesMap.get(period) ?? {
        period,
        billCount: 0,
        grossTotal: 0,
        byBranch: new Map(),
      };
      cur.billCount += 1;
      cur.grossTotal += Number(s.total);
      const br = cur.byBranch.get(s.branchId) ?? {
        branchId: s.branchId,
        billCount: 0,
        grossTotal: 0,
      };
      br.billCount += 1;
      br.grossTotal += Number(s.total);
      cur.byBranch.set(s.branchId, br);
      seriesMap.set(period, cur);
    }

    const series = [...seriesMap.values()]
      .map((r) => ({
        period: r.period,
        billCount: r.billCount,
        grossTotal: r.grossTotal,
        byBranch: [...r.byBranch.values()]
          .map((b) => ({
            branchId: b.branchId,
            branchName: branchNameMap.get(b.branchId) ?? b.branchId,
            billCount: b.billCount,
            grossTotal: b.grossTotal,
          }))
          .sort((a, b) => {
            const rank = (n: string) =>
              /หลุมดิน/.test(n) ? 0 : /เจ็ดเสมียน/.test(n) ? 1 : 2;
            const d = rank(a.branchName) - rank(b.branchName);
            return d !== 0
              ? d
              : a.branchName.localeCompare(b.branchName, "th");
          }),
      }))
      .sort((a, b) => a.period.localeCompare(b.period));

    const byBranch = [...byBranchMap.values()]
      .map((r) => ({
        branchId: r.branchId,
        branchName: branchNameMap.get(r.branchId) ?? r.branchId,
        billCount: r.billCount,
        grossTotal: r.grossTotal,
        discountTotal: r.discountTotal,
        avgBill: r.billCount ? r.grossTotal / r.billCount : 0,
        pointsEarned: r.pointsEarned,
        pointsRedeemed: r.pointsRedeemed,
      }))
      .sort((a, b) => {
        const rank = (n: string) =>
          /หลุมดิน/.test(n) ? 0 : /เจ็ดเสมียน/.test(n) ? 1 : 2;
        const d = rank(a.branchName) - rank(b.branchName);
        return d !== 0
          ? d
          : a.branchName.localeCompare(b.branchName, "th");
      });

    return {
      filters: {
        from: opts.from ?? null,
        to: opts.to ?? null,
        branchId: opts.branchId ?? null,
        paymentMethod: opts.paymentMethod ?? null,
        groupBy,
      },
      summary: {
        billCount,
        grossTotal,
        discountTotal,
        avgBill: billCount ? grossTotal / billCount : 0,
        pointsEarned,
        pointsRedeemed,
      },
      byPayment: [...byPaymentMap.values()].sort((a, b) => b.amount - a.amount),
      /** เงินโอน แยกตาม PromptPay ที่ snapshot ตอน sync (ไม่รวมรัฐ) */
      byPromptPay,
      byBranch,
      series,
      sales:
        (opts.includeSales ?? groupBy === "day")
          ? filtered.map((r) =>
              this.mapSale(
                r,
                payments.filter((p) => p.saleId === r.id),
              ),
            )
          : [],
    };
  }

  /** ใช้ตอน sync — ยึดทุนปัจจุบันในแอดมิน */
  async snapshotProfit(
    lines: Array<{
      id: string;
      barcode: string;
      productCode?: string | null;
      name?: string | null;
      qty: number;
      lineTotal: number;
    }>,
    billDiscount: number,
  ) {
    const lookup = await this.loadCostLookup();
    return priceBillProfit(lines, billDiscount, lookup);
  }

  ensureProfitBackfill() {
    if (!this.backfillPromise) {
      this.backfillPromise = this.backfillProfit().catch((err) => {
        this.backfillPromise = null;
        this.logger.warn(
          `backfill profit failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      });
    }
    return this.backfillPromise;
  }

  private kgBackfillPromise: Promise<void> | null = null;

  ensureKgPriceBackfill() {
    if (!this.kgBackfillPromise) {
      this.kgBackfillPromise = this.backfillPricePerKg().catch((err) => {
        this.kgBackfillPromise = null;
        this.logger.warn(
          `backfill price/kg failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      });
    }
    return this.kgBackfillPromise;
  }

  private freshKgRepairPromise: Promise<void> | null = null;

  /** แก้สูตรของสดที่เคยคิดทุน×1 ชิ้น — ใช้ทุน/กก.×น้ำหนักจากยอดขาย (ไม่ดึงทุน master ใหม่) */
  ensureFreshKgCostRepair() {
    if (!this.freshKgRepairPromise) {
      this.freshKgRepairPromise = this.repairFreshKgCosts().catch((err) => {
        this.freshKgRepairPromise = null;
        this.logger.warn(
          `repair fresh kg cost failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      });
    }
    return this.freshKgRepairPromise;
  }

  private async repairFreshKgCosts() {
    const monthStart = thisMonthBangkokStart();
    const round2 = (n: number) => Math.round(n * 100) / 100;
    let fixed = 0;
    const saleIds = new Set<string>();

    const lines = await this.database.db
      .select({
        id: pg.saleLines.id,
        saleId: pg.saleLines.saleId,
        barcode: pg.saleLines.barcode,
        productCode: pg.saleLines.productCode,
        qty: pg.saleLines.qty,
        lineTotal: pg.saleLines.lineTotal,
        netRevenue: pg.saleLines.netRevenue,
        unitCost: pg.saleLines.unitCost,
        lineCost: pg.saleLines.lineCost,
        pricePerKg: pg.saleLines.pricePerKg,
        costStatus: pg.saleLines.costStatus,
      })
      .from(pg.saleLines)
      .innerJoin(pg.sales, eq(pg.saleLines.saleId, pg.sales.id))
      .where(
        and(
          gte(pg.sales.createdAt, monthStart),
          eq(pg.saleLines.costStatus, "known"),
          sql`${pg.saleLines.unitCost} is not null`,
          sql`${pg.saleLines.pricePerKg} is not null`,
          sql`${pg.saleLines.pricePerKg}::numeric > 0`,
        ),
      );

    for (const line of lines) {
      if (
        !isFreshKgProduct({
          barcode: line.barcode,
          productCode: line.productCode,
        })
      ) {
        continue;
      }
      const net =
        line.netRevenue == null
          ? Number(line.lineTotal)
          : Number(line.netRevenue);
      const unitCost = Number(line.unitCost);
      const pricePerKg = Number(line.pricePerKg);
      const basis = costBasisQty(
        {
          barcode: line.barcode,
          productCode: line.productCode,
          qty: Number(line.qty),
        },
        net,
        pricePerKg,
      );
      const lineCost = round2(unitCost * basis);
      const lineProfit = round2(net - lineCost);
      const prevCost = line.lineCost == null ? null : Number(line.lineCost);
      if (prevCost != null && Math.abs(prevCost - lineCost) < 0.005) continue;
      await this.database.db
        .update(pg.saleLines)
        .set({
          lineCost: this.money(lineCost),
          lineProfit: this.money(lineProfit),
          netRevenue: this.money(net),
        })
        .where(eq(pg.saleLines.id, line.id));
      saleIds.add(line.saleId);
      fixed += 1;
    }

    for (const saleId of saleIds) {
      await this.recomputeSaleProfit(saleId);
    }
    if (fixed) {
      this.logger.log(
        `repaired fresh kg cost on ${fixed} lines / ${saleIds.size} bills`,
      );
    }
  }

  /** บิลเก่า — ยึดราคาขาย/กก. จากแอดมินครั้งเดียว */
  private async backfillPricePerKg() {
    const lookup = await this.loadCostLookup();
    let filled = 0;
    for (;;) {
      const lines = await this.database.db
        .select({
          id: pg.saleLines.id,
          barcode: pg.saleLines.barcode,
          productCode: pg.saleLines.productCode,
        })
        .from(pg.saleLines)
        .where(
          and(
            eq(pg.saleLines.kgPriced, 0),
            sql`(
              ${pg.saleLines.barcode} like '9%'
              or coalesce(${pg.saleLines.productCode}, '') like '9%'
            )`,
          ),
        )
        .limit(200);
      if (!lines.length) break;
      for (const line of lines) {
        const price = pricePerKgForLine(line, lookup);
        await this.database.db
          .update(pg.saleLines)
          .set({
            pricePerKg: this.money(price),
            kgPriced: 1,
          })
          .where(eq(pg.saleLines.id, line.id));
        filled += 1;
      }
    }
    if (filled) this.logger.log(`snapshotted price/kg on ${filled} lines`);
  }

  private freshTopFromLines(
    rows: Array<{
      createdAt: Date;
      barcode: string;
      productCode: string | null;
      name: string;
      qty: string | number;
      lineTotal: string | number;
      pricePerKg: string | number | null;
    }>,
    todayIso: string,
  ) {
    const mapLine = (r: (typeof rows)[number]) => ({
      barcode: r.barcode,
      productCode: r.productCode,
      name: r.name,
      qty: Number(r.qty) || 0,
      lineTotal: Number(r.lineTotal) || 0,
      pricePerKg: r.pricePerKg == null ? null : Number(r.pricePerKg),
    });
    const todayRows = rows.filter(
      (r) => bangkokPeriod(r.createdAt, "day") === todayIso,
    );
    const today = rankFreshLines(todayRows.map(mapLine));
    const week = rankFreshLines(rows.map(mapLine));
    return { today, week };
  }

  private async loadCostLookup(): Promise<CostLookup> {
    const rows = await this.database.db
      .select({
        barcode: pg.products.barcode,
        productCode: pg.products.productCode,
        costPrice: pg.products.costPrice,
        sellPrice: pg.products.price,
        isOpenPrice: pg.products.isOpenPrice,
        deletedAt: pg.products.deletedAt,
        active: pg.products.active,
        updatedAt: pg.products.updatedAt,
      })
      .from(pg.products);
    const items: CostCatalogItem[] = rows.map((r) => ({
      barcode: r.barcode,
      productCode: r.productCode,
      costPrice: r.costPrice == null ? null : Number(r.costPrice),
      sellPrice: r.sellPrice == null ? null : Number(r.sellPrice),
      isOpenPrice: Boolean(r.isOpenPrice),
      deleted: r.deletedAt != null,
      active: Boolean(r.active),
      updatedAt: r.updatedAt?.getTime?.() ?? 0,
    }));
    return buildCostLookup(items);
  }

  private money(n: number | null | undefined) {
    return n == null ? null : String(n);
  }

  /**
   * บิลเดือนนี้ที่ยังไม่เคยคิดกำไร (cost_status null) — คิดครั้งเดียวแล้วยึดไว้
   * ใส่ทุนทีหลังไม่ย้อนแก้บิลเก่า · เบ็ดเตล็ดเก่า (SKU-00000128) จัดเป็นประมาณการ 15%
   */
  private async backfillProfit() {
    const monthStart = profitBackfillFrom();
    const lookup = await this.loadCostLookup();
    let filled = 0;
    for (;;) {
      const pending = await this.database.db
        .select({
          id: pg.sales.id,
          discount: pg.sales.discount,
        })
        .from(pg.sales)
        .where(
          and(
            gte(pg.sales.createdAt, monthStart),
            sql`exists (
              select 1 from sale_lines sl
              where sl.sale_id = ${pg.sales.id}
                and (
                  sl.cost_status is null
                  or (
                    sl.cost_status = 'missing'
                    and (
                      coalesce(sl.product_code, '') in ('SKU-00000128', 'OPENPRICE')
                      or coalesce(sl.name, '') like '%เบ็ดเตล็ด%'
                      or coalesce(sl.barcode, '') ilike 'OPENPRICE%'
                    )
                  )
                )
            )`,
          ),
        )
        .limit(40);
      if (!pending.length) break;

      const ids = pending.map((s) => s.id);
      const lineRows = await this.database.db
        .select()
        .from(pg.saleLines)
        .where(inArray(pg.saleLines.saleId, ids));
      const bySale = new Map<string, typeof lineRows>();
      for (const line of lineRows) {
        const list = bySale.get(line.saleId) ?? [];
        list.push(line);
        bySale.set(line.saleId, list);
      }

      for (const sale of pending) {
        const lines = bySale.get(sale.id) ?? [];
        const priced = priceBillProfit(
          lines.map((l) => ({
            id: l.id,
            barcode: l.barcode,
            productCode: l.productCode,
            name: l.name,
            qty: Number(l.qty),
            lineTotal: Number(l.lineTotal),
          })),
          Number(sale.discount ?? 0),
          lookup,
        );
        const byId = new Map(priced.lines.map((l) => [l.id, l]));
        for (const line of lines) {
          const p = byId.get(line.id);
          if (!p) continue;
          // ทับได้เฉพาะยังไม่คิด · หรือรายการประมาณการ % (เปิดราคา 15% / หมูสดอื่นๆ 20%)
          const canWrite =
            line.costStatus == null || p.costStatus === "estimated";
          if (!canWrite) continue;
          await this.database.db
            .update(pg.saleLines)
            .set({
              netRevenue: this.money(p.netRevenue),
              costStatus: p.costStatus,
              unitCost: this.money(p.unitCost),
              lineCost: this.money(p.lineCost),
              lineProfit: this.money(p.lineProfit),
              pricePerKg: this.money(p.pricePerKg),
              kgPriced: 1,
            })
            .where(eq(pg.saleLines.id, line.id));
        }
        // รวมยอดบิลจากบรรทัดล่าสุดหลัง merge
        const refreshed = await this.database.db
          .select()
          .from(pg.saleLines)
          .where(eq(pg.saleLines.saleId, sale.id));
        let profit = 0;
        let costAmount = 0;
        let knownRevenue = 0;
        let missingRevenue = 0;
        let missingLineCount = 0;
        let estimatedProfit = 0;
        let estimatedRevenue = 0;
        for (const l of refreshed) {
          const net = l.netRevenue == null ? Number(l.lineTotal) : Number(l.netRevenue);
          if (l.costStatus === "missing" || l.costStatus == null) {
            missingRevenue += net;
            missingLineCount += 1;
            continue;
          }
          profit += Number(l.lineProfit ?? 0);
          costAmount += Number(l.lineCost ?? 0);
          if (l.costStatus === "estimated") {
            estimatedProfit += Number(l.lineProfit ?? 0);
            estimatedRevenue += net;
          } else {
            knownRevenue += net;
          }
        }
        const round2 = (n: number) => Math.round(n * 100) / 100;
        await this.database.db
          .update(pg.sales)
          .set({
            profit: this.money(round2(profit)),
            costAmount: this.money(round2(costAmount)),
            knownRevenue: this.money(round2(knownRevenue)),
            missingRevenue: this.money(round2(missingRevenue)),
            missingLineCount,
            estimatedProfit: this.money(round2(estimatedProfit)),
            estimatedRevenue: this.money(round2(estimatedRevenue)),
          })
          .where(eq(pg.sales.id, sale.id));
        filled += 1;
      }
    }
    if (filled) {
      this.logger.log(
        `backfilled profit on ${filled} sales since ${monthStart.toISOString()}`,
      );
    }
  }

  async profitReport(opts: ReportQuery = {}) {
    await this.ensureProfitBackfill();
    await this.ensureFreshKgCostRepair();
    // แสดงเฉพาะบิลที่คิดกำไรแล้ว (เดือนนี้ที่ backfill + บิลใหม่หลัง sync)
    const where = and(
      this.saleFilters(opts),
      sql`${pg.sales.profit} is not null`,
    );
    const dayExpr = sql<string>`to_char(${pg.sales.createdAt} AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM-DD')`;

    const [sumRow] = await this.database.db
      .select({
        billCount: sql<number>`count(*)::int`,
        salesTotal: sql<string>`coalesce(sum(${pg.sales.total}), 0)`,
        profit: sql<string>`coalesce(sum(${pg.sales.profit}), 0)`,
        costAmount: sql<string>`coalesce(sum(${pg.sales.costAmount}), 0)`,
        knownRevenue: sql<string>`coalesce(sum(${pg.sales.knownRevenue}), 0)`,
        missingRevenue: sql<string>`coalesce(sum(${pg.sales.missingRevenue}), 0)`,
        missingLineCount: sql<number>`coalesce(sum(${pg.sales.missingLineCount}), 0)::int`,
        estimatedProfit: sql<string>`coalesce(sum(${pg.sales.estimatedProfit}), 0)`,
        estimatedRevenue: sql<string>`coalesce(sum(${pg.sales.estimatedRevenue}), 0)`,
        billsWithMissing: sql<number>`count(*) filter (where ${pg.sales.missingLineCount} > 0)::int`,
      })
      .from(pg.sales)
      .where(where);

    const dayRows = await this.database.db
      .select({
        day: dayExpr,
        billCount: sql<number>`count(*)::int`,
        salesTotal: sql<string>`coalesce(sum(${pg.sales.total}), 0)`,
        profit: sql<string>`coalesce(sum(${pg.sales.profit}), 0)`,
        knownRevenue: sql<string>`coalesce(sum(${pg.sales.knownRevenue}), 0)`,
        missingRevenue: sql<string>`coalesce(sum(${pg.sales.missingRevenue}), 0)`,
        estimatedProfit: sql<string>`coalesce(sum(${pg.sales.estimatedProfit}), 0)`,
      })
      .from(pg.sales)
      .where(where)
      .groupBy(dayExpr)
      .orderBy(sql`${dayExpr} desc`);

    const lineWhere = and(
      where,
      eq(pg.saleLines.costStatus, "missing"),
    );
    const missingLines = await this.database.db
      .select({
        name: pg.saleLines.name,
        barcode: pg.saleLines.barcode,
        productCode: pg.saleLines.productCode,
        qty: pg.saleLines.qty,
        netRevenue: pg.saleLines.netRevenue,
        lineTotal: pg.saleLines.lineTotal,
        saleId: pg.saleLines.saleId,
      })
      .from(pg.saleLines)
      .innerJoin(pg.sales, eq(pg.saleLines.saleId, pg.sales.id))
      .where(lineWhere);

    const missingMap = new Map<
      string,
      {
        name: string;
        barcode: string;
        productCode: string | null;
        qty: number;
        revenue: number;
        billIds: Set<string>;
      }
    >();
    for (const line of missingLines) {
      const key = `${line.productCode || ""}|${line.barcode}|${line.name}`;
      const cur = missingMap.get(key) ?? {
        name: line.name,
        barcode: line.barcode,
        productCode: line.productCode,
        qty: 0,
        revenue: 0,
        billIds: new Set<string>(),
      };
      cur.qty += Number(line.qty) || 0;
      cur.revenue += Number(line.netRevenue ?? line.lineTotal) || 0;
      cur.billIds.add(line.saleId);
      missingMap.set(key, cur);
    }

    const productRows = await this.database.db
      .select({
        id: pg.products.id,
        name: pg.products.name,
        barcode: pg.products.barcode,
        productCode: pg.products.productCode,
      })
      .from(pg.products)
      .where(isNull(pg.products.deletedAt));
    const productByCode = new Map<string, string>();
    const productByBarcode = new Map<string, string>();
    const productNameById = new Map<string, string>();
    for (const p of productRows) {
      const code = p.productCode?.trim();
      if (code && !productByCode.has(code)) productByCode.set(code, p.id);
      const barcode = p.barcode?.trim();
      if (barcode && !productByBarcode.has(barcode)) {
        productByBarcode.set(barcode, p.id);
      }
      productNameById.set(p.id, String(p.name ?? "").trim());
    }
    const resolveProductId = (
      productCode: string | null,
      barcode: string,
      name?: string | null,
    ): string | null => {
      const code = String(productCode ?? "").trim();
      const b = String(barcode ?? "").trim();
      const byCode = code ? productByCode.get(code) : undefined;
      let byBarcode: string | undefined;
      if (b && productByBarcode.has(b)) byBarcode = productByBarcode.get(b);
      else if (/^9\d{12}$/.test(b)) {
        const six = b.slice(1, 7);
        if (productByBarcode.has(six)) byBarcode = productByBarcode.get(six);
      }

      if (byCode && byBarcode && byCode !== byBarcode) {
        // บิลบางใบ SKU กับบาร์โค้ดคนละตัว (เช่น หมูแดดโค้ดผิดแต่บาร์ 900059 ถูก)
        // ของสด 9xxxxx → เชื่อบาร์โค้ด · ไม่ใช่ก็เลือกชื่อตรงกว่า
        if (/^9\d{5}$/.test(b) || /^9\d{12}$/.test(b)) return byBarcode;
        const needle = String(name ?? "").trim();
        if (needle) {
          const nameCode = productNameById.get(byCode) ?? "";
          const nameBar = productNameById.get(byBarcode) ?? "";
          if (nameBar === needle && nameCode !== needle) return byBarcode;
          if (nameCode === needle && nameBar !== needle) return byCode;
        }
        return byBarcode;
      }
      return byCode ?? byBarcode ?? null;
    };

    const billRows = await this.database.db
      .select({
        id: pg.sales.id,
        billNo: pg.sales.billNo,
        branchId: pg.sales.branchId,
        branchName: pg.branches.name,
        createdAt: pg.sales.createdAt,
        total: pg.sales.total,
        profit: pg.sales.profit,
        knownRevenue: pg.sales.knownRevenue,
        missingRevenue: pg.sales.missingRevenue,
        missingLineCount: pg.sales.missingLineCount,
        estimatedProfit: pg.sales.estimatedProfit,
        costAmount: pg.sales.costAmount,
      })
      .from(pg.sales)
      .leftJoin(pg.branches, eq(pg.branches.id, pg.sales.branchId))
      .where(where)
      // บิลไม่มีทุนขึ้นก่อน · ไม่ตัด 500 (เดี๋ยวคลิกวันต้นเดือนแล้วรายบิลหาย)
      .orderBy(
        sql`case when coalesce(${pg.sales.missingLineCount}, 0) > 0 then 0 else 1 end`,
        desc(pg.sales.createdAt),
      );

    const num = (v: string | number | null | undefined) => Number(v ?? 0);
    const knownRevenue = num(sumRow?.knownRevenue);
    const estimatedRevenue = num(sumRow?.estimatedRevenue);
    const profit = num(sumRow?.profit);
    const base = knownRevenue + estimatedRevenue;
    const knownProfit = Math.round((profit - num(sumRow?.estimatedProfit)) * 100) / 100;

    return {
      openPriceMargin: 0.15,
      filters: {
        from: opts.from ?? null,
        to: opts.to ?? null,
        branchId: opts.branchId ?? null,
      },
      summary: {
        billCount: sumRow?.billCount ?? 0,
        salesTotal: num(sumRow?.salesTotal),
        profit,
        knownProfit,
        knownRevenue,
        knownCost: Math.round((knownRevenue - knownProfit) * 100) / 100,
        marginPct: base > 0 ? Math.round((profit / base) * 10000) / 100 : null,
        knownMarginPct:
          knownRevenue > 0
            ? Math.round((knownProfit / knownRevenue) * 10000) / 100
            : null,
        costAmount: num(sumRow?.costAmount),
        estimatedProfit: num(sumRow?.estimatedProfit),
        estimatedRevenue,
        missingRevenue: num(sumRow?.missingRevenue),
        missingLineCount: sumRow?.missingLineCount ?? 0,
        billsWithMissing: sumRow?.billsWithMissing ?? 0,
      },
      byDay: dayRows.map((r) => ({
        day: r.day,
        billCount: r.billCount,
        salesTotal: num(r.salesTotal),
        profit: num(r.profit),
        knownRevenue: num(r.knownRevenue),
        missingRevenue: num(r.missingRevenue),
        estimatedProfit: num(r.estimatedProfit),
      })),
      bills: billRows.map((r) => {
        const day = bangkokPeriod(r.createdAt, "day");
        const billProfit = num(r.profit);
        const billEst = num(r.estimatedProfit);
        return {
          id: r.id,
          billNo: r.billNo,
          branchId: r.branchId,
          branchName: r.branchName ?? r.branchId,
          day,
          createdAt: r.createdAt.toISOString(),
          total: num(r.total),
          profit: billProfit,
          knownProfit: Math.round((billProfit - billEst) * 100) / 100,
          estimatedProfit: billEst,
          costAmount: num(r.costAmount),
          knownRevenue: num(r.knownRevenue),
          missingRevenue: num(r.missingRevenue),
          missingLineCount: r.missingLineCount ?? 0,
        };
      }),
      missingProducts: [...missingMap.values()]
        .map((r) => ({
          productId: resolveProductId(r.productCode, r.barcode, r.name),
          name: r.name,
          barcode: r.barcode,
          productCode: r.productCode,
          qty: Math.round(r.qty * 1000) / 1000,
          revenue: Math.round(r.revenue * 100) / 100,
          billCount: r.billIds.size,
        }))
        .sort((a, b) => b.revenue - a.revenue),
    };
  }
}
