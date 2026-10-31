export type PointsConfig = {
  bahtPerPoint: number;
  bahtPerRedeemPoint: number;
};

export const DEFAULT_POINTS_CONFIG: PointsConfig = {
  bahtPerPoint: 100,
  bahtPerRedeemPoint: 1,
};

/** แต้มของขวัญตอนสมัครผ่านลิงก์ LINE OA (`/member?k=…&src=line`) */
export type LineSignupConfig = {
  enabled: boolean;
  bonusPoints: number;
  /** YYYY-MM-DD โซนไทย · ว่าง = ไม่จำกัดวันเริ่ม */
  startDate: string;
  /** YYYY-MM-DD โซนไทย · ว่าง = ไม่จำกัดวันสิ้นสุด */
  endDate: string;
  /** ใช้ {n} แทนจำนวนแต้ม */
  headline: string;
};

export const DEFAULT_LINE_SIGNUP_CONFIG: LineSignupConfig = {
  enabled: true,
  bonusPoints: 10,
  startDate: "",
  endDate: "",
  headline: "สมัครผ่านไลน์วันนี้รับ {n} แต้ม",
};

export type UpdateLineSignupDto = {
  enabled?: boolean;
  bonusPoints?: number;
  startDate?: string;
  endDate?: string;
  headline?: string;
};

export type DisplayConfig = {
  /** เปิดจอลูกค้า (จอ 2) */
  customerScreenEnabled: boolean;
  /** แบนเนอร์ด้านบน แทนโลโก้+ชื่อ */
  bannerUrl: string | null;
  /** แบนเนอร์กลาง ต่อจากโฆษณา ก่อนรูปด้านล่าง */
  midBannerUrl: string | null;
  /** รูป/GIF ด้านล่างแทนข้อความยินดีต้อนรับ/กำลังคิดเงิน */
  panelUrl: string | null;
  /** PromptPay (เบอร์ / เลขบัตร) — ว่าง = ไม่โชว์ QR */
  promptPayId: string | null;
};

export const DEFAULT_DISPLAY_CONFIG: DisplayConfig = {
  customerScreenEnabled: true,
  bannerUrl: null,
  midBannerUrl: null,
  panelUrl: null,
  /** fallback เก่า — ใช้ค่าสาขาก่อน */
  promptPayId: null,
};

export type PricingConfig = {
  /** กำไรแนะนำ % บนราคาขาย สำหรับของสด (บาร์โค้ดขึ้นต้น 9) */
  freshSuggestedMarginPct: number;
};

export const DEFAULT_PRICING_CONFIG: PricingConfig = {
  freshSuggestedMarginPct: 40,
};

export type BrandingConfig = {
  storeName: string;
  storeTagline: string;
  logoUrl: string | null;
};

export const DEFAULT_BRANDING_CONFIG: BrandingConfig = {
  storeName: "AP หมูสด",
  storeTagline: "Fresh Pork POS",
  logoUrl: null,
};

/** สื่อโฆษณาบนจอลูกค้า (จอ 2) */
export type CustomerAdItem = {
  id: string;
  type: "image" | "video";
  url: string;
  name: string;
  sort: number;
  active: boolean;
  /** วินาทีที่แสดงรูป — วิดีโอใช้ความยาวคลิป */
  durationSec: number;
};

export type CustomerAdsConfig = {
  enabled: boolean;
  /** ค่าเริ่มต้นวินาทีต่อรูป */
  imageDurationSec: number;
  items: CustomerAdItem[];
};

export const DEFAULT_CUSTOMER_ADS_CONFIG: CustomerAdsConfig = {
  enabled: true,
  imageDurationSec: 8,
  items: [],
};

export const CUSTOMER_ADS_MAX_ITEMS = 20;
export const CUSTOMER_ADS_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const CUSTOMER_ADS_VIDEO_MAX_BYTES = 40 * 1024 * 1024;
/** แบนเนอร์/แผงจอ 2 — อนุญาต GIF ใหญ่ขึ้นหน่อย */
export const CUSTOMER_DISPLAY_IMAGE_MAX_BYTES = 8 * 1024 * 1024;

export type AppSettingsRecord = {
  points: PointsConfig;
  display: DisplayConfig;
  pricing: PricingConfig;
  branding: BrandingConfig;
  customerAds: CustomerAdsConfig;
  /** คีย์ลัด POS — partial ทับ DEFAULT */
  keybindings: Record<string, Array<{
    key: string;
    ctrl?: boolean;
    shift?: boolean;
    alt?: boolean;
    meta?: boolean;
  }>>;
  updatedAt: string;
};

export type UpdatePointsDto = {
  bahtPerPoint?: number;
  bahtPerRedeemPoint?: number;
};

export type UpdateDisplayDto = {
  customerScreenEnabled?: boolean;
  bannerUrl?: string | null;
  midBannerUrl?: string | null;
  panelUrl?: string | null;
  promptPayId?: string | null;
};

export type UpdatePricingDto = {
  freshSuggestedMarginPct?: number;
};

export type UpdateBrandingDto = {
  storeName?: string;
  storeTagline?: string;
  logoUrl?: string | null;
};

export type UpdateCustomerAdsDto = {
  enabled?: boolean;
  imageDurationSec?: number;
  items?: CustomerAdItem[];
};

export type UpdateKeybindingsDto = {
  keybindings?: Record<
    string,
    Array<{
      key: string;
      ctrl?: boolean;
      shift?: boolean;
      alt?: boolean;
      meta?: boolean;
    }>
  >;
};
