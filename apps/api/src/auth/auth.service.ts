import {
  Injectable,
  OnModuleInit,
  UnauthorizedException,
} from "@nestjs/common";
import { and, eq, isNull } from "drizzle-orm";
import { pg } from "@ap-pos/db";
import { DatabaseService } from "../db/database.service";
import { hashPassword, signToken, verifyPassword } from "./auth.crypto";

@Injectable()
export class AuthService implements OnModuleInit {
  constructor(private readonly database: DatabaseService) {}

  async onModuleInit() {
    // seed ทำใน StaffService — รอให้ตารางพร้อม
  }

  async login(code: string, password: string) {
    const raw = code.trim();
    const rows = await this.database.db
      .select()
      .from(pg.staff)
      .where(and(eq(pg.staff.code, raw), isNull(pg.staff.deletedAt)))
      .limit(1);
    const user = rows[0];
    if (!user || !user.active) {
      throw new UnauthorizedException("รหัสหรือรหัสผ่านไม่ถูกต้อง");
    }
    if (!user.canLoginAdmin) {
      throw new UnauthorizedException("บัญชีนี้ไม่มีสิทธิ์เข้า Admin");
    }
    if (!verifyPassword(password, user.passwordHash)) {
      throw new UnauthorizedException("รหัสหรือรหัสผ่านไม่ถูกต้อง");
    }
    const token = signToken({
      sub: user.id,
      code: user.code,
      name: user.name,
      role: user.role,
    });
    return {
      token,
      user: {
        id: user.id,
        code: user.code,
        name: user.name,
        role: user.role,
      },
    };
  }

  async me(userId: string) {
    const rows = await this.database.db
      .select()
      .from(pg.staff)
      .where(and(eq(pg.staff.id, userId), isNull(pg.staff.deletedAt)))
      .limit(1);
    const user = rows[0];
    if (!user || !user.active || !user.canLoginAdmin) {
      throw new UnauthorizedException("เซสชันหมดอายุ");
    }
    return {
      id: user.id,
      code: user.code,
      name: user.name,
      role: user.role,
    };
  }

  /** ใช้ตอน seed */
  hashPassword(password: string) {
    return hashPassword(password);
  }
}
