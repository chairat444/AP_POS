import { Injectable } from "@nestjs/common";
import { and, desc, eq, gte, isNull, lte, sql, type SQL } from "drizzle-orm";
import { pg } from "@ap-pos/db";
import { DatabaseService } from "../db/database.service";

export type ReportQuery = {
  from?: string;
  to?: string;
  branchId?: string;
  paymentMethod?: string;
  groupBy?: "day" | "month" | "year";
  limit?: number;
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
export class SalesService {
  constructor(private readonly database: DatabaseService) {}

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
        return { sales: [] as ReturnType<SalesService["mapSale"]>[] };
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
    };
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
      })),
    };
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
    const start = todayBangkokStart();

    const todayRows = await this.database.db
      .select({
        billCount: sql<number>`count(*)::int`,
        grossTotal: sql<string>`coalesce(sum(${pg.sales.total}), 0)`,
      })
      .from(pg.sales)
      .where(
        and(eq(pg.sales.status, "completed"), gte(pg.sales.createdAt, start)),
      );

    const allRows = await this.database.db
      .select({
        billCount: sql<number>`count(*)::int`,
        grossTotal: sql<string>`coalesce(sum(${pg.sales.total}), 0)`,
      })
      .from(pg.sales)
      .where(eq(pg.sales.status, "completed"));

    const productCount = await this.database.db
      .select({ c: sql<number>`count(*)::int` })
      .from(pg.products)
      .where(sql`${pg.products.deletedAt} is null`);

    const memberCount = await this.database.db
      .select({ c: sql<number>`count(*)::int` })
      .from(pg.customers)
      .where(sql`${pg.customers.deletedAt} is null`);

    return {
      today: {
        billCount: todayRows[0]?.billCount ?? 0,
        grossTotal: Number(todayRows[0]?.grossTotal ?? 0),
      },
      all: {
        billCount: allRows[0]?.billCount ?? 0,
        grossTotal: Number(allRows[0]?.grossTotal ?? 0),
      },
      productCount: productCount[0]?.c ?? 0,
      memberCount: memberCount[0]?.c ?? 0,
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
    return { branches: [...map.values()].sort((a, b) => a.code.localeCompare(b.code, "th")) };
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
        .select({ id: pg.branches.id, name: pg.branches.name, code: pg.branches.code })
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

    const seriesMap = new Map<
      string,
      { period: string; billCount: number; grossTotal: number }
    >();
    for (const s of filtered) {
      const period = bangkokPeriod(s.createdAt, groupBy);
      const cur = seriesMap.get(period) ?? {
        period,
        billCount: 0,
        grossTotal: 0,
      };
      cur.billCount += 1;
      cur.grossTotal += Number(s.total);
      seriesMap.set(period, cur);
    }

    const series = [...seriesMap.values()].sort((a, b) =>
      a.period.localeCompare(b.period),
    );

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
      .sort((a, b) => b.grossTotal - a.grossTotal);

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
      byBranch,
      series,
      sales: filtered.slice(0, 100).map((r) =>
        this.mapSale(
          r,
          payments.filter((p) => p.saleId === r.id),
        ),
      ),
    };
  }
}
