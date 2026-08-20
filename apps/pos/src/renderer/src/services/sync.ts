import type { CartLine } from "@ap-pos/shared";
import { ref } from "vue";
import type { Member } from "../data/demo-members";
import { PLACEHOLDER_IMAGE, type QuickProduct } from "../data/demo-products";
import type { PaymentEntry } from "../stores/cart";
import { savePrinterConfig } from "./receipt";

const DEFAULT_API_BASE = (
  import.meta.env.VITE_API_BASE ?? "http://localhost:3000"
).replace(/\/$/, "");
const API_BASE_META = "pos-api-base";
const ADMIN_URL_META = "pos-admin-url";

/** URL API ที่ใช้จริง — ตั้งจากหน้า config ได้ (ค่าเริ่มจาก build) */
let runtimeApiBase = DEFAULT_API_BASE;
let runtimeAdminUrl = "";

export function getApiBase() {
  return runtimeApiBase || DEFAULT_API_BASE;
}

/** Admin URL — ถ้าไม่ตั้ง จะเดาจาก API (พอร์ต 3000→3100) */
export function getAdminUrl() {
  if (runtimeAdminUrl) return runtimeAdminUrl;
  try {
    const u = new URL(getApiBase());
    if (u.port === "3000" || u.port === "") u.port = "3100";
    return u.toString().replace(/\/$/, "");
  } catch {
    return "";
  }
}

export function getDefaultApiBase() {
  return DEFAULT_API_BASE;
}

/** bump เมื่อ media cache พร้อม — ให้ computed ที่อ่าน epoch รีเรนเดอร์ */
export const mediaCacheEpoch = ref(0);

export type DeviceConfig = {
  branchId: string;
  branchName: string;
  terminalId: string;
  terminalName?: string;
  setupDone?: boolean;
};

export type SyncedSalePayload = {
  id: string;
  billNo: string;
  branchId: string;
  terminalId: string;
  shiftId?: string | null;
  customerId?: string | null;
  customerName?: string;
  subtotal: number;
  discount: number;
  total: number;
  paid: number;
  change: number;
  pointsRedeemed: number;
  pointsEarned: number;
  createdAt: string;
  payments: PaymentEntry[];
  lines: CartLine[];
};

export type SyncedShiftPayload = {
  id: string;
  branchId: string;
  terminalId: string;
  staffId?: string | null;
  staffCode?: string | null;
  staffName: string;
  openedAt: string;
  closedAt?: string | null;
  openCash: number;
  closeCash?: number | null;
  expectedCash?: number | null;
  variance?: number | null;
  status: "open" | "closed";
  billCount?: number;
  grossTotal?: number;
  closeNote?: string | null;
  summary?: unknown;
  cashMoves?: unknown[];
  cashCounts?: unknown[];
  terminalName?: string;
};

export type SyncedAuditPayload = {
  id: string;
  shiftId: string;
  branchId: string;
  terminalId: string;
  staffId?: string | null;
  staffName: string;
  type: "line_void" | "bill_cancel" | string;
  at: string;
  barcode?: string | null;
  productName?: string | null;
  qty?: number | null;
  amount: number;
  billTotalBefore?: number | null;
  itemCountBefore?: number | null;
};

type BootstrapResponse = {
  cursor: string;
  products: ApiProduct[];
  members: Member[];
  promos?: Array<{
    id: string;
    productCode: string;
    buyQty: number;
    payAmount: number;
    label: string;
    active?: boolean;
  }>;
  settings?: {
    points?: { bahtPerPoint: number; bahtPerRedeemPoint: number };
    display?: {
      customerScreenEnabled?: boolean;
      bannerUrl?: string | null;
      midBannerUrl?: string | null;
      panelUrl?: string | null;
      promptPayId?: string | null;
    };
    branding?: {
      storeName?: string;
      storeTagline?: string;
      logoUrl?: string | null;
    };
    customerAds?: {
      enabled?: boolean;
      imageDurationSec?: number;
      items?: Array<{
        id: string;
        type: "image" | "video";
        url: string;
        name: string;
        sort: number;
        active: boolean;
        durationSec: number;
      }>;
    };
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
    updatedAt?: string;
  };
  removedProductIds: string[];
  removedMemberIds: string[];
  removedPromoIds?: string[];
};

type ApiProduct = {
  id: string;
  barcode: string;
  productCode?: string;
  name: string;
  unit: string;
  costPrice?: number | null;
  price: number | null;
  isQuick: boolean;
  quickSort: number;
  imageUrl: string | null;
  isOpenPrice?: boolean;
  openPriceMax?: number;
  updatedAt?: string;
};

type SyncEnvelope =
  | {
      id: string;
      type: "sale";
      payload: SyncedSalePayload;
    }
  | {
      id: string;
      type: "shift";
      payload: SyncedShiftPayload;
    }
  | {
      id: string;
      type: "audit";
      payload: SyncedAuditPayload;
    };

/** remote absolute URL → appos-media:// (โหลดจากดิสก์ตอนออฟไลน์) */
const mediaLocalByRemote = new Map<string, string>();

const MEDIA_FP_PREFIX = "media-fp:";

function toAbsoluteMediaUrl(url: string): string | null {
  const t = url.trim();
  if (!t) return null;
  if (
    t.startsWith("data:") ||
    t.startsWith("appos-media:") ||
    t.startsWith("blob:")
  ) {
    return null;
  }
  let abs: string;
  if (t.startsWith("http://") || t.startsWith("https://")) {
    abs = t;
  } else {
    abs = `${getApiBase()}${t.startsWith("/") ? "" : "/"}${t}`;
  }
  try {
    const u = new URL(abs);
    if (u.hostname === "127.0.0.1") u.hostname = "localhost";
    return u.href;
  } catch {
    return abs;
  }
}

function rememberMediaMap(map: Record<string, string>) {
  let added = 0;
  for (const [remote, local] of Object.entries(map)) {
    if (remote && local && mediaLocalByRemote.get(remote) !== local) {
      mediaLocalByRemote.set(remote, local);
      added++;
    }
  }
  if (added > 0) mediaCacheEpoch.value++;
}

function fingerprintUrls(urls: string[]): string {
  const abs = urls
    .map((u) => toAbsoluteMediaUrl(u) ?? u.trim())
    .filter(Boolean)
    .sort();
  return [...new Set(abs)].join("\n");
}

