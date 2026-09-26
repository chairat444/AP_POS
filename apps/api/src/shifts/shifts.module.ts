import { Module, forwardRef } from "@nestjs/common";
import { ExpensesModule } from "../expenses/expenses.module";
import { NotifyModule } from "../notify/notify.module";
import { TerminalsModule } from "../terminals/terminals.module";
import { ShiftsController } from "./shifts.controller";
import { ShiftsService } from "./shifts.service";

@Module({
  imports: [TerminalsModule, forwardRef(() => ExpensesModule), NotifyModule],
  controllers: [ShiftsController],
  providers: [ShiftsService],
  exports: [ShiftsService],
})
export class ShiftsModule {}
