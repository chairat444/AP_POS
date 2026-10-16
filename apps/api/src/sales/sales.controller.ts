import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
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
    @Query("includeSales") includeSales?: string,
  ) {
    const include =
      includeSales == null
        ? undefined
        : includeSales === "1" || includeSales.toLowerCase() === "true";
    return this.sales.report({
      from: from || undefined,
      to: to || undefined,
      branchId: branchId || undefined,
      paymentMethod: paymentMethod || undefined,
      groupBy: groupBy || "day",
      includeSales: include,
    });
  }

  @Get("profit")
  profit(
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("branchId") branchId?: string,
  ) {
    return this.sales.profitReport({
      from: from || undefined,
      to: to || undefined,
      branchId: branchId || undefined,
    });
  }

  @Get("cancels")
  cancels(
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("branchId") branchId?: string,
    @Query("limit") limit?: string,
  ) {
    return this.sales.listCancels({
      from: from || undefined,
      to: to || undefined,
      branchId: branchId || undefined,
      limit: limit ? Number(limit) : undefined,
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

  /** nginx HTTPS มักบล็อก PATCH → ใช้ POST แทน (ต้องอยู่ก่อน :id) */
  @Post("lines/update")
  async patchLinePost(
    @Body()
    body: {
      saleId?: string;
      lineId?: string;
      unitCost?: number | null;
      pricePerKg?: number | null;
      clearCost?: boolean;
    },
  ) {
    const id = String(body?.saleId ?? "").trim();
    const lineId = String(body?.lineId ?? "").trim();
    if (!id || !lineId) throw new BadRequestException("ไม่พบบิลหรือรายการ");
    const { saleId: _s, lineId: _l, ...rest } = body;
    const sale = await this.sales.updateLineCost(id, lineId, rest ?? {});
    if (!sale) throw new NotFoundException("Sale or line not found");
    return sale;
  }

  @Get(":id")
  async get(@Param("id") id: string) {
    const sale = await this.sales.getById(id);
    if (!sale) throw new NotFoundException("Sale not found");
    return sale;
  }

  /** แก้ทุน / ราคาขายต่อกก. ในบิล — ไม่แตะยอดเงิน · ไม่แก้ master สินค้า */
  @Patch(":id/lines/:lineId")
  async patchLine(
    @Param("id") id: string,
    @Param("lineId") lineId: string,
    @Body()
    body: {
      unitCost?: number | null;
      pricePerKg?: number | null;
      clearCost?: boolean;
    },
  ) {
    const sale = await this.sales.updateLineCost(id, lineId, body ?? {});
    if (!sale) throw new NotFoundException("Sale or line not found");
    return sale;
  }
}
