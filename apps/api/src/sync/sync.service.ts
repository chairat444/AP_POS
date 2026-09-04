import { Injectable } from "@nestjs/common";
import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";
import { pg } from "@ap-pos/db";
import { MembersService } from "../members/members.service";
import { ProductsService } from "../products/products.service";
import { BranchesService } from "../branches/branches.service";
import { StaffService } from "../staff/staff.service";
import { PromosService } from "../promos/promos.service";
import { SettingsService } from "../settings/settings.service";
import { TerminalsService } from "../terminals/terminals.service";
import { ShiftsService } from "../shifts/shifts.service";
import { NotifyService } from "../notify/notify.service";
import type { RegisterTerminalDto } from "../terminals/terminal.types";
import type { SyncedShiftPayload } from "../shifts/shift.types";
import { DatabaseService } from "../db/database.service";

type SyncedSaleLine = {
  id: string;
  barcode: string;
  productCode?: string;
  name: string;
  qty: number;
  unit: string;
  unitPrice: number;
  discount: number;
  lineTotal: number;
};

type SyncedPayment = {
  method: "cash" | "transfer" | "government" | "points";
  amount: number;
  tendered?: number;
};

type SyncedSale = {
  id: string;
  billNo: string;
  branchId: string;
  terminalId: string;
  shiftId?: string | null;
  customerId?: string | null;
  customerName?: string;
  subtotal: number;
  discount: number;
  total: number;
  paid: number;
  change: number;
  pointsRedeemed: number;
  pointsEarned: number;
  createdAt: string;
  syncedAt?: string;
  payments: SyncedPayment[];
  lines: SyncedSaleLine[];
};

type SyncOutboxEnvelope = {
  id: string;
  type: "sale";
  payload: SyncedSale;
};

function nowIso() {
  return new Date().toISOString();
}

function maxIso(values: Array<string | undefined | null>) {
  return values.filter(Boolean).sort().at(-1) ?? nowIso();
}

function bangkokDayStart(isoDate: string) {
  return new Date(`${isoDate}T00:00:00.000+07:00`);
}

function bangkokDayEnd(isoDate: string) {
  return new Date(`${isoDate}T23:59:59.999+07:00`);
}

function bangkokToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

@Injectable()
export class SyncService {
  constructor(
    private readonly products: ProductsService,
    private readonly members: MembersService,
    private readonly branches: BranchesService,
    private readonly staff: StaffService,
    private readonly promos: PromosService,
    private readonly settings: SettingsService,
    private readonly terminals: TerminalsService,
    private readonly shifts: ShiftsService,
    private readonly database: DatabaseService,
    private readonly notify: NotifyService,
  ) {}

  listProducts() {
    return this.products.listActive();
  }

  listTerminals(branchId?: string) {
    return this.terminals.list({
      branchId: branchId || undefined,
      activeOnly: true,
    });
  }

  registerTerminal(dto: RegisterTerminalDto) {
    return this.terminals.register(dto);
  }

  claimTerminal(dto: { id: string; branchId: string }) {
    return this.terminals.claim(dto);
  }

  acceptShifts(shifts: SyncedShiftPayload[]) {
    return this.shifts.acceptMany(shifts);
  }

  async getShift(id: string) {
    const row = await this.shifts.get(id);
    return {
      id: row.id,
      openCash: row.openCash,
      billCount: row.billCount,
      grossTotal: row.grossTotal,
      status: row.status,
    };
  }

  acceptAudits(
    audits: Array<{
      id: string;
      shiftId: string;
      branchId: string;
      terminalId: string;
      staffId?: string | null;
      staffName: string;
      type: string;
      at: string;
      barcode?: string | null;
      productName?: string | null;
      qty?: number | null;
      amount: number;
      billTotalBefore?: number | null;
      itemCountBefore?: number | null;
    }>,
  ) {
    return this.shifts.acceptAudits(audits);
  }

  async listBranches() {
    return this.branches.list({ activeOnly: true });
  }

  async listStaff() {
    const { staff } = await this.staff.list();
    return {
      staff: staff
        .filter((s) => s.active && s.code !== "admin")
        .map((s) => ({
          id: s.id,
          code: s.code,
          name: s.name,
          pin: s.pin,
          role: s.role,
          commissionEnabled: s.commissionEnabled,
          commissionStartSales: s.commissionStartSales,
          commissionStepSales: s.commissionStepSales,
          commissionPerStep: s.commissionPerStep,
        })),
    };
  }

  async staffDaySales(staffId: string, excludeShiftId?: string) {
    return this.shifts.priorClosedGrossToday({ staffId, excludeShiftId });
  }

