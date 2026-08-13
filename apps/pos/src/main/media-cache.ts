import { app, net, protocol } from "electron";
import { createHash } from "node:crypto";
import {
  createWriteStream,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, extname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";

let runtimeApiBase = (
  process.env.VITE_API_BASE ?? "http://localhost:3000"
).replace(/\/$/, "");

/** renderer ตั้ง URL API จริง — อย่าใช้ localhost ที่ bake ตอน build */
export function setApiBase(url: string) {
  const t = String(url ?? "").trim().replace(/\/$/, "");
  if (/^https?:\/\//i.test(t)) runtimeApiBase = t;
}
const SCHEME = "appos-media";
const INDEX_FILE = "index.json";

type IndexMap = Record<string, string>; // absolute remote url → filename in cache dir

let cacheDir = "";
let index: IndexMap = {};
let ready = false;

function ensureDir(dir: string) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function loadIndex() {
  const path = join(cacheDir, INDEX_FILE);
  if (!existsSync(path)) {
    index = {};
    return;
  }
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as IndexMap;
    index = {};
    for (const [k, file] of Object.entries(raw)) {
      const abs = toAbsoluteMediaUrl(k) ?? k;
      index[abs] = file;
    }
  } catch {
    index = {};
  }
}

function saveIndex() {
  ensureDir(cacheDir);
  writeFileSync(join(cacheDir, INDEX_FILE), JSON.stringify(index), "utf8");
}

/** ทำให้ URL เป็น absolute เพื่อใช้เป็นคีย์ cache (normalize localhost ↔ 127.0.0.1) */
export function toAbsoluteMediaUrl(url: string): string | null {
  const t = url.trim();
  if (!t) return null;
  if (t.startsWith("data:") || t.startsWith(`${SCHEME}:`)) return null;
  if (t.startsWith("file:")) return null;
  let abs: string;
  if (t.startsWith("http://") || t.startsWith("https://")) {
    abs = t;
  } else {
    const path = t.startsWith("/") ? t : `/${t}`;
    abs = `${runtimeApiBase}${path}`;
  }
  try {
    const u = new URL(abs);
    if (u.hostname === "127.0.0.1") u.hostname = "localhost";
    return u.href;
  } catch {
    return abs;
  }
}

function fileNameFor(absUrl: string): string {
  const u = new URL(absUrl);
  const ext = extname(u.pathname) || ".bin";
  const hash = createHash("sha1").update(absUrl).digest("hex").slice(0, 20);
  const safeExt = ext.length <= 8 ? ext.toLowerCase() : ".bin";
  return `${hash}${safeExt}`;
}

function localProtocolUrl(fileName: string): string {
  return `${SCHEME}://local/${fileName}`;
}

export function registerMediaScheme() {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        bypassCSP: true,
        corsEnabled: true,
      },
    },
  ]);
}

export function initMediaCache() {
  cacheDir = join(app.getPath("userData"), "media-cache");
  ensureDir(cacheDir);
  loadIndex();
  importBundledMediaSeed();
  protocol.handle(SCHEME, (request) => {
    try {
      const u = new URL(request.url);
      const fileName = decodeURIComponent(u.pathname.replace(/^\/+/, ""));
      if (!fileName || fileName.includes("..") || fileName.includes("/")) {
        return new Response("bad path", { status: 400 });
      }
      const full = join(cacheDir, fileName);
      if (!existsSync(full)) {
        return new Response("not found", { status: 404 });
      }
      return net.fetch(pathToFileURL(full).href);
    } catch (err) {
      console.warn("[media-cache] serve failed", err);
      return new Response("error", { status: 500 });
    }
  });
  ready = true;
  console.log("[ap-pos] media cache:", cacheDir);
}

