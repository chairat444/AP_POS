import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  OnModuleInit,
  forwardRef,
} from "@nestjs/common";
import { and, asc, desc, eq, gte, isNull, lte, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { pg } from "@ap-pos/db";
import { DatabaseService } from "../db/database.service";
import { CashBookService } from "../cash-book/cash-book.service";
import type {
  ExpenseCategoryRecord,
  ExpensePaidFrom,
  ExpenseRecord,
  UpsertExpenseCategoryDto,
  UpsertExpenseDto,
} from "./expense.types";

const OFFICE_TRANSFER_REASON = "ส่งเงินเข้าสำนักงาน";

type CashMoveLike = {
  id?: string;
  at?: string;
  staffId?: string;
  staffName?: string;
  direction?: string;
  amount?: number;
  reason?: string;
  note?: string;
};

function num(v: unknown, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function now() {
  return new Date();
}

function toCategory(
  row: typeof pg.expenseCategories.$inferSelect,
): ExpenseCategoryRecord {
  return {
    id: row.id,
    name: row.name,
    sortOrder: row.sortOrder,
    posReason: row.posReason ?? null,
    active: Boolean(row.active),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toExpense(
  row: typeof pg.expenses.$inferSelect,
  categoryName?: string,
): ExpenseRecord {
  return {
    id: row.id,
    branchId: row.branchId ?? null,
    categoryId: row.categoryId,
    categoryName,
    amount: num(row.amount),
    description: row.description ?? null,
    paidFrom: (row.paidFrom === "external" ? "external" : "drawer") as ExpensePaidFrom,
    spentAt: row.spentAt.toISOString(),
    shiftId: row.shiftId ?? null,
    terminalId: row.terminalId ?? null,
    staffId: row.staffId ?? null,
    staffName: row.staffName ?? null,
    cashMoveId: row.cashMoveId ?? null,
    note: row.note ?? null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

@Injectable()
export class ExpensesService implements OnModuleInit {
  constructor(
    private readonly database: DatabaseService,
    @Inject(forwardRef(() => CashBookService))
    private readonly cashBook: CashBookService,
  ) {}

  async onModuleInit() {
    // seed อยู่ใน ensureSchema แล้ว — no-op
  }

  async listCategories(includeInactive = false) {
    const rows = await this.database.db
      .select()
      .from(pg.expenseCategories)
      .where(
        includeInactive
          ? isNull(pg.expenseCategories.deletedAt)
          : and(
              isNull(pg.expenseCategories.deletedAt),
              eq(pg.expenseCategories.active, 1),
            ),
      )
      .orderBy(asc(pg.expenseCategories.sortOrder), asc(pg.expenseCategories.name));
    return { categories: rows.map(toCategory) };
  }

  async createCategory(dto: UpsertExpenseCategoryDto) {
    const name = dto.name?.trim();
    if (!name) throw new BadRequestException("กรุณาใส่ชื่อประเภท");
    const id = `expcat-${randomUUID().slice(0, 8)}`;
    await this.database.db.insert(pg.expenseCategories).values({
      id,
      name,
      sortOrder: dto.sortOrder ?? 100,
      posReason: dto.posReason?.trim() || null,
      active: dto.active === false ? 0 : 1,
      updatedAt: now(),
      deletedAt: null,
    });
    const rows = await this.database.db
      .select()
      .from(pg.expenseCategories)
      .where(eq(pg.expenseCategories.id, id))
      .limit(1);
    return toCategory(rows[0]!);
  }

  async updateCategory(id: string, dto: Partial<UpsertExpenseCategoryDto>) {
    const rows = await this.database.db
      .select()
      .from(pg.expenseCategories)
      .where(
        and(eq(pg.expenseCategories.id, id), isNull(pg.expenseCategories.deletedAt)),
      )
      .limit(1);
    if (!rows[0]) throw new NotFoundException("ไม่พบหมวดค่าใช้จ่าย");
    const cur = rows[0];
    await this.database.db
      .update(pg.expenseCategories)
      .set({
        name: dto.name?.trim() ?? cur.name,
        sortOrder: dto.sortOrder ?? cur.sortOrder,
        posReason:
          dto.posReason === undefined
            ? cur.posReason
            : dto.posReason?.trim() || null,
        active:
          dto.active === undefined ? cur.active : dto.active ? 1 : 0,
        updatedAt: now(),
      })
      .where(eq(pg.expenseCategories.id, id));
    const next = await this.database.db
      .select()
      .from(pg.expenseCategories)
      .where(eq(pg.expenseCategories.id, id))
      .limit(1);
    return toCategory(next[0]!);
  }

  async reorderCategories(ids: string[]) {
    const unique = [...new Set(ids.map((id) => String(id || "").trim()).filter(Boolean))];
    if (!unique.length) throw new BadRequestException("ไม่มีรายการให้เรียง");
    let i = 0;
    for (const id of unique) {
      i += 1;
      await this.database.db
        .update(pg.expenseCategories)
        .set({ sortOrder: i * 10, updatedAt: now() })
        .where(
          and(eq(pg.expenseCategories.id, id), isNull(pg.expenseCategories.deletedAt)),
        );
    }
    return this.listCategories(true);
  }

  async removeCategory(id: string) {
    const rows = await this.database.db
      .select()
      .from(pg.expenseCategories)
      .where(
        and(eq(pg.expenseCategories.id, id), isNull(pg.expenseCategories.deletedAt)),
      )
      .limit(1);
    if (!rows[0]) throw new NotFoundException("ไม่พบหมวดค่าใช้จ่าย");
    const used = await this.database.db
      .select({ id: pg.expenses.id })
      .from(pg.expenses)
      .where(and(eq(pg.expenses.categoryId, id), isNull(pg.expenses.deletedAt)))
      .limit(1);
    if (used[0]) {
      throw new BadRequestException(
        "ยังมีรายการใช้หมวดนี้ — ปิดการใช้งานแทนได้",
      );
    }
    await this.database.db
      .update(pg.expenseCategories)
      .set({ deletedAt: now(), updatedAt: now(), active: 0 })
      .where(eq(pg.expenseCategories.id, id));
    return { id };
  }

  async list(opts: {
    from?: string;
    to?: string;
    branchId?: string;
    paidFrom?: string;
    categoryId?: string;
  } = {}) {
    const cats = await this.listCategories(true);
    const catMap = new Map(cats.categories.map((c) => [c.id, c.name]));

    const conds = [isNull(pg.expenses.deletedAt)];
    if (opts.branchId === "shared") {
      conds.push(isNull(pg.expenses.branchId));
    } else if (opts.branchId) {
      conds.push(eq(pg.expenses.branchId, opts.branchId));
    }
    if (opts.categoryId) conds.push(eq(pg.expenses.categoryId, opts.categoryId));
    if (opts.paidFrom === "drawer" || opts.paidFrom === "external") {
      conds.push(eq(pg.expenses.paidFrom, opts.paidFrom));
    }
    if (opts.from) {
      conds.push(gte(pg.expenses.spentAt, new Date(`${opts.from}T00:00:00+07:00`)));
    }
    if (opts.to) {
      conds.push(lte(pg.expenses.spentAt, new Date(`${opts.to}T23:59:59.999+07:00`)));
    }

    const rows = await this.database.db
      .select()
      .from(pg.expenses)
      .where(and(...conds))
      .orderBy(desc(pg.expenses.spentAt));

    return {
      expenses: rows.map((r) => toExpense(r, catMap.get(r.categoryId))),
    };
  }

  async create(dto: UpsertExpenseDto) {
    if (!dto.categoryId?.trim()) {
      throw new BadRequestException("กรุณาเลือกประเภทค่าใช้จ่าย");
    }
    const id = `exp-${randomUUID().slice(0, 10)}`;
    const spentAt = dto.spentAt ? new Date(dto.spentAt) : now();
    await this.database.db.insert(pg.expenses).values({
      id,
      branchId: dto.branchId?.trim() || null,
      categoryId: dto.categoryId,
      amount: String(Math.max(0, num(dto.amount))),
      description: dto.description?.trim() || null,
      paidFrom: dto.paidFrom === "external" ? "external" : "drawer",
      spentAt,
      shiftId: dto.shiftId ?? null,
      terminalId: dto.terminalId ?? null,
      staffId: dto.staffId ?? null,
      staffName: dto.staffName ?? null,
      cashMoveId: null,
      note: dto.note?.trim() || null,
      updatedAt: now(),
      deletedAt: null,
    });
    const { expenses } = await this.list({});
    const found = expenses.find((e) => e.id === id);
    if (!found) throw new NotFoundException("สร้างแล้วแต่โหลดไม่เจอ");
    await this.cashBook.syncDrawerExpense({
      id: found.id,
      paidFrom: found.paidFrom,
      amount: found.amount,
      description: found.description,
      categoryName: found.categoryName,
      branchId: found.branchId,
      spentAt: found.spentAt,
    });
    return found;
  }

  async update(id: string, dto: Partial<UpsertExpenseDto>) {
    const rows = await this.database.db
      .select()
      .from(pg.expenses)
      .where(and(eq(pg.expenses.id, id), isNull(pg.expenses.deletedAt)))
      .limit(1);
    if (!rows[0]) throw new NotFoundException("ไม่พบค่าใช้จ่าย");
    const cur = rows[0];
    await this.database.db
      .update(pg.expenses)
      .set({
        branchId:
          dto.branchId === undefined
            ? cur.branchId
            : dto.branchId?.trim() || null,
        categoryId: dto.categoryId ?? cur.categoryId,
        amount:
          dto.amount == null ? cur.amount : String(Math.max(0, num(dto.amount))),
        description:
          dto.description === undefined
            ? cur.description
            : dto.description?.trim() || null,
        paidFrom:
          dto.paidFrom == null
            ? cur.paidFrom
            : dto.paidFrom === "external"
              ? "external"
              : "drawer",
        spentAt: dto.spentAt ? new Date(dto.spentAt) : cur.spentAt,
        note:
          dto.note === undefined ? cur.note : dto.note?.trim() || null,
        updatedAt: now(),
      })
      .where(eq(pg.expenses.id, id));
    const { expenses } = await this.list({});
    const found = expenses.find((e) => e.id === id);
    if (!found) throw new NotFoundException("อัปเดตแล้วแต่โหลดไม่เจอ");
    await this.cashBook.syncDrawerExpense({
      id: found.id,
      paidFrom: found.paidFrom,
      amount: found.amount,
      description: found.description,
      categoryName: found.categoryName,
      branchId: found.branchId,
      spentAt: found.spentAt,
    });
    return found;
  }

  async remove(id: string) {
    const rows = await this.database.db
      .select()
      .from(pg.expenses)
      .where(and(eq(pg.expenses.id, id), isNull(pg.expenses.deletedAt)))
      .limit(1);
    if (!rows[0]) throw new NotFoundException("ไม่พบค่าใช้จ่าย");
    await this.database.db
      .update(pg.expenses)
      .set({ deletedAt: now(), updatedAt: now() })
      .where(eq(pg.expenses.id, id));
    await this.cashBook.syncDrawerExpense({
      id,
      paidFrom: rows[0].paidFrom,
      amount: num(rows[0].amount),
      description: rows[0].description,
      branchId: rows[0].branchId,
      spentAt: rows[0].spentAt,
      deleted: true,
    });
    return { id };
  }

  /** จาก cash moves ของกะ — แปลง cash-out ที่เป็นค่าใช้จ่าย (ไม่รวมส่งเงินสำนักงาน) */
  async syncFromCashMoves(opts: {
    shiftId: string;
    branchId: string;
    terminalId?: string | null;
    staffId?: string | null;
    staffName?: string | null;
    cashMoves: CashMoveLike[];
  }) {
    const { categories } = await this.listCategories(true);
    const byReason = new Map(
      categories
        .filter((c) => c.posReason)
        .map((c) => [c.posReason!, c.id]),
    );
    const otherId =
      categories.find((c) => c.id === "expcat-other")?.id ??
      categories[0]?.id;
    if (!otherId) return { synced: 0 };

    let synced = 0;
    for (const move of opts.cashMoves ?? []) {
      if (move.direction !== "out") continue;
      const reason = String(move.reason ?? "").trim();
      if (!reason || reason === OFFICE_TRANSFER_REASON) continue;
      const moveId = String(move.id ?? "").trim();
      if (!moveId) continue;
      const amount = Math.max(0, num(move.amount));
      if (amount <= 0) continue;

      const categoryId = byReason.get(reason) ?? otherId;
      const spentAt = move.at ? new Date(move.at) : now();
      const description = reason;
      const note = move.note?.trim() || null;

      const existing = await this.database.db
        .select({ id: pg.expenses.id })
        .from(pg.expenses)
        .where(
          and(eq(pg.expenses.cashMoveId, moveId), isNull(pg.expenses.deletedAt)),
        )
        .limit(1);

      const expenseId = existing[0]?.id ?? `exp-${randomUUID().slice(0, 10)}`;
      const staffId = move.staffId ?? opts.staffId ?? null;
      const staffName = move.staffName ?? opts.staffName ?? null;

      if (existing[0]) {
        await this.database.db
          .update(pg.expenses)
          .set({
            branchId: opts.branchId,
            categoryId,
            amount: String(amount),
            description,
            paidFrom: "drawer",
            spentAt,
            shiftId: opts.shiftId,
            terminalId: opts.terminalId ?? null,
            staffId,
            staffName,
            note,
            updatedAt: now(),
          })
          .where(eq(pg.expenses.id, expenseId));
      } else {
        await this.database.db.insert(pg.expenses).values({
          id: expenseId,
          branchId: opts.branchId,
          categoryId,
          amount: String(amount),
          description,
          paidFrom: "drawer",
          spentAt,
          shiftId: opts.shiftId,
          terminalId: opts.terminalId ?? null,
          staffId,
          staffName,
          cashMoveId: moveId,
          note,
          updatedAt: now(),
          deletedAt: null,
        });
      }
      await this.cashBook.syncDrawerExpense({
        id: expenseId,
        paidFrom: "drawer",
        amount,
        description,
        branchId: opts.branchId,
        spentAt,
      });
      synced += 1;
    }
    return { synced };
  }

  /** สรุปรายรับ–รายจ่าย */
  async cashflowReport(opts: {
    from?: string;
    to?: string;
    branchId?: string;
  }) {
    const from = opts.from ?? new Date().toISOString().slice(0, 10);
    const to = opts.to ?? from;
    const start = new Date(`${from}T00:00:00+07:00`);
    const end = new Date(`${to}T23:59:59.999+07:00`);

    const saleConds = [
      eq(pg.sales.status, "completed"),
      gte(pg.sales.createdAt, start),
      lte(pg.sales.createdAt, end),
    ];
    if (opts.branchId) saleConds.push(eq(pg.sales.branchId, opts.branchId));

    const payRows = await this.database.db
      .select({
        branchId: pg.sales.branchId,
        method: pg.salePayments.method,
        amount: sql<string>`sum(${pg.salePayments.amount})`,
        count: sql<number>`count(*)::int`,
      })
      .from(pg.salePayments)
      .innerJoin(pg.sales, eq(pg.salePayments.saleId, pg.sales.id))
      .where(and(...saleConds))
      .groupBy(pg.sales.branchId, pg.salePayments.method);

    const incomeByMethodMap = new Map<
      string,
      { method: string; amount: number; count: number }
    >();
    type BranchAgg = {
      branchId: string;
      incomeTotal: number;
      cashIncome: number;
      transferIncome: number;
      governmentIncome: number;
      expenseTotal: number;
      expenseDrawer: number;
      expenseExternal: number;
      officeTransferOut: number;
      floatIn: number;
    };
    const byBranchMap = new Map<string, BranchAgg>();

    const ensureBranch = (branchId: string) => {
      let cur = byBranchMap.get(branchId);
      if (!cur) {
        cur = {
          branchId,
          incomeTotal: 0,
          cashIncome: 0,
          transferIncome: 0,
          governmentIncome: 0,
          expenseTotal: 0,
          expenseDrawer: 0,
          expenseExternal: 0,
          officeTransferOut: 0,
          floatIn: 0,
        };
        byBranchMap.set(branchId, cur);
      }
      return cur;
    };

    for (const r of payRows) {
      const amount = Math.round(num(r.amount) * 100) / 100;
      const count = Number(r.count) || 0;
      const methodCur = incomeByMethodMap.get(r.method) ?? {
        method: r.method,
        amount: 0,
        count: 0,
      };
      methodCur.amount += amount;
      methodCur.count += count;
      incomeByMethodMap.set(r.method, methodCur);

      const br = ensureBranch(r.branchId);
      br.incomeTotal += amount;
      if (r.method === "cash") br.cashIncome += amount;
      else if (r.method === "transfer") br.transferIncome += amount;
      else if (r.method === "government") br.governmentIncome += amount;
    }

    const incomeByMethod = [...incomeByMethodMap.values()].map((r) => ({
      ...r,
      amount: Math.round(r.amount * 100) / 100,
    }));
    const incomeTotal = incomeByMethod.reduce((s, r) => s + r.amount, 0);
    const cashIncome =
      incomeByMethod.find((r) => r.method === "cash")?.amount ?? 0;
    const transferIncome =
      incomeByMethod.find((r) => r.method === "transfer")?.amount ?? 0;
    const governmentIncome =
      incomeByMethod.find((r) => r.method === "government")?.amount ?? 0;

    const expList = await this.list({
      from,
      to,
      branchId: opts.branchId,
    });
    const expenses = expList.expenses;
    const expenseTotal = expenses.reduce((s, e) => s + e.amount, 0);
    const expenseDrawer = expenses
      .filter((e) => e.paidFrom === "drawer")
      .reduce((s, e) => s + e.amount, 0);
    const expenseExternal = expenses
      .filter((e) => e.paidFrom === "external")
      .reduce((s, e) => s + e.amount, 0);

    const byCategoryMap = new Map<
      string,
      { categoryId: string; categoryName: string; amount: number; count: number }
    >();
    for (const e of expenses) {
      const key = e.categoryId;
      const cur = byCategoryMap.get(key) ?? {
        categoryId: e.categoryId,
        categoryName: e.categoryName ?? e.categoryId,
        amount: 0,
        count: 0,
      };
      cur.amount += e.amount;
      cur.count += 1;
      byCategoryMap.set(key, cur);

      const br = ensureBranch(e.branchId || "shared");
      br.expenseTotal += e.amount;
      if (e.paidFrom === "drawer") br.expenseDrawer += e.amount;
      else br.expenseExternal += e.amount;
    }

    // ส่งเงินเข้าสำนักงาน จาก cash moves ในกะ (ไม่ใช่ค่าใช้จ่าย)
    const shiftConds = [
      gte(pg.shifts.openedAt, start),
      lte(pg.shifts.openedAt, end),
    ];
    if (opts.branchId) shiftConds.push(eq(pg.shifts.branchId, opts.branchId));
    const shiftRows = await this.database.db
      .select({
        branchId: pg.shifts.branchId,
        cashMovesJson: pg.shifts.cashMovesJson,
      })
      .from(pg.shifts)
      .where(and(...shiftConds));

    let officeTransferOut = 0;
    let floatIn = 0;
    for (const s of shiftRows) {
      let moves: CashMoveLike[] = [];
      try {
        moves = JSON.parse(s.cashMovesJson || "[]") as CashMoveLike[];
      } catch {
        moves = [];
      }
      const br = ensureBranch(s.branchId);
      for (const m of moves) {
        const amt = Math.max(0, num(m.amount));
        if (m.direction === "out" && m.reason === OFFICE_TRANSFER_REASON) {
          officeTransferOut += amt;
          br.officeTransferOut += amt;
        }
        if (m.direction === "in") {
          floatIn += amt;
          br.floatIn += amt;
        }
      }
    }

    const branchIds = [...byBranchMap.keys()].filter((id) => id !== "shared");
    const branchNameMap = new Map<string, string>([["shared", "กลาง"]]);
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

    const byBranch = [...byBranchMap.values()]
      .map((r) => ({
        branchId: r.branchId,
        branchName: branchNameMap.get(r.branchId) ?? r.branchId,
        incomeTotal: Math.round(r.incomeTotal * 100) / 100,
        cashIncome: Math.round(r.cashIncome * 100) / 100,
        transferIncome: Math.round(r.transferIncome * 100) / 100,
        governmentIncome: Math.round(r.governmentIncome * 100) / 100,
        expenseTotal: Math.round(r.expenseTotal * 100) / 100,
        expenseDrawer: Math.round(r.expenseDrawer * 100) / 100,
        expenseExternal: Math.round(r.expenseExternal * 100) / 100,
        officeTransferOut: Math.round(r.officeTransferOut * 100) / 100,
        floatIn: Math.round(r.floatIn * 100) / 100,
        netIncomeExpense:
          Math.round((r.incomeTotal - r.expenseTotal) * 100) / 100,
      }))
      .sort((a, b) => b.incomeTotal - a.incomeTotal);

    return {
      filters: { from, to, branchId: opts.branchId ?? null },
      summary: {
        incomeTotal: Math.round(incomeTotal * 100) / 100,
        cashIncome: Math.round(cashIncome * 100) / 100,
        transferIncome: Math.round(transferIncome * 100) / 100,
        governmentIncome: Math.round(governmentIncome * 100) / 100,
        expenseTotal: Math.round(expenseTotal * 100) / 100,
        expenseDrawer: Math.round(expenseDrawer * 100) / 100,
        expenseExternal: Math.round(expenseExternal * 100) / 100,
        officeTransferOut: Math.round(officeTransferOut * 100) / 100,
        floatIn: Math.round(floatIn * 100) / 100,
        netIncomeExpense: Math.round((incomeTotal - expenseTotal) * 100) / 100,
      },
      byBranch,
      incomeByMethod: incomeByMethod.sort((a, b) => b.amount - a.amount),
      expenseByCategory: [...byCategoryMap.values()]
        .map((r) => ({
          ...r,
          amount: Math.round(r.amount * 100) / 100,
        }))
        .sort((a, b) => b.amount - a.amount),
      expenses: expenses.slice(0, 200),
    };
  }
}
