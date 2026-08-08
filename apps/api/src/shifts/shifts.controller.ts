import {
  Body,
  Controller,
  Get,
  Param,
  Put,
  Query,
} from "@nestjs/common";
import { ShiftsService } from "./shifts.service";

@Controller("shifts")
export class ShiftsController {
  constructor(private readonly shifts: ShiftsService) {}

  @Get()
  list(
    @Query("branchId") branchId?: string,
    @Query("terminalId") terminalId?: string,
    @Query("status") status?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
  ) {
    return this.shifts.list({
      branchId: branchId || undefined,
      terminalId: terminalId || undefined,
      status: status || undefined,
      from: from || undefined,
      to: to || undefined,
    });
  }

  @Get("report")
  report(
    @Query("branchId") branchId?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
  ) {
    return this.shifts.report({
      branchId: branchId || undefined,
      from: from || undefined,
      to: to || undefined,
    });
  }

  @Get("commission-report")
  commissionReport(
    @Query("year") year?: string,
    @Query("month") month?: string,
    @Query("branchId") branchId?: string,
    @Query("staffId") staffId?: string,
  ) {
    const now = new Date();
    return this.shifts.commissionReport({
      year: year ? Number(year) : now.getFullYear(),
      month: month ? Number(month) : now.getMonth() + 1,
      branchId: branchId || undefined,
      staffId: staffId || undefined,
    });
  }

  /** ปรับค่าแรงวันนั้น (เช่น ครึ่งวัน) — wage=null ล้างกลับค่าเริ่มต้น */
  @Put("day-wage")
  upsertDayWage(
    @Body()
    body: {
      staffId?: string;
      date?: string;
      wage?: number | null;
      note?: string | null;
    },
  ) {
    return this.shifts.upsertDayWage({
      staffId: body.staffId ?? "",
      date: body.date ?? "",
      wage: body.wage === undefined ? null : body.wage,
      note: body.note,
    });
  }

  @Get(":id")
  get(@Param("id") id: string) {
    return this.shifts.get(id);
  }
}
