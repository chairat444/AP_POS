import { Module } from "@nestjs/common";
import { MemberKioskController } from "./member-kiosk.controller";
import { MembersController } from "./members.controller";
import { MembersService } from "./members.service";

@Module({
  controllers: [MembersController, MemberKioskController],
  providers: [MembersService],
  exports: [MembersService],
})
export class MembersModule {}
