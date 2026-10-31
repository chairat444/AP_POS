import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import { Public } from "../auth/public.decorator";
import {
  assertKioskRate,
  clientIp,
  requireKioskKey,
} from "./member-kiosk.access";
import { MembersService } from "./members.service";
import { SettingsService } from "../settings/settings.service";

/**
 * สมัคร/เช็คแต้มผ่าน QR → เว็บบนมือถือลูกค้า
 * ต้องมีรหัส k (MEMBER_KIOSK_KEY) + จำกัดความถี่
 * ไม่คืนรายชื่อสมาชิกทั้งร้าน
 */
@Public()
@Controller("members/kiosk")
export class MemberKioskController {
  constructor(
    private readonly members: MembersService,
    private readonly settings: SettingsService,
  ) {}

  @Get("offer")
  offer(
    @Query("k") k = "",
    @Headers("x-member-kiosk-key") headerKey = "",
  ) {
    requireKioskKey(headerKey || k);
    return this.settings.publicLineOffer();
  }

  @Get("lookup")
  lookup(
    @Query("phone") phone = "",
    @Query("k") k = "",
    @Headers("x-member-kiosk-key") headerKey = "",
    @Req() req: { ip?: string; headers?: Record<string, string | undefined> },
  ) {
    requireKioskKey(headerKey || k);
    const ip = clientIp(req);
    const phoneKey = String(phone).replace(/\D/g, "").slice(-10) || "-";
    assertKioskRate(`kiosk-lookup:ip:${ip}`, 30, 60_000);
    assertKioskRate(`kiosk-lookup:phone:${phoneKey}`, 12, 60_000);
    return this.members.lookupByPhone(phone);
  }

  /** เปิดจากไลน์: ค้นด้วย id_token และผูกเบอร์ครั้งแรก */
  @Post("lookup")
  lookupPost(
    @Body() body: { phone?: string; idToken?: string },
    @Query("k") k = "",
    @Headers("x-member-kiosk-key") headerKey = "",
    @Req() req: { ip?: string; headers?: Record<string, string | undefined> },
  ) {
    requireKioskKey(headerKey || k);
    const ip = clientIp(req);
    const phone = String(body?.phone ?? "").trim();
    const phoneKey = phone.replace(/\D/g, "").slice(-10) || "line";
    assertKioskRate(`kiosk-lookup:ip:${ip}`, 30, 60_000);
    assertKioskRate(`kiosk-lookup:phone:${phoneKey}`, 12, 60_000);
    if (!phone && !String(body?.idToken ?? "").trim()) {
      throw new BadRequestException("กรอกเบอร์โทร");
    }
    return this.members.lookupForKiosk({
      phone: phone || undefined,
      idToken: body?.idToken,
      bind: true,
    });
  }

  @Post("register")
  register(
    @Body() body: { name?: string; phone?: string; source?: string; idToken?: string },
    @Query("k") k = "",
    @Headers("x-member-kiosk-key") headerKey = "",
    @Req() req: { ip?: string; headers?: Record<string, string | undefined> },
  ) {
    requireKioskKey(headerKey || k);
    const name = String(body?.name ?? "").trim();
    const phone = String(body?.phone ?? "").trim();
    if (!name) throw new BadRequestException("กรอกชื่อ");
    if (!phone) throw new BadRequestException("กรอกเบอร์โทร");

    const ip = clientIp(req);
    const phoneKey = phone.replace(/\D/g, "").slice(-10) || "-";
    assertKioskRate(`kiosk-reg:ip:${ip}`, 8, 60_000);
    assertKioskRate(`kiosk-reg:phone:${phoneKey}`, 3, 60 * 60_000);

    return this.members.registerFromKiosk({
      name,
      phone,
      source: body?.source,
      idToken: body?.idToken,
    });
  }
}