/** โหลดดัชนี cache จาก main (เรียกตอนเปิดแอป) */
export async function loadMediaIndex() {
  if (!window.apPos?.media?.index) return;
  try {
    rememberMediaMap(await window.apPos.media.index());
  } catch {
    /* ignore */
  }
}

/**
 * แคชสื่อแบบประหยัด:
 * - ดาวน์โหลดเฉพาะ URL ที่ยังไม่มีในดิสก์
 * - ข้ามทั้งชุดถ้า fingerprint รายการเดิม + ครบในเครื่องแล้ว (เมื่อใช้ fingerprint)
 * - force=true → ดาวน์โหลดใหม่ทั้งหมด (ใช้ตอนกดโหลดข้อมูลจอลูกค้า)
 */
export async function ensureMediaCached(
  scope: string,
  urls: Array<string | null | undefined>,
  opts?: { fingerprint?: boolean; force?: boolean },
): Promise<boolean> {
  if (!window.apPos?.media?.cache) return false;
  // ออฟไลน์ที่รู้แล้ว — อย่าพยายามดาวน์โหลด (กันค้างตอนเปิดแอป)
  if (isApiOfflineKnown()) return false;
  const list = [
    ...new Set(
      urls.filter((u): u is string => Boolean(u && String(u).trim())),
    ),
  ];
  if (!list.length) return false;

  await loadMediaIndex();

  const force = Boolean(opts?.force);
  const missing: string[] = [];
  for (const u of list) {
    const abs = toAbsoluteMediaUrl(u);
    if (!abs) continue;
    if (force || !mediaLocalByRemote.has(abs)) missing.push(abs);
  }

  const useFp = !force && opts?.fingerprint !== false;
  if (useFp) {
    const fp = fingerprintUrls(list);
    const metaKey = `${MEDIA_FP_PREFIX}${scope}`;
    let prevFp: string | null = null;
    try {
      prevFp = (await window.apPos.db?.getMeta?.(metaKey)) ?? null;
    } catch {
      prevFp = null;
    }

    if (missing.length === 0 && prevFp === fp) {
      return false;
    }

    if (missing.length > 0) {
      try {
        rememberMediaMap(await window.apPos.media.cache(missing, false));
      } catch {
        return false;
      }
    }

    try {
      await window.apPos.db?.setMeta?.(metaKey, fp);
    } catch {
      /* ignore */
    }
    return missing.length > 0;
  }

  if (!missing.length) return false;
  try {
    rememberMediaMap(await window.apPos.media.cache(missing, force));
    if (force) {
      // ไฟล์ชื่อเดิมเนื้อหาใหม่อาจได้ local URL เดิม — บังคับให้จอรีเรนเดอร์
      mediaCacheEpoch.value++;
      try {
        await window.apPos.db?.setMeta?.(
          `${MEDIA_FP_PREFIX}${scope}`,
          fingerprintUrls(list),
        );
      } catch {
        /* ignore */
      }
    }
    return true;
  } catch {
    return false;
  }
}

/** @deprecated ใช้ ensureMediaCached — ยังเรียกได้ จะดาวน์โหลดเฉพาะที่ขาด */
export async function cacheMediaUrls(urls: Array<string | null | undefined>) {
  await ensureMediaCached("adhoc", urls, { fingerprint: false });
}

export async function ensureSettingsMediaCached(
  settings: BootstrapResponse["settings"] | null | undefined,
  opts?: { force?: boolean },
) {
  return ensureMediaCached("settings", collectSettingsMediaUrls(settings), {
    force: opts?.force,
  });
}

/**
 * แคชรูปสินค้าจาก SQLite ท้องถิ่น
 * ด่วนก่อน (หน้าขาย) — awaitQuick=true จะรอเฉพาะสินค้าด่วน
 * ข้ามถ้ารายการ URL ไม่เปลี่ยนและครบในดิสก์แล้ว
 */
export async function cacheLocalProductImages(opts?: {
  awaitQuick?: boolean;
}) {
  if (!window.apPos?.db?.listProducts) return false;
  const rows = await window.apPos.db.listProducts();
  const quickUrls: string[] = [];
  const otherUrls: string[] = [];
  for (const p of rows) {
    const u = p.imageUrl?.trim();
    if (!u) continue;
    if (p.isQuick) quickUrls.push(u);
    else otherUrls.push(u);
  }
  let changed = false;
  if (opts?.awaitQuick !== false) {
    changed = (await ensureMediaCached("products-quick", quickUrls)) || changed;
  } else {
    void ensureMediaCached("products-quick", quickUrls);
  }
  if (otherUrls.length) {
    void ensureMediaCached("products-other", otherUrls);
  }
  return changed;
}

/** แคชรูปจากรายการสินค้าที่ sync เข้ามาใหม่เท่านั้น (เฉพาะที่ยังไม่มีในดิสก์) */
export async function ensureProductImagesFromPull(
  products: Array<{ imageUrl?: string | null }>,
) {
  if (!products.length) return false;
  return ensureMediaCached(
    "products-pull",
    products.map((p) => p.imageUrl),
    { fingerprint: false },
  );
}

export function collectSettingsMediaUrls(
  settings: BootstrapResponse["settings"] | null | undefined,
): string[] {
  if (!settings) return [];
  const out: string[] = [];
  if (settings.branding?.logoUrl) out.push(settings.branding.logoUrl);
  if (settings.display?.bannerUrl) out.push(settings.display.bannerUrl);
  if (settings.display?.midBannerUrl) out.push(settings.display.midBannerUrl);
  if (settings.display?.panelUrl) out.push(settings.display.panelUrl);
  for (const it of settings.customerAds?.items ?? []) {
    if (it?.url) out.push(it.url);
  }
  return out;
}

export function resolveImage(url: string | null | undefined, fallback: string) {
  if (!url) return fallback;
  if (
    url.startsWith("data:") ||
    url.startsWith("appos-media:") ||
    url.startsWith("blob:")
  ) {
    return url;
  }
  const abs = toAbsoluteMediaUrl(url);
  if (abs) {
    const local = mediaLocalByRemote.get(abs);
    if (local) {
      // epoch กัน Electron ค้างรูปเดิมเมื่อไฟล์ชื่อเดิมถูกเขียนทับ
      const sep = local.includes("?") ? "&" : "?";
      return `${local}${sep}e=${mediaCacheEpoch.value}`;
    }
  }
  if (url.startsWith("http://") || url.startsWith("https://")) {
    return url;
  }
  return `${getApiBase()}${url.startsWith("/") ? "" : "/"}${url}`;
}

