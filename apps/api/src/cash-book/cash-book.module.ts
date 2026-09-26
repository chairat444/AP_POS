import { Module, forwardRef } from "@nestjs/common";
import { ShiftsModule } from "../shifts/shifts.module";
import { CashBookController } from "./cash-book.controller";
import { CashBookService } from "./cash-book.service";

@Module({
  imports: [forwardRef(() => ShiftsModule)],
  controllers: [CashBookController],
  providers: [CashBookService],
  exports: [CashBookService],
})
export class CashBookModule {}
