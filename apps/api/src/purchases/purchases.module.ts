import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { NotifyModule } from "../notify/notify.module";
import { PurchaseOrderController } from "./purchase-order.controller";
import { PurchasesController } from "./purchases.controller";
import { PurchasesService } from "./purchases.service";

@Module({
  imports: [AuthModule, NotifyModule],
  controllers: [PurchasesController, PurchaseOrderController],
  providers: [PurchasesService],
  exports: [PurchasesService],
})
export class PurchasesModule {}
