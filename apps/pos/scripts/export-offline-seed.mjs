#!/usr/bin/env node
/**
 * ดึงข้อมูลจาก API → resources/seed/offline-snapshot.json + media/
 * ใช้ก่อนสร้าง Setup เพื่อให้เครื่องขายออฟไลน์ได้ทันทีหลังติดตั้ง (รวมรูป)
 *
 *   API_BASE=http://localhost:3000 pnpm --filter @ap-pos/pos seed:export
 */
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, extname, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const seedDir = join(root, "resources/seed");
const outPath = join(seedDir, "offline-snapshot.json");
const mediaDir = join(seedDir, "media");
const mediaIndexPath = join(seedDir, "media-index.json");
const API_BASE = (
  process.env.API_BASE ||
  process.env.VITE_API_BASE ||
  "http://localhost:3000"
).replace(/\/$/, "");

async function getJson(path) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`${path} → HTTP ${res.status}`);
  }
  return res.json();
}

function mapProduct(p) {
  return {
    id: p.id,
    barcode: p.barcode ?? "",
    productCode: p.productCode ?? null,
    name: p.name ?? "",
    unit: p.unit ?? "ชิ้น",
    costPrice: p.costPrice ?? null,
    price: p.price ?? null,
    isQuick: Boolean(p.isQuick),
    quickSort: Number(p.quickSort) || 0,
    imageUrl: p.imageUrl ?? null,
    isOpenPrice: Boolean(p.isOpenPrice),
    openPriceMax: Number(p.openPriceMax) || 100,
    updatedAt: p.updatedAt ?? new Date().toISOString(),
  };
}

function mapMember(m) {
  return {
    id: m.id,
    code: m.code ?? "",
    name: m.name ?? "",
    phone: m.phone ?? null,
    points: Math.max(0, Math.floor(Number(m.points) || 0)),
    updatedAt: m.updatedAt ?? new Date().toISOString(),
  };
}

function toAbsoluteMediaUrl(url) {
  const t = String(url || "").trim();
  if (!t) return null;
  if (t.startsWith("data:") || t.startsWith("appos-media:") || t.startsWith("file:")) {
    return null;
  }
  let abs;
  if (t.startsWith("http://") || t.startsWith("https://")) {
    abs = t;
  } else {
    const path = t.startsWith("/") ? t : `/${t}`;
    abs = `${API_BASE}${path}`;
  }
  try {
    const u = new URL(abs);
    if (u.hostname === "127.0.0.1") u.hostname = "localhost";
    return u.href;
  } catch {
    return abs;
  }
}

function fileNameFor(absUrl) {
  const u = new URL(absUrl);
  const ext = extname(u.pathname) || ".bin";
  const hash = createHash("sha1").update(absUrl).digest("hex").slice(0, 20);
  const safeExt = ext.length <= 8 ? ext.toLowerCase() : ".bin";
  return `${hash}${safeExt}`;
}

function collectMediaUrls(snapshot) {
  const urls = new Set();
  for (const p of snapshot.products ?? []) {
    const abs = toAbsoluteMediaUrl(p.imageUrl);
    if (abs) urls.add(abs);
  }
  const branding = snapshot.settings?.branding ?? {};
  for (const key of ["logoUrl"]) {
    const abs = toAbsoluteMediaUrl(branding[key]);
    if (abs) urls.add(abs);
  }
  const display = snapshot.settings?.display ?? {};
  for (const key of ["bannerUrl", "panelUrl"]) {
    const abs = toAbsoluteMediaUrl(display[key]);
    if (abs) urls.add(abs);
  }
  for (const item of snapshot.settings?.customerAds?.items ?? []) {
    const abs = toAbsoluteMediaUrl(item?.url);
    if (abs) urls.add(abs);
  }
  return [...urls];
}

async function downloadOne(absUrl, dest) {
  const tmp = `${dest}.part`;
  const res = await fetch(absUrl, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok || !res.body) {
    throw new Error(`HTTP ${res.status}`);
  }
  const nodeStream = Readable.fromWeb(res.body);
  await pipeline(nodeStream, createWriteStream(tmp));
  renameSync(tmp, dest);
}