/**
 * โฆษณาจอลูกค้า — วิดีโอควรใช้ HTTP ตอนออนไลน์
 * (appos-media:// มักเล่นวิดีโอไม่นิ่ง / ไม่รองรับ range ดีพอ)
 */
export function resolveAdMediaUrl(
  url: string,
  type: "image" | "video",
): string {
  const abs = toAbsoluteMediaUrl(url);
  const cached = abs ? mediaLocalByRemote.get(abs) : undefined;
  if (type === "video") {
    if (abs && (abs.startsWith("http://") || abs.startsWith("https://"))) {
      return abs;
    }
    if (cached) return cached;
    return resolveImage(url, "");
  }
  return resolveImage(url, "");
}

function mapApiProducts(products: ApiProduct[]): QuickProduct[] {
  return products.map((p) => ({
    id: p.id,
    barcode: p.barcode,
    productCode: p.productCode,
    name: p.name,
    unit: p.unit,
    costPrice: p.costPrice ?? null,
    price: p.price,
    tone: "#495057",
    imageUrl: p.imageUrl ?? null,
    image: resolveImage(p.imageUrl, PLACEHOLDER_IMAGE),
    isQuick: Boolean(p.isQuick),
    quickSort: p.quickSort ?? 999,
    isOpenPrice: p.isOpenPrice ?? false,
    openPriceMax: p.openPriceMax ?? 100,
  }));
}

function toLocalProduct(
  p: QuickProduct,
  updatedAt = new Date().toISOString(),
) {
  return {
    id: p.id,
    barcode: p.barcode,
    productCode: p.productCode ?? null,
    name: p.name,
    unit: p.unit,
    costPrice: p.costPrice ?? null,
    price: p.price,
    isQuick: Boolean(p.isQuick),
    quickSort: p.quickSort ?? 999,
    imageUrl: p.imageUrl ?? (typeof p.image === "string" ? p.image : null),
    isOpenPrice: Boolean(p.isOpenPrice),
    openPriceMax: p.openPriceMax ?? 100,
    updatedAt,
  };
}

function fromLocalProduct(p: {
  id: string;
  barcode: string;
  productCode?: string | null;
  name: string;
  unit: string;
  costPrice?: number | null;
  price: number | null;
  isQuick: boolean;
  quickSort: number;
  imageUrl?: string | null;
  isOpenPrice: boolean;
  openPriceMax: number;
}): QuickProduct {
  return {
    id: p.id,
    barcode: p.barcode,
    productCode: p.productCode ?? undefined,
    name: p.name,
    unit: p.unit,
    costPrice: p.costPrice ?? null,
    price: p.price,
    tone: "#495057",
    imageUrl: p.imageUrl ?? null,
    image: resolveImage(p.imageUrl, PLACEHOLDER_IMAGE),
    isQuick: Boolean(p.isQuick),
    quickSort: p.quickSort ?? 999,
    isOpenPrice: Boolean(p.isOpenPrice),
    openPriceMax: p.openPriceMax ?? 100,
  };
}

/** กัน fetch ค้างบน Windows เมื่อโฮสต์ไม่ถึง — ไม่พึ่ง AbortSignal.timeout อย่างเดียว */
async function raceTimeout<T>(
  promise: Promise<T>,
  ms: number,
  fallback: T,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit | undefined,
  timeoutMs: number,
): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await raceTimeout(
      fetch(url, { ...init, signal: ctrl.signal }),
      timeoutMs + 250,
      null as unknown as Response,
    );
    if (!res) {
      ctrl.abort();
      throw new Error("timeout");
    }
    return res;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson<T>(url: string, timeoutMs = 3000): Promise<T> {
  const res = await fetchWithTimeout(url, undefined, timeoutMs);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
}

async function postJson<T>(
  url: string,
  body: unknown,
  timeoutMs = 4000,
): Promise<T> {
  const res = await fetchWithTimeout(
    url,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    timeoutMs,
  );
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const data = (await res.json()) as { message?: string | string[] };
      if (data?.message) {
        detail = Array.isArray(data.message)
          ? data.message.join(", ")
          : String(data.message);
      }
    } catch {
      // ignore
    }
    throw new Error(detail);
  }
  return (await res.json()) as T;
}

export async function getDeviceConfig(): Promise<DeviceConfig> {
  if (window.apPos?.db) return window.apPos.db.device();
  return {
    branchId: "branch-002",
    branchName: "สาขาเจ็ดเสมียน",
    terminalId: "terminal-dev",
    terminalName: "เครื่อง POS",
  };
}

export async function setDeviceBranch(branch: {
  id: string;
  name: string;
}): Promise<DeviceConfig> {
  const patch = { branchId: branch.id, branchName: branch.name };
  if (window.apPos?.db?.setDevice) {
    return window.apPos.db.setDevice(patch);
  }
  return {
    ...(await getDeviceConfig()),
    ...patch,
  };
}

export async function setDeviceTerminalName(
  terminalName: string,
): Promise<DeviceConfig> {
  const patch = { terminalName: terminalName.trim() || "เครื่อง POS" };
  if (window.apPos?.db?.setDevice) {
    return window.apPos.db.setDevice(patch);
  }
  return {
    ...(await getDeviceConfig()),
    ...patch,
  };
}

export async function setDeviceTerminal(terminal: {
  id: string;
  name: string;
  setupDone?: boolean;
}): Promise<DeviceConfig> {
  const patch = {
    terminalId: terminal.id,
    terminalName: terminal.name.trim() || "เครื่อง POS",
    ...(terminal.setupDone != null ? { setupDone: terminal.setupDone } : {}),
  };
  if (window.apPos?.db?.setDevice) {
    return window.apPos.db.setDevice(patch);
  }
  return {
    ...(await getDeviceConfig()),
    ...patch,
  };
}

export async function markDeviceSetupDone(): Promise<DeviceConfig> {
  if (window.apPos?.db?.setDevice) {
    return window.apPos.db.setDevice({ setupDone: true });
  }
  return {
    ...(await getDeviceConfig()),
    setupDone: true,
  };
}

