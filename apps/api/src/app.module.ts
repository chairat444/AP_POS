import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ScheduleModule } from "@nestjs/schedule";
import { HealthController } from "./health.controller";
import { SyncController } from "./sync/sync.controller";
import { SyncService } from "./sync/sync.service";
import { NotifyModule } from "./notify/notify.module";
import { ProductsModule } from "./products/products.module";
import { MembersModule } from "./members/members.module";
import { SalesModule } from "./sales/sales.module";
import { UnitsModule } from "./units/units.module";
import { StaffModule } from "./staff/staff.module";
import { BranchesModule } from "./branches/branches.module";
import { PromosModule } from "./promos/promos.module";
import { SettingsModule } from "./settings/settings.module";
import { TerminalsModule } from "./terminals/terminals.module";
import { ShiftsModule } from "./shifts/shifts.module";
import { ExpensesModule } from "./expenses/expenses.module";
import { PurchasesModule } from "./purchases/purchases.module";
import { AuthModule } from "./auth/auth.module";
import { AuthGuard } from "./auth/auth.guard";
import { DatabaseModule } from "./db/database.module";

@Module({
  imports: [
    ScheduleModule.forRoot(),
    DatabaseModule,
    AuthModule,
    ProductsModule,
    MembersModule,
    SalesModule,
    UnitsModule,
    StaffModule,
    BranchesModule,
    PromosModule,
    SettingsModule,
    TerminalsModule,
    ShiftsModule,
    ExpensesModule,
    PurchasesModule,
    NotifyModule,
  ],
  controllers: [HealthController, SyncController],
  providers: [
    SyncService,
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class AppModule {}