async function downloadMedia(urls) {
  if (existsSync(mediaDir)) {
    rmSync(mediaDir, { recursive: true, force: true });
  }
  mkdirSync(mediaDir, { recursive: true });

  const index = {};
  let ok = 0;
  let fail = 0;
  const concurrency = 6;
  let i = 0;

  async function worker() {
    while (i < urls.length) {
      const idx = i++;
      const abs = urls[idx];
      const fileName = fileNameFor(abs);
      const dest = join(mediaDir, fileName);
      try {
        await downloadOne(abs, dest);
        index[abs] = fileName;
        ok += 1;
        if (ok % 10 === 0 || ok === urls.length) {
          process.stdout.write(`\r[seed:export] รูป ${ok}/${urls.length}`);
        }
      } catch (e) {
        fail += 1;
        console.warn(`\n[seed:export] ดาวน์โหลดรูปไม่สำเร็จ ${abs}: ${e.message || e}`);
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, Math.max(1, urls.length)) }, () =>
      worker(),
    ),
  );
  if (urls.length) process.stdout.write("\n");
  writeFileSync(mediaIndexPath, `${JSON.stringify(index, null, 2)}\n`, "utf8");
  return { ok, fail, total: urls.length };
}

async function main() {
  console.log(`[seed:export] API ${API_BASE}`);
  const [boot, branches, staff, terminals] = await Promise.all([
    getJson("/sync/bootstrap"),
    getJson("/sync/branches").catch(() => ({ branches: [] })),
    getJson("/sync/staff").catch(() => ({ staff: [] })),
    getJson("/sync/terminals").catch(() => ({ terminals: [] })),
  ]);

  const products = (boot.products ?? []).map(mapProduct);
  const members = (boot.members ?? []).map(mapMember);
  const staffList = (staff.staff ?? []).filter((s) => s.code !== "admin");

  const snapshot = {
    version: boot.cursor || new Date().toISOString(),
    exportedAt: new Date().toISOString(),
    apiBase: API_BASE,
    products,
    members,
    promos: boot.promos ?? [],
    settings: boot.settings ?? {},
    staff: staffList,
    branches: branches.branches ?? [],
    terminals: (terminals.terminals ?? []).filter((t) => t.active !== false),
    printer: {
      paperWidth: "80mm",
      autoPrint: true,
      silent: true,
      footerHours: "เปิดบริการทุกวัน 09.00 - 20.00 น.",
      footerPhones: "ติดต่อ 084 912 3509, 092 494 5442",
    },
  };

  mkdirSync(seedDir, { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");

  const mediaUrls = collectMediaUrls(snapshot);
  console.log(`[seed:export] กำลังดาวน์โหลดรูป ${mediaUrls.length} ไฟล์...`);
  const media = await downloadMedia(mediaUrls);
  const mediaFiles = existsSync(mediaDir)
    ? readdirSync(mediaDir).filter((f) => !f.endsWith(".part")).length
    : 0;

  console.log(
    `[seed:export] เขียน ${outPath}\n  สินค้า ${products.length} · สมาชิก ${members.length} · พนักงาน ${staffList.length} · สาขา ${(snapshot.branches || []).length} · เครื่อง ${(snapshot.terminals || []).length}\n  รูปสำเร็จ ${media.ok}/${media.total} (ล้มเหลว ${media.fail}) · ไฟล์ใน media/ ${mediaFiles}`,
  );
  if (!products.length) {
    console.warn(
      "[seed:export] คำเตือน: ไม่มีสินค้า — Setup จะออฟไลน์ขายไม่ได้จนกว่าจะ sync",
    );
  }
}

main().catch((e) => {
  console.error(
    "[seed:export] ล้มเหลว — เปิด API ก่อน หรือตั้ง API_BASE",
    e.message || e,
  );
  process.exit(1);
});
