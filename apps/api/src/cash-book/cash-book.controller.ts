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
import type { UpsertCashBookEntryDto } from "./cash-book.types";
import { CashBookService } from "./cash-book.service";

@Controller("cash-book")
export class CashBookController {
  constructor(private readonly cashBook: CashBookService) {}

  @Get("month")
  month(@Query("month") month = "") {
    return this.cashBook.monthReport(month);
  }

  @Get("day")
  day(@Query("day") day = "") {
    return this.cashBook.listDay(day);
  }

  /** ชื่อรายการจ่ายที่เคยใช้ — สำหรับ autocomplete */
  @Get("descriptions")
  descriptions() {
    return this.cashBook.listDescriptions();
  }

  @Post()
  create(@Body() body: UpsertCashBookEntryDto) {
    return this.cashBook.create(body);
  }

  @Get(":id")
  get(@Param("id") id: string) {
    return this.cashBook.get(id);
  }

  @Patch(":id")
  update(
    @Param("id") id: string,
    @Body() body: Partial<UpsertCashBookEntryDto>,
  ) {
    return this.cashBook.update(id, body);
  }

  @Delete(":id")
  remove(@Param("id") id: string) {
    return this.cashBook.remove(id);
  }
}
