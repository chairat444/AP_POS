import { Body, Controller, Get, NotFoundException, Param, Query } from "@nestjs/common";
import { SalesService } from "./sales.service";

@Controller("sales")
export class SalesController {
  constructor(private readonly sales: SalesService) {}

  @Get("summary")
  summary() {
    return this.sales.summary();
  }

  @Get("branches")
  branches() {
    return this.sales.branches();
  }

  @Get("report")
  report(
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("branchId") branchId?: string,
    @Query("paymentMethod") paymentMethod?: string,
    @Query("groupBy") groupBy?: "day" | "month" | "year",
  ) {
    return this.sales.report({
      from: from || undefined,
      to: to || undefined,
      branchId: branchId || undefined,
      paymentMethod: paymentMethod || undefined,
      groupBy: groupBy || "day",
    });
  }

  @Get()
  list(
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("branchId") branchId?: string,
    @Query("paymentMethod") paymentMethod?: string,
    @Query("limit") limit?: string,
  ) {
    return this.sales.list({
      from: from || undefined,
      to: to || undefined,
      branchId: branchId || undefined,
      paymentMethod: paymentMethod || undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get(":id")
  async get(@Param("id") id: string) {
    const sale = await this.sales.getById(id);
    if (!sale) throw new NotFoundException("Sale not found");
    return sale;
  }
}