/** ดึงค่าใบเสร็จจากเครื่องที่ Admin ตั้ง → เก็บในเครื่องนี้ */
export async function applyPrinterConfigFromTerminal(t: {
  paperWidth?: "58mm" | "80mm";
  autoPrint?: boolean;
  printSilent?: boolean;
  printerName?: string | null;
  receiptFooterHours?: string | null;
  receiptFooterPhones?: string | null;
}) {
  await savePrinterConfig({
    paperWidth: t.paperWidth === "80mm" ? "80mm" : "58mm",
    autoPrint: t.autoPrint !== false,
    silent: t.printSilent !== false,
    printerName: String(t.printerName ?? "").trim(),
    ...(t.receiptFooterHours != null
      ? { footerHours: String(t.receiptFooterHours).trim() }
      : {}),
    ...(t.receiptFooterPhones != null
      ? { footerPhones: String(t.receiptFooterPhones).trim() }
      : {}),
  });
}

/** ผูกเครื่องนี้กับเครื่องที่ Admin สร้างไว้แล้วเท่านั้น */
export async function claimThisTerminal(opts: {
  id: string;
  branchId: string;
}): Promise<{
  ok: true;
  device: DeviceConfig;
} | {
  ok: false;
  message: string;
}> {
  // ออฟไลน์ที่รู้แล้ว — ใช้แคชทันที อย่ารอ claim API
  if (isApiOfflineKnown()) {
    const cached = await loadTerminalsFromCache(opts.branchId);
    const hit = cached.find((t) => t.id === opts.id && t.active !== false);
    if (hit) {
      await applyPrinterConfigFromTerminal(hit);
      const device = window.apPos?.db?.setDevice
        ? await window.apPos.db.setDevice({
            branchId: opts.branchId,
            terminalId: hit.id,
            terminalName: hit.name,
          })
        : {
            ...(await getDeviceConfig()),
            branchId: opts.branchId,
            terminalId: hit.id,
            terminalName: hit.name,
          };
      return { ok: true, device };
    }
    return {
      ok: false,
      message: "ออฟไลน์ และไม่พบเครื่องนี้ในแคช — ต้องเชื่อมต่อ API ครั้งหนึ่งก่อน",
    };
  }

  try {
    const claimed = await postJson<{
      id: string;
      code: string;
      name: string;
      branchId: string;
      paperWidth?: "58mm" | "80mm";
      autoPrint?: boolean;
      printSilent?: boolean;
      printerName?: string | null;
      receiptFooterHours?: string | null;
      receiptFooterPhones?: string | null;
    }>(`${getApiBase()}/sync/terminals/claim`, {
      id: opts.id,
      branchId: opts.branchId,
    }, 2_500);
    markApiOnline();
    const devicePatch = {
      branchId: claimed.branchId || opts.branchId,
      terminalId: claimed.id,
      terminalName: claimed.name,
      setupDone: true as const,
    };
    await applyPrinterConfigFromTerminal(claimed);
    if (window.apPos?.db?.replaceDevice) {
      const current = await getDeviceConfig();
      const device = await window.apPos.db.replaceDevice({
        branchId: devicePatch.branchId,
        branchName: current.branchName,
        terminalId: devicePatch.terminalId,
        terminalName: devicePatch.terminalName,
        setupDone: true,
      });
      return { ok: true, device };
    }
    const device = window.apPos?.db?.setDevice
      ? await window.apPos.db.setDevice(devicePatch)
      : {
          ...(await getDeviceConfig()),
          ...devicePatch,
        };
    return { ok: true, device };
  } catch (e) {
    const msg =
      e instanceof Error ? e.message : "ยืนยันเครื่อง POS ไม่สำเร็จ";
    const notFound =
      msg.includes("ไม่พบ") ||
      msg.includes("404") ||
      msg.includes("สาขา") ||
      msg.includes("ปิดใช้งาน");

    // เครื่องไม่มีในระบบจริง — อย่าใช้ cache เก่า (เคยทำให้เลือกเครื่องผีได้)
    if (notFound) {
      if (window.apPos?.db?.setDevice) {
        await window.apPos.db.setDevice({ setupDone: false });
      }
      return {
        ok: false,
        message:
          msg.includes("สาขา") || msg.includes("ปิดใช้งาน")
            ? msg
            : "ไม่พบเครื่อง POS นี้ในระบบ — ไปสร้างที่ Admin (องค์กร → เครื่อง POS) แล้วเลือกลงทะเบียนใหม่",
      };
    }

    // offline / เน็ตมีปัญหา — ใช้ cache ได้
    markApiOffline();
    const cached = await loadTerminalsFromCache(opts.branchId);
    const hit = cached.find((t) => t.id === opts.id && t.active !== false);
    if (hit) {
      await applyPrinterConfigFromTerminal(hit);
      const device = window.apPos?.db?.setDevice
        ? await window.apPos.db.setDevice({
            branchId: opts.branchId,
            terminalId: hit.id,
            terminalName: hit.name,
          })
        : {
            ...(await getDeviceConfig()),
            branchId: opts.branchId,
            terminalId: hit.id,
            terminalName: hit.name,
          };
      return { ok: true, device };
    }
    return {
      ok: false,
      message: msg || "ยืนยันเครื่อง POS ไม่สำเร็จ (ตรวจเน็ตหรือสร้างเครื่องที่ Admin)",
    };
  }
}

/** @deprecated ใช้ claimThisTerminal แทน — ไม่สร้างเครื่องจากชื่อพิมพ์เอง */
export async function registerThisTerminal(opts?: {
  name?: string;
  branchId?: string;
  id?: string;
}): Promise<DeviceConfig> {
  const device = await getDeviceConfig();
  const id = opts?.id ?? device.terminalId;
  const branchId = opts?.branchId ?? device.branchId;
  const result = await claimThisTerminal({ id, branchId });
  if (result.ok) return result.device;
  throw new Error(result.message);
}

export type SyncBranch = {
  id: string;
  code: string;
  name: string;
  promptPayId?: string | null;
  promptPayName?: string | null;
};

/** in-memory หลังโหลด/แคชสาขา — ใช้สร้าง QR ตามสาขาปัจจุบัน */
let branchesMemory: SyncBranch[] = [];

export function rememberBranches(list: SyncBranch[]) {
  branchesMemory = Array.isArray(list) ? list.map((b) => ({ ...b })) : [];
}

export function getBranchPromptPayId(branchId: string | null | undefined): string | null {
  if (!branchId) return null;
  const hit = branchesMemory.find((b) => b.id === branchId);
  const d = String(hit?.promptPayId ?? "").replace(/\D/g, "");
  return d || null;
}

