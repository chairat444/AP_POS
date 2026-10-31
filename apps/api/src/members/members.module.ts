import { Module } from "@nestjs/common";
import { SettingsModule } from "../settings/settings.module";
import { MemberKioskController } from "./member-kiosk.controller";
import { MembersController } from "./members.controller";
import { MembersService } from "./members.service";

@Module({
  imports: [SettingsModule],
  controllers: [MembersController, MemberKioskController],
  providers: [MembersService],
  exports: [MembersService],
})
export class MembersModule {}
