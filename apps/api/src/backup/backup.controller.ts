import {
  Controller,
  ForbiddenException,
  Get,
  Post,
  Req,
  UnauthorizedException,
} from "@nestjs/common";
import type { AuthedRequest } from "../auth/auth.guard";
import { BackupService } from "./backup.service";

@Controller("backup")
export class BackupController {
  constructor(private readonly backup: BackupService) {}

  private assertCanBackup(req: AuthedRequest) {
    const user = req.user;
    if (!user?.sub) throw new UnauthorizedException("กรุณาเข้าสู่ระบบ");
    if (user.role !== "admin" && user.role !== "manager") {
      throw new ForbiddenException("เฉพาะแอดมิน/ผู้จัดการที่สำรองได้");
    }
    return user;
  }

  @Get("status")
  status(@Req() req: AuthedRequest) {
    this.assertCanBackup(req);
    return this.backup.status();
  }

  @Post("run")
  async run(@Req() req: AuthedRequest) {
    const user = this.assertCanBackup(req);
    return this.backup.runManual(`${user.code}:${user.name}`);
  }
}
