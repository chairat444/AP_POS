import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import type {
  UpsertExpenseCategoryDto,
  UpsertExpenseDto,
} from "./expense.types";
import { ExpensesService } from "./expenses.service";

@Controller()
export class ExpensesController {
  constructor(private readonly expenses: ExpensesService) {}

  @Get("expense-categories")
  listCategories(@Query("all") all?: string) {
    return this.expenses.listCategories(all === "1" || all === "true");
  }

  @Post("expense-categories")
  createCategory(@Body() body: UpsertExpenseCategoryDto) {
    return this.expenses.createCategory(body);
  }

  @Post("expense-categories/reorder")
  reorderCategories(@Body() body: { ids?: string[] }) {
    return this.expenses.reorderCategories(body.ids ?? []);
  }

  @Patch("expense-categories/:id")
  updateCategory(
    @Param("id") id: string,
    @Body() body: Partial<UpsertExpenseCategoryDto>,
  ) {
    return this.expenses.updateCategory(id, body);
  }

  @Delete("expense-categories/:id")
  removeCategory(@Param("id") id: string) {
    return this.expenses.removeCategory(id);
  }

  @Get("expenses")
  list(
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("branchId") branchId?: string,
    @Query("paidFrom") paidFrom?: string,
    @Query("categoryId") categoryId?: string,
  ) {
    return this.expenses.list({ from, to, branchId, paidFrom, categoryId });
  }

  @Post("expenses")
  create(@Body() body: UpsertExpenseDto) {
    return this.expenses.create(body);
  }

  @Patch("expenses/:id")
  update(@Param("id") id: string, @Body() body: Partial<UpsertExpenseDto>) {
    return this.expenses.update(id, body);
  }

  @Delete("expenses/:id")
  remove(@Param("id") id: string) {
    return this.expenses.remove(id);
  }

  @Get("reports/cashflow")
  cashflow(
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("branchId") branchId?: string,
  ) {
    return this.expenses.cashflowReport({ from, to, branchId });
  }
}
