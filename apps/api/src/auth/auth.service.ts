import {
  Injectable,
  OnModuleInit,
  UnauthorizedException,
} from "@nestjs/common";
import { and, eq, isNull } from "drizzle-orm";
import { pg } from "@ap-pos/db";
import { DatabaseService } from "../db/database.service";
import { hashPassword, signToken, verifyPassword } from "./auth.crypto";

/** จำกัดลอง PIN ผิด — key = ip|pin */
const pinFails = new Map<string, { count: number; until: number }>();

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
      scope: "admin",
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

  /**
   * เข้าหน้าสั่งของด้วย PIN เดียวกับ POS
   * ได้โทเคน scope=purchase-order — เข้า admin ไม่ได้
   */
  async loginWithPin(pin: string, clientKey = "anon") {
    const raw = String(pin ?? "")
      .replace(/\D/g, "")
      .slice(0, 6);
    if (raw.length < 4) {
      throw new UnauthorizedException("ใส่ PIN ให้ครบ");
    }
    const failKey = `${clientKey}|${raw}`;
    const nowMs = Date.now();
    const fail = pinFails.get(failKey);
    if (fail && fail.until > nowMs && fail.count >= 8) {
      throw new UnauthorizedException("ลองผิดหลายครั้ง · รอสักครู่แล้วลองใหม่");
    }
    if (fail && fail.until <= nowMs) pinFails.delete(failKey);

    const rows = await this.database.db
      .select()
      .from(pg.staff)
      .where(and(eq(pg.staff.pin, raw), isNull(pg.staff.deletedAt)));
    const user = rows.find((r) => r.active && r.code !== "admin");
    if (!user) {
      const prev = pinFails.get(failKey);
      const count = (prev?.count ?? 0) + 1;
      pinFails.set(failKey, {
        count,
        until: nowMs + 15 * 60 * 1000,
      });
      throw new UnauthorizedException("PIN ไม่ถูกต้อง");
    }
    pinFails.delete(failKey);

    // แท็บเล็ตสาขาเปิดค้างทั้งวัน — 7 วัน กันโดนไล่ PIN กลางทาง (draft ค้างเครื่องแยกต่างหาก)
    const token = signToken(
      {
        sub: user.id,
        code: user.code,
        name: user.name,
        role: user.role,
        scope: "purchase-order",
      },
      60 * 60 * 24 * 7,
    );
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