export function getBranchPromptPayName(
  branchId: string | null | undefined,
): string | null {
  if (!branchId) return null;
  const hit = branchesMemory.find((b) => b.id === branchId);
  const s = String(hit?.promptPayName ?? "")
    .replace(/\s+/g, " ")
    .trim();
  return s || null;
}

export type SyncStaff = {
  id: string;
  code: string;
  name: string;
  pin: string;
  role?: string;
  commissionEnabled?: boolean;
  commissionStartSales?: number;
  commissionStepSales?: number;
  commissionPerStep?: number;
};

export type SyncTerminal = {
  id: string;
  code: string;
  name: string;
  branchId: string;
  active: boolean;
  paperWidth?: "58mm" | "80mm";
  autoPrint?: boolean;
  printSilent?: boolean;
  printerName?: string | null;
  receiptFooterHours?: string | null;
  receiptFooterPhones?: string | null;
};

const BRANCHES_META = "cached-branches";
const STAFF_META = "cached-staff";
const PROMOS_META = "cached-promos";
const TERMINALS_META = "cached-terminals";

async function loadTerminalsFromCache(branchId?: string): Promise<SyncTerminal[]> {
  if (!window.apPos?.db) return [];
  const raw = await window.apPos.db.getMeta(TERMINALS_META);
  if (!raw) return [];
  try {
    const all = JSON.parse(raw) as SyncTerminal[];
    return branchId
      ? all.filter((t) => t.branchId === branchId && t.active !== false)
      : all.filter((t) => t.active !== false);
  } catch {
    return [];
  }
}

async function loadBranchesFromCache(): Promise<SyncBranch[]> {
  if (!window.apPos?.db) return branchesMemory;
  const raw = await window.apPos.db.getMeta(BRANCHES_META);
  if (!raw) return branchesMemory;
  try {
    const list = JSON.parse(raw) as SyncBranch[];
    if (Array.isArray(list) && list.length) {
      rememberBranches(list);
      return list;
    }
  } catch {
    /* ignore */
  }
  return branchesMemory;
}

async function loadStaffFromCache(): Promise<SyncStaff[]> {
  if (!window.apPos?.db) return [];
  const raw = await window.apPos.db.getMeta(STAFF_META);
  if (!raw) return [];
  try {
    return (JSON.parse(raw) as SyncStaff[]).filter((s) => s.code !== "admin");
  } catch {
    return [];
  }
}

export async function loadTerminals(branchId?: string): Promise<SyncTerminal[]> {
  if (isApiOfflineKnown()) return loadTerminalsFromCache(branchId);
  try {
    const qs = branchId ? `?branchId=${encodeURIComponent(branchId)}` : "";
    const data = await fetchJson<{ terminals: SyncTerminal[] }>(
      `${getApiBase()}/sync/terminals${qs}`,
      2_500,
    );
    markApiOnline();
    const list = (data.terminals ?? []).filter((t) => t.active !== false);
    if (window.apPos?.db) {
      const allRaw = await window.apPos.db.getMeta(TERMINALS_META);
      let all: SyncTerminal[] = [];
      if (allRaw) {
        try {
          all = JSON.parse(allRaw) as SyncTerminal[];
        } catch {
          all = [];
        }
      }
      const byId = new Map(all.map((t) => [t.id, t]));
      if (branchId) {
        for (const [id, t] of byId) {
          if (t.branchId === branchId) byId.delete(id);
        }
        for (const t of list) byId.set(t.id, t);
      } else {
        byId.clear();
        for (const t of list) byId.set(t.id, t);
      }
      await window.apPos.db.setMeta(
        TERMINALS_META,
        JSON.stringify([...byId.values()]),
      );
    }
    return list;
  } catch {
    markApiOffline();
  }
  return loadTerminalsFromCache(branchId);
}

export async function loadBranches(): Promise<SyncBranch[]> {
  if (isApiOfflineKnown()) return loadBranchesFromCache();
  try {
    const data = await fetchJson<{ branches: SyncBranch[] }>(
      `${getApiBase()}/sync/branches`,
      2_500,
    );
    markApiOnline();
    const list = data.branches ?? [];
    if (window.apPos?.db && list.length) {
      await window.apPos.db.setMeta(BRANCHES_META, JSON.stringify(list));
    }
    if (list.length) {
      rememberBranches(list);
      return list;
    }
  } catch {
    markApiOffline();
  }
  return loadBranchesFromCache();
}

export async function loadStaffDirectory(): Promise<SyncStaff[]> {
  if (isApiOfflineKnown()) return loadStaffFromCache();
  try {
    const data = await fetchJson<{ staff: SyncStaff[] }>(
      `${getApiBase()}/sync/staff`,
      2_500,
    );
    markApiOnline();
    const list = (data.staff ?? []).filter((s) => s.code !== "admin");
    if (window.apPos?.db && list.length) {
      await window.apPos.db.setMeta(STAFF_META, JSON.stringify(list));
    }
    if (list.length) return list;
  } catch {
    markApiOffline();
  }
  return loadStaffFromCache();
}