  /** บิลทั้งวันของสาขา — สำหรับกู้รอบ / รวม session บน POS */
  async daySales(branchId: string, day?: string) {
    const dayKey =
      day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : bangkokToday();
    if (!branchId) return { day: dayKey, branchId, sales: [] as unknown[] };

    const rows = await this.database.db
      .select()
      .from(pg.sales)
      .where(
        and(
          eq(pg.sales.branchId, branchId),
          eq(pg.sales.status, "completed"),
          gte(pg.sales.createdAt, bangkokDayStart(dayKey)),
          lte(pg.sales.createdAt, bangkokDayEnd(dayKey)),
        ),
      )
      .orderBy(asc(pg.sales.createdAt))
      .limit(500);

    const payments = rows.length
      ? await this.database.db
          .select()
          .from(pg.salePayments)
          .where(
            inArray(
              pg.salePayments.saleId,
              rows.map((r) => r.id),
            ),
          )
      : [];

    const payBySale = new Map<string, typeof payments>();
    for (const p of payments) {
      const list = payBySale.get(p.saleId) ?? [];
      list.push(p);
      payBySale.set(p.saleId, list);
    }

    return {
      day: dayKey,
      branchId,
      sales: rows.map((r) => {
        const pays = payBySale.get(r.id) ?? [];
        return {
          id: r.id,
          billNo: r.billNo,
          shiftId: r.shiftId ?? null,
          total: Number(r.total),
          change: Number(r.change),
          pointsRedeemed: r.pointsRedeemed,
          pointsEarned: r.pointsEarned,
          customerName: r.customerName,
          createdAt: r.createdAt.toISOString(),
          payments: pays.map((p) => ({
            method: p.method,
            amount: Number(p.amount),
            tendered: p.tendered == null ? null : Number(p.tendered),
          })),
        };
      }),
    };
  }

  async listPromos() {
    return this.promos.list({ activeOnly: true });
  }

  async getSettings() {
    return this.settings.get();
  }

  async bootstrap() {
    const products = (await this.products.listActive()).products;
    const members = (await this.members.list()).members;
    const promos = (await this.promos.list({ activeOnly: true })).promos;
    const settings = await this.settings.get();
    const cursor = maxIso([
      ...products.map((p) => p.updatedAt),
      ...members.map((m) => m.updatedAt),
      ...promos.map((p) => p.updatedAt),
      settings.updatedAt,
    ]);
    return {
      cursor,
      products,
      members,
      promos,
      settings,
      removedProductIds: [] as string[],
      removedMemberIds: [] as string[],
      removedPromoIds: [] as string[],
    };
  }

  async changes(since?: string | null) {
    const products = await this.products.listSince(since);
    const members = await this.members.listSince(since);
    const promos = await this.promos.listSince(since);
    const settings = await this.settings.get();
    const removedProducts = await this.products.listDeletedSince(since);
    const removedMembers = await this.members.listDeletedSince(since);
    const removedPromos = await this.promos.listDeletedSince(since);
    return {
      cursor: maxIso([
        since ?? null,
        ...products.map((p) => p.updatedAt),
        ...members.map((m) => m.updatedAt),
        ...promos.map((p) => p.updatedAt),
        settings.updatedAt,
        ...removedProducts.map((x) => x.updatedAt),
        ...removedMembers.map((x) => x.updatedAt),
        ...removedPromos.map((x) => x.updatedAt),
      ]),
      products,
      members,
      promos,
      settings,
      removedProductIds: removedProducts.map((x) => x.id),
      removedMemberIds: removedMembers.map((x) => x.id),
      removedPromoIds: removedPromos.map((x) => x.id),
    };
  }

