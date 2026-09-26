import { Module, forwardRef } from "@nestjs/common";
import { CashBookModule } from "../cash-book/cash-book.module";
import { ExpensesController } from "./expenses.controller";
import { ExpensesService } from "./expenses.service";

@Module({
  imports: [forwardRef(() => CashBookModule)],
  controllers: [ExpensesController],
  providers: [ExpensesService],
  exports: [ExpensesService],
})
export class ExpensesModule {}
