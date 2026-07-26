import { Module } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";
import { HealthController } from "./health.controller";
import { SyncController } from "./sync/sync.controller";
import { SyncService } from "./sync/sync.service";
import { NotifyService } from "./notify/notify.service";
import { SalesDigestJob } from "./notify/sales-digest.job";
import { ProductsModule } from "./products/products.module";

@Module({
  imports: [ScheduleModule.forRoot(), ProductsModule],
  controllers: [HealthController, SyncController],
  providers: [SyncService, NotifyService, SalesDigestJob],
})
export class AppModule {}
