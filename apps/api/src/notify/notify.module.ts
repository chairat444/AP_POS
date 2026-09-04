import { Module } from "@nestjs/common";
import { DatabaseModule } from "../db/database.module";
import { NotifyService } from "./notify.service";
import { SalesDigestJob } from "./sales-digest.job";

@Module({
  imports: [DatabaseModule],
  providers: [NotifyService, SalesDigestJob],
  exports: [NotifyService],
})
export class NotifyModule {}