/** ยอดขายรอบปิดแล้วของพนักงานวันนี้ (ไม่รวมรอบปัจจุบัน) */
export async function fetchStaffDayPriorSales(
  staffId: string,
  excludeShiftId?: string,
): Promise<number> {
  if (!staffId) return 0;
  try {
    const qs = new URLSearchParams({ staffId });
    if (excludeShiftId) qs.set("excludeShiftId", excludeShiftId);
    const data = await fetchJson<{ priorGrossTotal?: number }>(
      `${getApiBase()}/sync/staff/day-sales?${qs.toString()}`,
      1_500,
    );
    const n = Number(data.priorGrossTotal);
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

export async function loadCachedProducts(): Promise<QuickProduct[]> {
  if (!window.apPos?.db) return [];
  const rows = await window.apPos.db.listProducts();
  return rows.map(fromLocalProduct);
}

export async function loadCachedMembers(): Promise<Member[]> {
  if (!window.apPos?.db) return [];
  const rows = await window.apPos.db.listMembers();
  return rows.map((m) => ({
    id: m.id,
    code: m.code,
    name: m.name,
    phone: m.phone ?? "",
    points: m.points,
  }));
}

export async function saveCachedMembers(members: Member[]) {
  if (!window.apPos?.db) return;
  await window.apPos.db.upsertMembers(
    members.map((m) => ({
      ...m,
      updatedAt: new Date().toISOString(),
    })),
  );
}

type PendingMemberCreate = {
  localId: string;
  code: string;
  name: string;
  phone: string;
  points: number;
};

const PENDING_MEMBERS_META = "pending-member-creates";

async function loadPendingMemberCreates(): Promise<PendingMemberCreate[]> {
  try {
    const raw = await window.apPos?.db?.getMeta?.(PENDING_MEMBERS_META);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as PendingMemberCreate[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function savePendingMemberCreates(rows: PendingMemberCreate[]) {
  await window.apPos?.db?.setMeta?.(
    PENDING_MEMBERS_META,
    JSON.stringify(rows),
  );
}

/** สร้างสมาชิก — ชื่อ+เบอร์จำเป็น · เบอร์เก็บแบบไม่มีช่องว่าง */
export async function createMember(input: {
  name: string;
  phone?: string;
  points?: number;
}): Promise<Member> {
  const name = String(input.name || "").trim();
  if (!name) throw new Error("กรอกชื่อสมาชิก");
  // ไม่เว้นวรรค / ขีด — เก็บเฉพาะตัวเลข
  const phone = String(input.phone || "").replace(/\D/g, "");
  if (!phone) throw new Error("กรอกเบอร์โทร");
  if (phone.length < 9) throw new Error("เบอร์โทรไม่ครบ");
  const points = Math.max(0, Math.floor(Number(input.points) || 0));

  if (await isApiReachable(1200)) {
    const created = await postJson<{
      id: string;
      code: string;
      name: string;
      phone: string;
      points: number;
      updatedAt: string;
    }>(`${getApiBase()}/members`, { name, phone, points }, 6000);
    const member: Member = {
      id: created.id,
      code: created.code,
      name: created.name,
      phone: String(created.phone ?? "").replace(/\D/g, "") || phone,
      points: created.points,
    };
    if (window.apPos?.db) {
      await window.apPos.db.upsertMembers([
        { ...member, updatedAt: created.updatedAt },
      ]);
    }
    return member;
  }

  const localId = `m-${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}`;
  const code = `L${String(Date.now()).slice(-5)}`;
  const member: Member = { id: localId, code, name, phone, points };
  if (window.apPos?.db) {
    await window.apPos.db.upsertMembers([
      { ...member, updatedAt: new Date().toISOString() },
    ]);
  }
  const pending = await loadPendingMemberCreates();
  pending.push({ localId, code, name, phone, points });
  await savePendingMemberCreates(pending);
  return member;
}

/** ดันสมาชิกที่สร้างตอนออฟไลน์ขึ้นเซิร์ฟเวอร์ */
export async function flushPendingMemberCreates(): Promise<number> {
  if (!window.apPos?.db) return 0;
  if (!(await isApiReachable(1000))) return 0;
  const pending = await loadPendingMemberCreates();
  if (!pending.length) return 0;

  const remain: PendingMemberCreate[] = [];
  let ok = 0;
  for (const row of pending) {
    try {
      const created = await postJson<{
        id: string;
        code: string;
        name: string;
        phone: string;
        points: number;
        updatedAt: string;
      }>(
        `${getApiBase()}/members`,
        { name: row.name, phone: row.phone, points: row.points },
        6000,
      );
      await window.apPos.db.upsertMembers([
        {
          id: created.id,
          code: created.code,
          name: created.name,
          phone: created.phone ?? "",
          points: created.points,
          updatedAt: created.updatedAt,
        },
      ]);
      if (created.id !== row.localId) {
        await window.apPos.db.removeMembers([row.localId]);
      }
      ok += 1;
    } catch {
      remain.push(row);
    }
  }
  await savePendingMemberCreates(remain);
  return ok;
}

export async function enqueueSale(payload: SyncedSalePayload) {
  if (!window.apPos?.db) return;
  await window.apPos.db.saveSale(payload);
}

/** บันทึก local แล้ว push พื้นหลัง — ไม่รอเน็ตตอนจบบิล */
export async function enqueueSaleAndSync(payload: SyncedSalePayload) {
  await enqueueSale(payload);
  void syncPushOutbox().catch(() => {
    // offline / API พัง — ค้างใน outbox แล้วค่อย sync รอบถัดไป
  });
}

export async function enqueueShift(payload: SyncedShiftPayload) {
  if (!window.apPos?.db?.enqueueShift) return;
  await window.apPos.db.enqueueShift(payload);
}

/** เช็คว่า API ถึงได้จริง (ไม่ใช่แค่ Wi‑Fi ติด) */
export async function isApiReachable(timeoutMs = 800): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return false;
  }
  try {
    const ok = await raceTimeout(
      fetchJson(`${getApiBase()}/sync/settings`, timeoutMs).then(() => true),
      timeoutMs + 300,
      false,
    );
    return ok;
  } catch {
    return false;
  }
}

/** วนเช็ค API หลายรอบ — ใช้ตอนปิดรอบ / เปิดแอป */
export async function probeApiOnline(opts?: {
  attempts?: number;
  timeoutMs?: number;
  gapMs?: number;
}): Promise<boolean> {
  const attempts = Math.max(1, opts?.attempts ?? 3);
  const timeoutMs = opts?.timeoutMs ?? 800;
  const gapMs = opts?.gapMs ?? 250;
  for (let i = 0; i < attempts; i++) {
    if (await isApiReachable(timeoutMs)) return true;
    if (i < attempts - 1 && gapMs > 0) {
      await new Promise<void>((r) => setTimeout(r, gapMs));
    }
  }
  return false;
}

export function markApiOnlineCacheCleared() {
  apiOnlineCached = null;
}

export async function loadPosNetworkConfig() {
  if (!window.apPos?.db?.getMeta) return;
  try {
    const api = await window.apPos.db.getMeta(API_BASE_META);
    const admin = await window.apPos.db.getMeta(ADMIN_URL_META);
    if (api?.trim()) runtimeApiBase = api.trim().replace(/\/$/, "");
    if (admin?.trim()) runtimeAdminUrl = admin.trim().replace(/\/$/, "");
  } catch {
    /* ignore */
  }
  void window.apPos?.media?.setApiBase?.(getApiBase());
}

export async function savePosNetworkConfig(opts: {
  apiBase: string;
  adminUrl?: string;
}) {
  const api = opts.apiBase.trim().replace(/\/$/, "");
  const admin = (opts.adminUrl ?? "").trim().replace(/\/$/, "");
  if (!/^https?:\/\//i.test(api)) {
    throw new Error("URL API ต้องขึ้นต้นด้วย http:// หรือ https://");
  }
  if (admin && !/^https?:\/\//i.test(admin)) {
    throw new Error("URL Admin ต้องขึ้นต้นด้วย http:// หรือ https://");
  }
  runtimeApiBase = api;
  runtimeAdminUrl = admin;
  if (window.apPos?.db?.setMeta) {
    await window.apPos.db.setMeta(API_BASE_META, api);
    await window.apPos.db.setMeta(ADMIN_URL_META, admin);
  }
  void window.apPos?.media?.setApiBase?.(api);
  apiOnlineCached = null;
}

/**
 * สถานะ API ล่าสุด — null = ยังไม่เช็ค
 * เปิดแอปเช็คครั้งแรกก่อนโชว์ UI เพื่อกันกระตุกตอนออฟไลน์
 */
let apiOnlineCached: boolean | null = null;

export function getApiOnline(): boolean | null {
  return apiOnlineCached;
}

export function isApiOnlineKnown(): boolean {
  return apiOnlineCached === true;
}

export function isApiOfflineKnown(): boolean {
  return apiOnlineCached === false;
}

export async function refreshApiOnline(opts?: {
  attempts?: number;
  timeoutMs?: number;
  gapMs?: number;
}): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    apiOnlineCached = false;
    return false;
  }
  const online = await probeApiOnline({
    attempts: opts?.attempts ?? 2,
    timeoutMs: opts?.timeoutMs ?? 700,
    gapMs: opts?.gapMs ?? 200,
  });
  apiOnlineCached = online;
  return online;
}

function markApiOnline() {
  apiOnlineCached = true;
}

function markApiOffline() {
  apiOnlineCached = false;
}

/** ดัน outbox จนว่างหรือครบรอบ — ใช้ตอนปิดรอบเมื่อออนไลน์ */
export async function flushOutbox(opts?: {
  timeoutMs?: number;
  maxRounds?: number;
}): Promise<{ ok: boolean; pending: number }> {
  const timeoutMs = opts?.timeoutMs ?? 12_000;
  const maxRounds = opts?.maxRounds ?? 3;
  for (let i = 0; i < maxRounds; i++) {
    await syncPushOutbox({ timeoutMs });
    const pending = await pendingOutboxCount();
    if (pending === 0) return { ok: true, pending: 0 };
  }
  return { ok: false, pending: await pendingOutboxCount() };
}

/**
 * ปิดรอบ / บันทึก shift:
 * 1) บันทึก SQLite เสมอ
 * 2) วนเช็ค API 3 รอบ
 * 3) API ไม่ติด → จบ (ค้าง outbox ปิดระบบได้)
 * 4) API ติด → ส่ง outbox ให้เสร็จก่อนค่อยจบ
 */
export async function enqueueShiftAndSync(
  payload: SyncedShiftPayload,
  opts?: {
    /** ปิดรอบ: เช็ค API แล้วค่อยตัดสินใจรอส่ง */
    awaitIfOnline?: boolean;
    /** จำนวนรอบเช็ค API (ค่าเริ่มต้น 3) */
    probeAttempts?: number;
    probeTimeoutMs?: number;
    pushTimeoutMs?: number;
    /** เวลารอส่งสูงสุดเมื่อ API ใช้ได้ (ms) */
    onlineDeadlineMs?: number;
  },
) {
  // 1) บันทึกในเครื่องก่อนเสมอ
  await enqueueShift(payload);

  if (!opts?.awaitIfOnline) {
    void syncPushOutbox().catch(() => undefined);
    return;
  }

  // 2) วนเช็ค API ~3 รอบ
  const online = await probeApiOnline({
    attempts: opts.probeAttempts ?? 3,
    timeoutMs: opts.probeTimeoutMs ?? 800,
    gapMs: 250,
  });

  // 3) API ไม่ทำงาน = ออฟไลน์ → ข้อมูลอยู่ใน SQLite แล้ว พร้อมปิดระบบ
  if (!online) return;

  // 4) API ใช้ได้ → ส่งให้เสร็จก่อนปิด
  const timeoutMs = opts.pushTimeoutMs ?? 12_000;
  const deadlineMs = opts.onlineDeadlineMs ?? 45_000;
  await raceTimeout(
    (async () => {
      const deadline = Date.now() + deadlineMs;
      while (Date.now() < deadline) {
        const result = await flushOutbox({ timeoutMs, maxRounds: 1 });
        if (result.ok) return;
        // ระหว่างส่ง API ดับ → เลิกรอ ค้าง SQLite ปิดได้
        if (!(await isApiReachable(700))) return;
      }
    })(),
    deadlineMs + 1_500,
    undefined,
  );
}

export async function enqueueAudit(payload: SyncedAuditPayload) {
  if (!window.apPos?.db?.saveAudit) return;
  await window.apPos.db.saveAudit(payload);
}

export async function enqueueAuditAndSync(payload: SyncedAuditPayload) {
  await enqueueAudit(payload);
  void syncPushOutbox().catch(() => undefined);
}

export async function loadLocalAudits(
  shiftId: string,
): Promise<SyncedAuditPayload[]> {
  if (!window.apPos?.db?.listAuditsByShift) return [];
  const rows = await window.apPos.db.listAuditsByShift(shiftId);
  return rows as SyncedAuditPayload[];
}

export async function syncPullMasterData() {
  if (isApiOfflineKnown()) {
    throw new Error("API offline");
  }
  const since = (await window.apPos?.db?.getMeta("sync-cursor")) ?? "";
  const url = since
    ? `${getApiBase()}/sync/changes?since=${encodeURIComponent(since)}`
    : `${getApiBase()}/sync/bootstrap`;
  // bootstrap ครั้งแรกอาจใหญ่ — เปิดรอบรออัปเดตก่อนขาย
  let data: BootstrapResponse;
  try {
    data = await fetchJson<BootstrapResponse>(url, since ? 15_000 : 60_000);
    markApiOnline();
  } catch (e) {
    markApiOffline();
    throw e;
  }

  if (window.apPos?.db) {
    if (data.products.length || data.removedProductIds.length || !since) {
      const mapped = data.products.map((api) => {
        const local = toLocalProduct(
          mapApiProducts([api])[0]!,
          api.updatedAt ?? new Date().toISOString(),
        );
        // เก็บ URL ต้นทางจาก API — resolve เป็น cache ตอนอ่าน
        return { ...local, imageUrl: api.imageUrl };
      });
      if (!since) {
        // bootstrap: แทนที่ด้วยชุดจากส่วนกลาง
        const current = await window.apPos.db.listProducts();
        if (current.length) {
          await window.apPos.db.removeProducts(current.map((x) => x.id));
        }
      }
      if (mapped.length) await window.apPos.db.upsertProducts(mapped);
      if (data.removedProductIds?.length) {
        await window.apPos.db.removeProducts(data.removedProductIds);
      }
    }

    if (data.members.length || data.removedMemberIds.length || !since) {
      if (!since) {
        const current = await window.apPos.db.listMembers();
        if (current.length) {
          await window.apPos.db.removeMembers(current.map((x) => x.id));
        }
      }
      if (data.members.length) {
        await window.apPos.db.upsertMembers(
          data.members.map((m) => ({
            ...m,
            updatedAt: (m as Member & { updatedAt?: string }).updatedAt ??
              new Date().toISOString(),
          })),
        );
      }
      if (data.removedMemberIds?.length) {
        await window.apPos.db.removeMembers(data.removedMemberIds);
      }
    }

    // promos + settings (cache in meta)
    if (data.promos || data.removedPromoIds?.length || !since) {
      let cached: BootstrapResponse["promos"] = [];
      if (since) {
        const raw = await window.apPos.db.getMeta(PROMOS_META);
        if (raw) {
          try {
            cached = JSON.parse(raw) as BootstrapResponse["promos"];
          } catch {
            cached = [];
          }
        }
      }
      const map = new Map((cached ?? []).map((p) => [p.id, p]));
      for (const p of data.promos ?? []) map.set(p.id, p);
      for (const id of data.removedPromoIds ?? []) map.delete(id);
      if (!since && data.promos) {
        // bootstrap replaces
        await window.apPos.db.setMeta(
          PROMOS_META,
          JSON.stringify(data.promos),
        );
      } else {
        await window.apPos.db.setMeta(
          PROMOS_META,
          JSON.stringify([...map.values()]),
        );
      }
    }

    if (data.settings) {
      await window.apPos.db.setMeta(
        "cached-settings",
        JSON.stringify(data.settings),
      );
    }

    if (data.cursor) await window.apPos.db.setMeta("sync-cursor", data.cursor);
  }

  // สื่อ: ดาวน์โหลดเฉพาะ URL ใหม่/ที่ขาด — ไม่ดึงซ้ำทุกรอบ sync
  if (data.settings) {
    void ensureSettingsMediaCached(data.settings);
  }
  if (data.products.length) {
    void ensureProductImagesFromPull(data.products);
  }

  return data;
}

export async function loadCachedPromos(): Promise<
  NonNullable<BootstrapResponse["promos"]>
> {
  if (window.apPos?.db) {
    const raw = await window.apPos.db.getMeta(PROMOS_META);
    if (raw) {
      try {
        return JSON.parse(raw) as NonNullable<BootstrapResponse["promos"]>;
      } catch {
        // ignore
      }
    }
  }
  return [];
}

export async function loadCachedSettings(): Promise<
  BootstrapResponse["settings"] | null
> {
  if (window.apPos?.db) {
    const raw = await window.apPos.db.getMeta("cached-settings");
    if (raw) {
      try {
        return JSON.parse(raw) as BootstrapResponse["settings"];
      } catch {
        // ignore
      }
    }
  }
  return null;
}

/** ดึง settings จาก API โดยตรง — ใช้บนจอ 2 ถ้า cache/IPC ว่าง */
export async function fetchSettingsFromApi(): Promise<
  BootstrapResponse["settings"] | null
> {
  try {
    return await fetchJson<BootstrapResponse["settings"]>(
      `${getApiBase()}/sync/settings`,
    );
  } catch {
    return null;
  }
}

export async function syncPushOutbox(opts?: { timeoutMs?: number }) {
  if (!window.apPos?.db) return { accepted: 0 };
  if (isApiOfflineKnown()) return { accepted: 0 };

  try {
    await flushPendingMemberCreates();
  } catch {
    /* keep pending */
  }

  const outbox = (await window.apPos.db.listOutbox()) as SyncEnvelope[];
  if (!outbox.length) return { accepted: 0 };

  const timeoutMs = opts?.timeoutMs ?? 8_000;
  const sales = outbox.filter((e) => e.type === "sale");
  const shifts = outbox.filter((e) => e.type === "shift");
  const audits = outbox.filter((e) => e.type === "audit");
  const acceptedIds: string[] = [];

  if (sales.length) {
    try {
      const data = await postJson<{ accepted: number; acceptedIds: string[] }>(
        `${getApiBase()}/sync/sales`,
        { sales },
        timeoutMs,
      );
      acceptedIds.push(...(data.acceptedIds ?? []));
    } catch {
      // keep sales in outbox
    }
  }

  if (audits.length) {
    try {
      const data = await postJson<{ accepted: string[] }>(
        `${getApiBase()}/sync/audits`,
        { audits: audits.map((e) => e.payload) },
        timeoutMs,
      );
      const ids = data.accepted ?? [];
      for (const auditId of ids) {
        const env = audits.find((e) => e.payload.id === auditId);
        if (env) acceptedIds.push(env.id);
      }
    } catch {
      // keep audits in outbox
    }
  }

  if (shifts.length) {
    try {
      const data = await postJson<{ accepted: string[] }>(
        `${getApiBase()}/sync/shifts`,
        { shifts: shifts.map((e) => e.payload) },
        timeoutMs,
      );
      const ids = data.accepted ?? [];
      for (const shiftId of ids) {
        const env = shifts.find((e) => e.payload.id === shiftId);
        if (env) acceptedIds.push(env.id);
      }
    } catch {
      // keep shifts in outbox
    }
  }

  if (acceptedIds.length) {
    await window.apPos.db.ackOutbox(acceptedIds);
  }
  return { accepted: acceptedIds.length, acceptedIds };
}

export async function pendingOutboxCount() {
  if (!window.apPos?.db) return 0;
  return window.apPos.db.outboxCount();
}
