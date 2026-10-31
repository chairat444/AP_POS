import {
  HttpException,
  HttpStatus,
  Injectable,
  OnModuleInit,
  UnauthorizedException,
} from "@nestjs/common";
import { and, eq, isNull, sql } from "drizzle-orm";
import { pg } from "@ap-pos/db";
import { DatabaseService } from "../db/database.service";
import { resolveAdminMenus } from "@ap-pos/shared";
import { hashPassword, signToken, verifyPassword } from "./auth.crypto";

/** จำกัดลอง PIN ผิด — key = ip|pin */
const pinFails = new Map<string, { count: number; until: number }>();
/** จำกัดเดารหัส Admin — key = ip / รหัสพนักงาน */
const loginFails = new Map<string, { count: number; until: number }>();
/** hash ปลอมให้ใช้เวลาใกล้เคียงตอนบัญชีไม่มีจริง */
const DUMMY_PASSWORD_HASH = hashPassword("not-a-real-admin-password");
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_IP_LIMIT = 20;
const LOGIN_CODE_LIMIT = 8;
const LOGIN_FAIL_MSG = "รหัสหรือรหัสผ่านไม่ถูกต้อง";
const LOGIN_LOCK_MSG = "ลองผิดหลายครั้ง · รอสักครู่แล้วลองใหม่";

function assertNotLocked(key: string, limit: number) {
  const nowMs = Date.now();
  const fail = loginFails.get(key);
  if (fail && fail.until > nowMs && fail.count >= limit) {
    throw new HttpException(LOGIN_LOCK_MSG, HttpStatus.TOO_MANY_REQUESTS);
  }
  if (fail && fail.until <= nowMs) loginFails.delete(key);
}

function recordFail(key: string) {
  const nowMs = Date.now();
  const prev = loginFails.get(key);
  if (!prev || nowMs >= prev.until) {
    loginFails.set(key, { count: 1, until: nowMs + LOGIN_WINDOW_MS });
    return;
  }
  prev.count += 1;
}

function clearFails(...keys: string[]) {
  for (const key of keys) loginFails.delete(key);
}

@Injectable()
export class AuthService implements OnModuleInit {
  constructor(private readonly database: DatabaseService) {}

  async onModuleInit() {
    // seed ทำใน StaffService — รอให้ตารางพร้อม
  }

  async login(code: string, password: string, clientKey = "anon") {
    const raw = code.trim();
    const ipKey = `admin-ip:${clientKey || "anon"}`;
    const codeKey = `admin-code:${raw.toLowerCase() || "-"}`;
    assertNotLocked(ipKey, LOGIN_IP_LIMIT);
    assertNotLocked(codeKey, LOGIN_CODE_LIMIT);

    const rows = await this.database.db
      .select()
      .from(pg.staff)
      .where(
        and(
          sql`lower(${pg.staff.code}) = ${raw.toLowerCase()}`,
          isNull(pg.staff.deletedAt),
        ),
      )
      .limit(1);
    const user = rows[0];
    const allowed = Boolean(
      user?.active && user.canLoginAdmin && user.passwordHash,
    );
    const ok = verifyPassword(
      password,
      allowed && user?.passwordHash ? user.passwordHash : DUMMY_PASSWORD_HASH,
    );
    if (!user || !allowed || !ok) {
      recordFail(ipKey);
      recordFail(codeKey);
      throw new UnauthorizedException(LOGIN_FAIL_MSG);
    }
    clearFails(ipKey, codeKey);
    const menus = resolveAdminMenus(user.role, user.adminMenus);
    const token = signToken({
      sub: user.id,
      code: user.code,
      name: user.name,
      role: user.role,
      menus,
      scope: "admin",
    });
    return {
      token,
      user: {
        id: user.id,
        code: user.code,
        name: user.name,
        role: user.role,
        menus,
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
    const menus = resolveAdminMenus(user.role, user.adminMenus);
    const token = signToken({
      sub: user.id,
      code: user.code,
      name: user.name,
      role: user.role,
      menus,
      scope: "admin",
    });
    return {
      id: user.id,
      code: user.code,
      name: user.name,
      role: user.role,
      menus,
      token,
    };
  }

  /** ใช้ตอน seed */
  hashPassword(password: string) {
    return hashPassword(password);
  }
}