/** คัดลอกรูปจาก Setup (resources/seed/media) → media-cache ของเครื่องนี้ */
function importBundledMediaSeed() {
  const seedRoots = [
    join(process.resourcesPath, "seed"),
    join(__dirname, "../../resources/seed"),
    join(app.getAppPath(), "resources/seed"),
  ];
  const seedRoot = seedRoots.find(
    (p) => existsSync(join(p, "media-index.json")) || existsSync(join(p, "media")),
  );
  if (!seedRoot) return;

  const indexPath = join(seedRoot, "media-index.json");
  const mediaPath = join(seedRoot, "media");
  if (!existsSync(indexPath) || !existsSync(mediaPath)) return;

  let seeded: IndexMap = {};
  try {
    seeded = JSON.parse(readFileSync(indexPath, "utf8")) as IndexMap;
  } catch {
    return;
  }

  let copied = 0;
  for (const [rawUrl, fileName] of Object.entries(seeded)) {
    if (!fileName || fileName.includes("..") || fileName.includes("/") || fileName.includes("\\")) {
      continue;
    }
    const abs = toAbsoluteMediaUrl(rawUrl) ?? rawUrl;
    const src = join(mediaPath, fileName);
    const dest = join(cacheDir, fileName);
    if (!existsSync(src)) continue;
    try {
      if (!existsSync(dest)) {
        copyFileSync(src, dest);
        copied += 1;
      }
      if (!index[abs]) {
        index[abs] = fileName;
      }
    } catch (err) {
      console.warn("[media-cache] seed copy failed", fileName, err);
    }
  }
  if (copied > 0 || Object.keys(seeded).length) {
    saveIndex();
    console.info(
      `[media-cache] นำเข้ารูปจาก Setup · ใหม่ ${copied} · index ${Object.keys(seeded).length}`,
    );
  }
}

/** map absolute remote → appos-media URL */
export function getMediaIndex(): IndexMap {
  const out: IndexMap = {};
  for (const [abs, file] of Object.entries(index)) {
    if (existsSync(join(cacheDir, file))) out[abs] = localProtocolUrl(file);
  }
  return out;
}

/** คืน local protocol URL ถ้ามีใน cache */
export function resolveCached(url: string | null | undefined): string | null {
  if (!url || !ready) return null;
  if (url.startsWith(`${SCHEME}:`)) return url;
  const abs = toAbsoluteMediaUrl(url);
  if (!abs) return null;
  const file = index[abs];
  if (!file) return null;
  const full = join(cacheDir, file);
  if (!existsSync(full)) {
    delete index[abs];
    saveIndex();
    return null;
  }
  return localProtocolUrl(file);
}

async function downloadOne(absUrl: string): Promise<string | null> {
  const existing = index[absUrl];
  if (existing && existsSync(join(cacheDir, existing))) {
    return localProtocolUrl(existing);
  }

  const fileName = fileNameFor(absUrl);
  const dest = join(cacheDir, fileName);
  const tmp = `${dest}.part`;
  ensureDir(dirname(dest));

  try {
    const res = await fetch(absUrl, {
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok || !res.body) {
      console.warn("[media-cache] HTTP", res.status, absUrl);
      return null;
    }
    const nodeStream = Readable.fromWeb(
      res.body as import("node:stream/web").ReadableStream,
    );
    await pipeline(nodeStream, createWriteStream(tmp));
    renameSync(tmp, dest);
    index[absUrl] = fileName;
    saveIndex();
    return localProtocolUrl(fileName);
  } catch (err) {
    console.warn("[media-cache] download failed", absUrl, err);
    try {
      if (existsSync(tmp)) unlinkSync(tmp);
    } catch {
      /* ignore */
    }
    return null;
  }
}

/**
 * ดาวน์โหลดหลาย URL ลง cache (จำกัด concurrency)
 * คืน map absoluteUrl → appos-media://...
 */
export async function cacheUrls(
  urls: string[],
  concurrency = 6,
): Promise<Record<string, string>> {
  if (!ready) return {};
  const unique = new Set<string>();
  for (const u of urls) {
    const abs = toAbsoluteMediaUrl(u);
    if (abs) unique.add(abs);
  }
  const list = [...unique];
  const out: Record<string, string> = {};
  let i = 0;

  async function worker() {
    while (i < list.length) {
      const idx = i++;
      const abs = list[idx]!;
      const local = await downloadOne(abs);
      if (local) out[abs] = local;
    }
  }

  const n = Math.min(concurrency, Math.max(1, list.length));
  await Promise.all(Array.from({ length: n }, () => worker()));
  return out;
}
