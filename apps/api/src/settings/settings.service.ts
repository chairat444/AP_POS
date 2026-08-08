import {
  BadRequestException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from "@nestjs/common";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, unlinkSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { pg } from "@ap-pos/db";
import { DatabaseService } from "../db/database.service";
import {
  DEFAULT_KEYBINDINGS,
  mergeKeybindings,
  sanitizeKeybindingMap,
  type KeybindingMap,
} from "@ap-pos/shared";
import {
  CUSTOMER_ADS_MAX_ITEMS,
  DEFAULT_BRANDING_CONFIG,
  DEFAULT_CUSTOMER_ADS_CONFIG,
  DEFAULT_DISPLAY_CONFIG,
  DEFAULT_POINTS_CONFIG,
  DEFAULT_PRICING_CONFIG,
  type AppSettingsRecord,
  type BrandingConfig,
  type CustomerAdItem,
  type CustomerAdsConfig,
  type DisplayConfig,
  type PointsConfig,
  type PricingConfig,
  type UpdateBrandingDto,
  type UpdateCustomerAdsDto,
  type UpdateDisplayDto,
  type UpdateKeybindingsDto,
  type UpdatePointsDto,
  type UpdatePricingDto,
} from "./settings.types";

const POINTS_KEY = "points";
const DISPLAY_KEY = "display";
const PRICING_KEY = "pricing";
const BRANDING_KEY = "branding";
const CUSTOMER_ADS_KEY = "customerAds";
const KEYBINDINGS_KEY = "keybindings";

function now() {
  return new Date();
}

function brandingDir() {
  return join(process.cwd(), "uploads", "branding");
}

function customerAdsDir() {
  return join(process.cwd(), "uploads", "customer-ads");
}

function customerDisplayDir() {
  return join(process.cwd(), "uploads", "customer-display");
}

function clampDuration(sec: number, fallback: number) {
  if (!Number.isFinite(sec) || sec < 3) return fallback;
  return Math.min(120, Math.round(sec));
}

function unlinkUpload(url: string | null | undefined) {
  if (!url) return;
  if (
    !url.startsWith("/uploads/customer-ads/") &&
    !url.startsWith("/uploads/customer-display/")
  ) {
    return;
  }
  const prev = join(process.cwd(), url.replace(/^\//, ""));
  if (existsSync(prev)) {
    try {
      unlinkSync(prev);
    } catch {
      /* ignore */
    }
  }
}

@Injectable()
export class SettingsService implements OnModuleInit {
  constructor(private readonly database: DatabaseService) {}

  async onModuleInit() {
    await this.ensureDefaultLogo();
  }

  /** ถ้ายังไม่มีโลโก้ใน DB แต่มีไฟล์ default → ตั้งให้ */
  private async ensureDefaultLogo() {
    mkdirSync(brandingDir(), { recursive: true });
    const dest = join(brandingDir(), "store-logo.png");
    if (!existsSync(dest)) {
      const bundled = [
        join(process.cwd(), "assets", "store-logo.png"),
        join(__dirname, "..", "..", "assets", "store-logo.png"),
      ].find((p) => existsSync(p));
      if (bundled) copyFileSync(bundled, dest);
    }
    const current = await this.getBranding();
    if (current.logoUrl) return;
    if (!existsSync(dest)) return;
    await this.upsert(
      BRANDING_KEY,
      JSON.stringify({
        ...current,
        logoUrl: "/uploads/branding/store-logo.png",
      } satisfies BrandingConfig),
    );
  }

  async get(): Promise<AppSettingsRecord> {
    const [
      points,
      display,
      pricing,
      branding,
      customerAds,
      keybindings,
      pointRow,
      displayRow,
      pricingRow,
      brandingRow,
      adsRow,
      keyRow,
    ] = await Promise.all([
      this.getPoints(),
      this.getDisplay(),
      this.getPricing(),
      this.getBranding(),
      this.getCustomerAds(),
      this.getKeybindings(),
      this.database.db
        .select()
        .from(pg.appSettings)
        .where(eq(pg.appSettings.key, POINTS_KEY))
        .limit(1),
      this.database.db
        .select()
        .from(pg.appSettings)
        .where(eq(pg.appSettings.key, DISPLAY_KEY))
        .limit(1),
      this.database.db
        .select()
        .from(pg.appSettings)
        .where(eq(pg.appSettings.key, PRICING_KEY))
        .limit(1),
      this.database.db
        .select()
        .from(pg.appSettings)
        .where(eq(pg.appSettings.key, BRANDING_KEY))
        .limit(1),
      this.database.db
        .select()
        .from(pg.appSettings)
        .where(eq(pg.appSettings.key, CUSTOMER_ADS_KEY))
        .limit(1),
      this.database.db
        .select()
        .from(pg.appSettings)
        .where(eq(pg.appSettings.key, KEYBINDINGS_KEY))
        .limit(1),
    ]);
    const updatedAt = [
      pointRow[0]?.updatedAt,
      displayRow[0]?.updatedAt,
      pricingRow[0]?.updatedAt,
      brandingRow[0]?.updatedAt,
      adsRow[0]?.updatedAt,
      keyRow[0]?.updatedAt,
    ]
      .filter(Boolean)
      .map((d) => d!.toISOString())
      .sort()
      .at(-1);
    return {
      points,
      display,
      pricing,
      branding,
      customerAds,
      keybindings,
      updatedAt: updatedAt ?? new Date().toISOString(),
    };
  }

  async getPoints(): Promise<PointsConfig> {
    const rows = await this.database.db
      .select()
      .from(pg.appSettings)
      .where(eq(pg.appSettings.key, POINTS_KEY))
      .limit(1);
    if (!rows[0]) return { ...DEFAULT_POINTS_CONFIG };
    try {
      const parsed = JSON.parse(rows[0].value) as Partial<PointsConfig>;
      return {
        bahtPerPoint:
          Number(parsed.bahtPerPoint) > 0
            ? Number(parsed.bahtPerPoint)
            : DEFAULT_POINTS_CONFIG.bahtPerPoint,
        bahtPerRedeemPoint:
          Number(parsed.bahtPerRedeemPoint) > 0
            ? Number(parsed.bahtPerRedeemPoint)
            : DEFAULT_POINTS_CONFIG.bahtPerRedeemPoint,
      };
    } catch {
      return { ...DEFAULT_POINTS_CONFIG };
    }
  }

  async getDisplay(): Promise<DisplayConfig> {
    const rows = await this.database.db
      .select()
      .from(pg.appSettings)
      .where(eq(pg.appSettings.key, DISPLAY_KEY))
      .limit(1);
    if (!rows[0]) return { ...DEFAULT_DISPLAY_CONFIG };
    try {
      const parsed = JSON.parse(rows[0].value) as Partial<DisplayConfig>;
      return {
        customerScreenEnabled:
          parsed.customerScreenEnabled == null
            ? DEFAULT_DISPLAY_CONFIG.customerScreenEnabled
            : Boolean(parsed.customerScreenEnabled),
        bannerUrl:
          parsed.bannerUrl == null || parsed.bannerUrl === ""
            ? null
            : String(parsed.bannerUrl),
        panelUrl:
          parsed.panelUrl == null || parsed.panelUrl === ""
            ? null
            : String(parsed.panelUrl),
      };
    } catch {
      return { ...DEFAULT_DISPLAY_CONFIG };
    }
  }

  async getPricing(): Promise<PricingConfig> {
    const rows = await this.database.db
      .select()
      .from(pg.appSettings)
      .where(eq(pg.appSettings.key, PRICING_KEY))
      .limit(1);
    if (!rows[0]) return { ...DEFAULT_PRICING_CONFIG };
    try {
      const parsed = JSON.parse(rows[0].value) as Partial<PricingConfig>;
      const m = Number(parsed.freshSuggestedMarginPct);
      return {
        freshSuggestedMarginPct:
          Number.isFinite(m) && m > 0 && m < 100
            ? m
            : DEFAULT_PRICING_CONFIG.freshSuggestedMarginPct,
      };
    } catch {
      return { ...DEFAULT_PRICING_CONFIG };
    }
  }

  async getBranding(): Promise<BrandingConfig> {
    const rows = await this.database.db
      .select()
      .from(pg.appSettings)
      .where(eq(pg.appSettings.key, BRANDING_KEY))
      .limit(1);
    if (!rows[0]) return { ...DEFAULT_BRANDING_CONFIG };
    try {
      const parsed = JSON.parse(rows[0].value) as Partial<BrandingConfig>;
      return {
        storeName:
          String(parsed.storeName ?? "").trim() ||
          DEFAULT_BRANDING_CONFIG.storeName,
        storeTagline:
          String(parsed.storeTagline ?? "").trim() ||
          DEFAULT_BRANDING_CONFIG.storeTagline,
        logoUrl:
          parsed.logoUrl == null || parsed.logoUrl === ""
            ? null
            : String(parsed.logoUrl),
      };
    } catch {
      return { ...DEFAULT_BRANDING_CONFIG };
    }
  }

  private normalizeCustomerAds(
    raw: Partial<CustomerAdsConfig> | null | undefined,
  ): CustomerAdsConfig {
    const imageDurationSec = clampDuration(
      Number(raw?.imageDurationSec),
      DEFAULT_CUSTOMER_ADS_CONFIG.imageDurationSec,
    );
    const itemsRaw = Array.isArray(raw?.items) ? raw!.items : [];
    const items: CustomerAdItem[] = itemsRaw
      .filter(
        (it): it is CustomerAdItem =>
          Boolean(it) &&
          typeof it === "object" &&
          typeof (it as CustomerAdItem).id === "string" &&
          typeof (it as CustomerAdItem).url === "string" &&
          ((it as CustomerAdItem).type === "image" ||
            (it as CustomerAdItem).type === "video"),
      )
      .map((it, idx) => ({
        id: String(it.id),
        type: (it.type === "video" ? "video" : "image") as "image" | "video",
        url: String(it.url),
        name: String(it.name || "").trim().slice(0, 120) || `สื่อ ${idx + 1}`,
        sort: Number.isFinite(Number(it.sort)) ? Number(it.sort) : idx,
        active: it.active !== false,
        durationSec: clampDuration(Number(it.durationSec), imageDurationSec),
      }))
      .sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name))
      .slice(0, CUSTOMER_ADS_MAX_ITEMS)
      .map((it, idx): CustomerAdItem => ({ ...it, sort: idx }));

    return {
      enabled: raw?.enabled !== false,
      imageDurationSec,
      items,
    };
  }

  async getCustomerAds(): Promise<CustomerAdsConfig> {
    const rows = await this.database.db
      .select()
      .from(pg.appSettings)
      .where(eq(pg.appSettings.key, CUSTOMER_ADS_KEY))
      .limit(1);
    if (!rows[0]) return { ...DEFAULT_CUSTOMER_ADS_CONFIG, items: [] };
    try {
      const parsed = JSON.parse(rows[0].value) as Partial<CustomerAdsConfig>;
      return this.normalizeCustomerAds(parsed);
    } catch {
      return { ...DEFAULT_CUSTOMER_ADS_CONFIG, items: [] };
    }
  }

  /** คืน map ที่ merge กับ default แล้ว — POS/Admin ใช้แสดงผลตรงๆ */
  async getKeybindings(): Promise<KeybindingMap> {
    const override = await this.getKeybindingsOverride();
    return mergeKeybindings(DEFAULT_KEYBINDINGS, override);
  }

  private async getKeybindingsOverride(): Promise<KeybindingMap> {
    const rows = await this.database.db
      .select()
      .from(pg.appSettings)
      .where(eq(pg.appSettings.key, KEYBINDINGS_KEY))
      .limit(1);
    if (!rows[0]) return {};
    try {
      return sanitizeKeybindingMap(JSON.parse(rows[0].value));
    } catch {
      return {};
    }
  }

  async updateKeybindings(
    dto: UpdateKeybindingsDto,
  ): Promise<AppSettingsRecord> {
    const incoming = sanitizeKeybindingMap(dto.keybindings ?? {});
    if (!Object.keys(incoming).length) {
      throw new BadRequestException("ไม่มีคีย์ลัดให้บันทึก");
    }
    const current = await this.getKeybindingsOverride();
    const next = { ...current, ...incoming };
    await this.upsert(KEYBINDINGS_KEY, JSON.stringify(next));
    return this.get();
  }

  async resetKeybindings(): Promise<AppSettingsRecord> {
    await this.upsert(KEYBINDINGS_KEY, JSON.stringify({}));
    return this.get();
  }

  private async saveCustomerAds(
    next: CustomerAdsConfig,
  ): Promise<AppSettingsRecord> {
    await this.upsert(
      CUSTOMER_ADS_KEY,
      JSON.stringify(this.normalizeCustomerAds(next)),
    );
    return this.get();
  }

  async updateCustomerAds(
    dto: UpdateCustomerAdsDto,
  ): Promise<AppSettingsRecord> {
    const current = await this.getCustomerAds();
    return this.saveCustomerAds({
      enabled: dto.enabled == null ? current.enabled : Boolean(dto.enabled),
      imageDurationSec:
        dto.imageDurationSec == null
          ? current.imageDurationSec
          : Number(dto.imageDurationSec),
      items: dto.items == null ? current.items : dto.items,
    });
  }

  async addCustomerAd(file: Express.Multer.File): Promise<AppSettingsRecord> {
    mkdirSync(customerAdsDir(), { recursive: true });
    const current = await this.getCustomerAds();
    if (current.items.length >= CUSTOMER_ADS_MAX_ITEMS) {
      unlinkUpload(`/uploads/customer-ads/${file.filename}`);
      throw new BadRequestException(
        `เพิ่มได้สูงสุด ${CUSTOMER_ADS_MAX_ITEMS} รายการ`,
      );
    }
    const isVideo = file.mimetype.startsWith("video/");
    const item: CustomerAdItem = {
      id: randomUUID(),
      type: isVideo ? "video" : "image",
      url: `/uploads/customer-ads/${file.filename}`,
      name: String(file.originalname || file.filename)
        .trim()
        .slice(0, 120),
      sort: current.items.length,
      active: true,
      durationSec: current.imageDurationSec,
    };
    return this.saveCustomerAds({
      ...current,
      items: [...current.items, item],
    });
  }

  async removeCustomerAd(id: string): Promise<AppSettingsRecord> {
    const current = await this.getCustomerAds();
    const target = current.items.find((it) => it.id === id);
    if (!target) throw new NotFoundException("ไม่พบสื่อโฆษณา");
    unlinkUpload(target.url);
    return this.saveCustomerAds({
      ...current,
      items: current.items.filter((it) => it.id !== id),
    });
  }

  async patchCustomerAd(
    id: string,
    patch: Partial<
      Pick<CustomerAdItem, "active" | "durationSec" | "name" | "sort">
    >,
  ): Promise<AppSettingsRecord> {
    const current = await this.getCustomerAds();
    const idx = current.items.findIndex((it) => it.id === id);
    if (idx < 0) throw new NotFoundException("ไม่พบสื่อโฆษณา");
    const items = current.items.map((it) => ({ ...it }));
    const next = { ...items[idx]! };
    if (patch.active != null) next.active = Boolean(patch.active);
    if (patch.durationSec != null) {
      next.durationSec = clampDuration(
        Number(patch.durationSec),
        current.imageDurationSec,
      );
    }
    if (patch.name != null) {
      next.name = String(patch.name).trim().slice(0, 120) || next.name;
    }
    if (patch.sort != null && Number.isFinite(Number(patch.sort))) {
      next.sort = Number(patch.sort);
    }
    items[idx] = next;
    return this.saveCustomerAds({ ...current, items });
  }

  private async upsert(key: string, value: string) {
    const ts = now();
    const existing = await this.database.db
      .select()
      .from(pg.appSettings)
      .where(eq(pg.appSettings.key, key))
      .limit(1);
    if (existing[0]) {
      await this.database.db
        .update(pg.appSettings)
        .set({ value, updatedAt: ts })
        .where(eq(pg.appSettings.key, key));
    } else {
      await this.database.db.insert(pg.appSettings).values({
        key,
        value,
        updatedAt: ts,
      });
    }
  }

  async updatePoints(dto: UpdatePointsDto): Promise<AppSettingsRecord> {
    const current = await this.getPoints();
    const next: PointsConfig = {
      bahtPerPoint:
        dto.bahtPerPoint == null ? current.bahtPerPoint : Number(dto.bahtPerPoint),
      bahtPerRedeemPoint:
        dto.bahtPerRedeemPoint == null
          ? current.bahtPerRedeemPoint
          : Number(dto.bahtPerRedeemPoint),
    };
    if (!Number.isFinite(next.bahtPerPoint) || next.bahtPerPoint <= 0) {
      throw new BadRequestException("ยอดบาทต่อแต้มต้องมากกว่า 0");
    }
    if (
      !Number.isFinite(next.bahtPerRedeemPoint) ||
      next.bahtPerRedeemPoint <= 0
    ) {
      throw new BadRequestException("มูลค่าแต้มแลกต้องมากกว่า 0");
    }
    await this.upsert(POINTS_KEY, JSON.stringify(next));
    return this.get();
  }

  async updateDisplay(dto: UpdateDisplayDto): Promise<AppSettingsRecord> {
    const current = await this.getDisplay();
    const next: DisplayConfig = {
      customerScreenEnabled:
        dto.customerScreenEnabled == null
          ? current.customerScreenEnabled
          : Boolean(dto.customerScreenEnabled),
      bannerUrl:
        dto.bannerUrl === undefined ? current.bannerUrl : dto.bannerUrl || null,
      panelUrl:
        dto.panelUrl === undefined ? current.panelUrl : dto.panelUrl || null,
    };
    await this.upsert(DISPLAY_KEY, JSON.stringify(next));
    return this.get();
  }

  async setDisplayMedia(
    slot: "banner" | "panel",
    filename: string,
  ): Promise<AppSettingsRecord> {
    mkdirSync(customerDisplayDir(), { recursive: true });
    const current = await this.getDisplay();
    const url = `/uploads/customer-display/${filename}`;
    if (slot === "banner") {
      if (current.bannerUrl && current.bannerUrl !== url) {
        unlinkUpload(current.bannerUrl);
      }
      return this.updateDisplay({ bannerUrl: url });
    }
    if (current.panelUrl && current.panelUrl !== url) {
      unlinkUpload(current.panelUrl);
    }
    return this.updateDisplay({ panelUrl: url });
  }

  async clearDisplayMedia(
    slot: "banner" | "panel",
  ): Promise<AppSettingsRecord> {
    const current = await this.getDisplay();
    if (slot === "banner") {
      unlinkUpload(current.bannerUrl);
      return this.updateDisplay({ bannerUrl: null });
    }
    unlinkUpload(current.panelUrl);
    return this.updateDisplay({ panelUrl: null });
  }

  async updatePricing(dto: UpdatePricingDto): Promise<PricingConfig> {
    const current = await this.getPricing();
    const next: PricingConfig = {
      freshSuggestedMarginPct:
        dto.freshSuggestedMarginPct == null
          ? current.freshSuggestedMarginPct
          : Number(dto.freshSuggestedMarginPct),
    };
    if (
      !Number.isFinite(next.freshSuggestedMarginPct) ||
      next.freshSuggestedMarginPct <= 0 ||
      next.freshSuggestedMarginPct >= 100
    ) {
      throw new BadRequestException("กำไรแนะนำต้องอยู่ระหว่าง 1–99%");
    }
    await this.upsert(PRICING_KEY, JSON.stringify(next));
    return this.getPricing();
  }

  async updateBranding(dto: UpdateBrandingDto): Promise<AppSettingsRecord> {
    const current = await this.getBranding();
    const next: BrandingConfig = {
      storeName:
        dto.storeName == null
          ? current.storeName
          : String(dto.storeName).trim() || DEFAULT_BRANDING_CONFIG.storeName,
      storeTagline:
        dto.storeTagline == null
          ? current.storeTagline
          : String(dto.storeTagline).trim() ||
            DEFAULT_BRANDING_CONFIG.storeTagline,
      logoUrl:
        dto.logoUrl === undefined ? current.logoUrl : dto.logoUrl || null,
    };
    await this.upsert(BRANDING_KEY, JSON.stringify(next));
    return this.get();
  }

  async setLogo(filename: string): Promise<AppSettingsRecord> {
    const current = await this.getBranding();
    if (current.logoUrl) {
      const prev = join(process.cwd(), current.logoUrl.replace(/^\//, ""));
      if (
        existsSync(prev) &&
        !prev.endsWith("store-logo.png") &&
        prev !== join(brandingDir(), filename)
      ) {
        try {
          unlinkSync(prev);
        } catch {
          /* ignore */
        }
      }
    }
    // คงชื่อ canonical เพื่อให้ login/static ชี้ได้ง่าย
    const dest = join(brandingDir(), "store-logo.png");
    const src = join(brandingDir(), filename);
    if (src !== dest && existsSync(src)) {
      copyFileSync(src, dest);
      try {
        unlinkSync(src);
      } catch {
        /* ignore */
      }
    }
    return this.updateBranding({
      logoUrl: "/uploads/branding/store-logo.png",
    });
  }

  async clearLogo(): Promise<AppSettingsRecord> {
    const current = await this.getBranding();
    if (current.logoUrl) {
      const prev = join(process.cwd(), current.logoUrl.replace(/^\//, ""));
      if (existsSync(prev)) {
        try {
          unlinkSync(prev);
        } catch {
          /* ignore */
        }
      }
    }
    return this.updateBranding({ logoUrl: null });
  }
}