  async acceptOutbox(
    entries: Array<
      SyncOutboxEnvelope | { id: string; type: "sale"; payload: unknown }
    >,
  ) {
    let accepted = 0;
    const acceptedIds: string[] = [];
    const newlyAccepted: SyncedSale[] = [];

    for (const entry of entries) {
      if (entry.type !== "sale") continue;
      const sale = entry.payload as SyncedSale;
      const existing = await this.database.db
        .select()
        .from(pg.sales)
        .where(eq(pg.sales.id, sale.id))
        .limit(1);
      if (existing.length) {
        acceptedIds.push(entry.id);
        continue;
      }

      const syncedAt = new Date();
      const moneyPayments = (sale.payments ?? []).filter(
        (p) => p.method !== "points",
      );
      const pointsPayBaht = (sale.payments ?? [])
        .filter((p) => p.method === "points")
        .reduce((s, p) => s + Number(p.amount || 0), 0);

      // แต้ม = ส่วนลดท้ายบิล · ถ้า POS เก่ายังส่งเป็น payment ให้พับเข้า discount
      let finalDiscount = Number(sale.discount ?? 0);
      let finalTotal = Number(sale.total);
      let finalPaid = Number(sale.paid ?? 0);
      if (pointsPayBaht > 0) {
        finalDiscount = Math.round((finalDiscount + pointsPayBaht) * 100) / 100;
        finalTotal = Math.round(Math.max(0, finalTotal - pointsPayBaht) * 100) / 100;
        finalPaid = Math.round(Math.max(0, finalPaid - pointsPayBaht) * 100) / 100;
      }

      await this.database.db.insert(pg.sales).values({
        id: sale.id,
        billNo: sale.billNo,
        branchId: sale.branchId,
        terminalId: sale.terminalId,
        shiftId: sale.shiftId ?? null,
        customerId: sale.customerId ?? null,
        customerName: sale.customerName ?? null,
        subtotal: String(sale.subtotal),
        discount: String(finalDiscount),
        pointsRedeemed: Math.floor(sale.pointsRedeemed ?? 0),
        pointsEarned: Math.floor(sale.pointsEarned ?? 0),
        total: String(finalTotal),
        paid: String(finalPaid),
        change: String(sale.change ?? 0),
        status: "completed",
        createdAt: new Date(sale.createdAt),
        syncedAt,
      });

      for (const line of sale.lines ?? []) {
        await this.database.db.insert(pg.saleLines).values({
          id: line.id,
          saleId: sale.id,
          barcode: line.barcode,
          productCode: line.productCode ?? null,
          name: line.name,
          qty: String(line.qty),
          unit: line.unit,
          unitPrice: String(line.unitPrice),
          discount: String(line.discount ?? 0),
          lineTotal: String(line.lineTotal),
        });
      }

      for (let i = 0; i < moneyPayments.length; i++) {
        const p = moneyPayments[i];
        await this.database.db.insert(pg.salePayments).values({
          id: `${sale.id}:pay:${i}`,
          saleId: sale.id,
          method: p.method,
          amount: String(p.amount),
          tendered: p.tendered == null ? null : String(p.tendered),
        });
      }

      if (sale.customerId) {
        if (sale.pointsRedeemed > 0) {
          await this.applyLedger({
            id: `${sale.id}:redeem`,
            customerId: sale.customerId,
            saleId: sale.id,
            branchId: sale.branchId,
            delta: -Math.floor(sale.pointsRedeemed),
            reason: "sale_redeem",
            createdAt: sale.createdAt,
          });
        }
        if (sale.pointsEarned > 0) {
          await this.applyLedger({
            id: `${sale.id}:earn`,
            customerId: sale.customerId,
            saleId: sale.id,
            branchId: sale.branchId,
            delta: Math.floor(sale.pointsEarned),
            reason: "sale_earn",
            createdAt: sale.createdAt,
          });
        }
      }

      accepted += 1;
      acceptedIds.push(entry.id);
      newlyAccepted.push({ ...sale, total: finalTotal });
    }

    if (newlyAccepted.length) {
      // แยกแจ้งต่อสาขา (หลุมดิน / เจ็ดเสมียน ไม่ปนกัน)
      const byBranch = new Map<string, SyncedSale[]>();
      for (const s of newlyAccepted) {
        const list = byBranch.get(s.branchId) ?? [];
        list.push(s);
        byBranch.set(s.branchId, list);
      }
      for (const [branchId, sales] of byBranch) {
        const last = sales[sales.length - 1];
        let branchName: string | undefined;
        let branchCode: string | undefined;
        try {
          const b = await this.branches.get(branchId);
          branchName = b?.name;
          branchCode = b?.code;
        } catch {
          /* ignore */
        }
        void this.notify.notifyDaySalesUpdate({
          branchId,
          branchName,
          branchCode,
          billNo: last.billNo,
          total: Number(last.total),
          newCount: sales.length,
        });
      }
    }

    const totalStored = await this.database.db.select().from(pg.sales);
    return {
      accepted,
      acceptedIds,
      totalStored: totalStored.length,
    };
  }

  private async applyLedger(entry: {
    id: string;
    customerId: string;
    saleId: string;
    branchId: string;
    delta: number;
    reason: string;
    createdAt: string;
  }) {
    const existing = await this.database.db
      .select()
      .from(pg.pointLedger)
      .where(eq(pg.pointLedger.id, entry.id))
      .limit(1);
    if (existing.length) return;
    await this.database.db.insert(pg.pointLedger).values({
      id: entry.id,
      customerId: entry.customerId,
      saleId: entry.saleId,
      delta: entry.delta,
      reason: entry.reason,
      branchId: entry.branchId,
      createdAt: new Date(entry.createdAt),
    });
    await this.members.applyPointDelta(entry.customerId, entry.delta);
  }

  async recentSalesCount() {
    const rows = await this.database.db.select().from(pg.sales);
    return rows.length;
  }
}
