import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { SyncService } from "./sync.service";

import { Public } from "../auth/public.decorator";

@Public()
@Controller("sync")
export class SyncController {
  constructor(private readonly sync: SyncService) {}

  @Get("products")
  products() {
    return this.sync.listProducts();
  }

  @Get("branches")
  branches() {
    return this.sync.listBranches();
  }

  @Get("staff")
  staff() {
    return this.sync.listStaff();
  }

  @Get("staff/day-sales")
  staffDaySales(
    @Query("staffId") staffId?: string,
    @Query("excludeShiftId") excludeShiftId?: string,
  ) {
    return this.sync.staffDaySales(staffId ?? "", excludeShiftId);
  }

  /** บิลรายวันของสาขา — ให้ POS / สคริปต์กู้รอบ (ไม่ต้อง login Admin) */
  @Get("day-sales")
  daySales(
    @Query("branchId") branchId?: string,
    @Query("day") day?: string,
  ) {
    return this.sync.daySales(branchId ?? "", day);
  }

  @Get("promos")
  promos() {
    return this.sync.listPromos();
  }

  @Get("settings")
  settings() {
    return this.sync.getSettings();
  }

  @Get("terminals")
  terminals(@Query("branchId") branchId?: string) {
    return this.sync.listTerminals(branchId);
  }

  @Post("terminals/register")
  registerTerminal(
    @Body()
    body: {
      id?: string;
      code?: string;
      name: string;
      branchId: string;
    },
  ) {
    return this.sync.registerTerminal(body);
  }

  @Post("terminals/claim")
  claimTerminal(
    @Body()
    body: {
      id: string;
      branchId: string;
    },
  ) {
    return this.sync.claimTerminal(body);
  }

  @Get("bootstrap")
  bootstrap() {
    return this.sync.bootstrap();
  }

  @Get("changes")
  changes(@Query("since") since?: string) {
    return this.sync.changes(since ?? null);
  }

  @Post("sales")
  pushSales(
    @Body()
    body: {
      sales: Array<{ id: string; type: "sale"; payload: Record<string, unknown> }>;
    },
  ) {
    return this.sync.acceptOutbox(
      body.sales ?? [],
    );
  }

  @Post("shifts")
  pushShifts(
    @Body()
    body: {
      shifts: Array<{
        id: string;
        branchId: string;
        terminalId: string;
        staffId?: string | null;
        staffCode?: string | null;
        staffName: string;
        openedAt: string;
        closedAt?: string | null;
        openCash: number;
        closeCash?: number | null;
        expectedCash?: number | null;
        variance?: number | null;
        status: "open" | "closed";
        billCount?: number;
        grossTotal?: number;
        closeNote?: string | null;
        summary?: unknown;
        cashMoves?: unknown[];
        cashCounts?: unknown[];
        terminalName?: string;
      }>;
    },
  ) {
    return this.sync.acceptShifts(body.shifts ?? []);
  }

  /** ตรวจรอบหลัง sync — POS ใช้ได้โดยไม่ต้อง login Admin */
  @Get("shifts/:id")
  getShift(@Param("id") id: string) {
    return this.sync.getShift(id);
  }

  @Post("audits")
  pushAudits(
    @Body()
    body: {
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
      }>;
    },
  ) {
    return this.sync.acceptAudits(body.audits ?? []);
  }
}
