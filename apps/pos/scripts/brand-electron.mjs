/**
 * โหมด `electron-vite dev` รัน Electron.app จริง — Dock/เมนูจึงขึ้นชื่อ "Electron"
 * สคริปต์นี้:
 *  1) แพตช์ Info.plist + ไอคอน
 *  2) เปลี่ยนชื่อ bundle เป็น "AP POS.app" (macOS อ่านชื่อจากชื่อโฟลเดอร์ตอน hover Dock)
 *  3) อัปเดต path.txt ให้ชี้ไปที่แอปที่เปลี่ยนชื่อแล้ว
 */
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const APP_NAME = "AP POS";
const BUNDLE_ID = "th.ap.pos";
const BUNDLE_DIR = `${APP_NAME}.app`;

const __dirname = dirname(fileURLToPath(import.meta.url));
const posRoot = join(__dirname, "..");
const repoRoot = join(posRoot, "../..");
const require = createRequire(import.meta.url);

function setPlist(plist, key, value) {
  const quoted = String(value).replace(/"/g, '\\"');
  try {
    execFileSync("/usr/libexec/PlistBuddy", [
      "-c",
      `Set :${key} ${quoted}`,
      plist,
    ]);
  } catch {
    try {
      execFileSync("/usr/libexec/PlistBuddy", [
        "-c",
        `Add :${key} string ${quoted}`,
        plist,
      ]);
    } catch (err) {
      console.warn(`[brand-electron] failed to set ${key}:`, err);
    }
  }
}

function brandApp(appRoot) {
  const plist = join(appRoot, "Contents", "Info.plist");
  if (!existsSync(plist)) return false;

  setPlist(plist, "CFBundleName", APP_NAME);
  setPlist(plist, "CFBundleDisplayName", APP_NAME);
  setPlist(plist, "CFBundleIdentifier", BUNDLE_ID);

  // macOS อ่านชื่อจาก localization ด้วย
  for (const lang of ["en", "th", "Base", "English"]) {
    const dir = join(appRoot, "Contents", "Resources", `${lang}.lproj`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "InfoPlist.strings"),
      `CFBundleName = "${APP_NAME}";\nCFBundleDisplayName = "${APP_NAME}";\n`,
      "utf8",
    );
  }

  const destIcns = join(appRoot, "Contents", "Resources", "electron.icns");
  const srcIcns = join(posRoot, "resources", "icon.icns");
  if (existsSync(srcIcns)) {
    copyFileSync(srcIcns, destIcns);
  }
  return true;
}

/** เปลี่ยน Electron.app → AP POS.app แล้วอัปเดต path.txt */
function renameBundle(electronPkgRoot) {
  const dist = join(electronPkgRoot, "dist");
  const src = join(dist, "Electron.app");
  const dest = join(dist, BUNDLE_DIR);
  const pathTxt = join(electronPkgRoot, "path.txt");

  if (existsSync(src) && !existsSync(dest)) {
    renameSync(src, dest);
    console.log(`[brand-electron] renamed → ${BUNDLE_DIR}`);
  }

  const appRoot = existsSync(dest) ? dest : existsSync(src) ? src : null;
  if (!appRoot) return null;

  // path.txt ชี้ binary ใน bundle ที่ใช้จริง
  const binaryRel = `${existsSync(dest) ? BUNDLE_DIR : "Electron.app"}/Contents/MacOS/Electron`;
  try {
    const cur = existsSync(pathTxt) ? readFileSync(pathTxt, "utf8").trim() : "";
    if (cur !== binaryRel) {
      writeFileSync(pathTxt, `${binaryRel}\n`, "utf8");
      console.log(`[brand-electron] path.txt → ${binaryRel}`);
    }
  } catch (err) {
    console.warn("[brand-electron] path.txt update failed:", err);
  }

  return appRoot;
}

function findElectronPackageRoots() {
  const found = new Set();
  try {
    found.add(dirname(require.resolve("electron/package.json")));
  } catch {
    /* ignore */
  }

  const pnpmDir = join(repoRoot, "node_modules", ".pnpm");
  if (existsSync(pnpmDir)) {
    for (const entry of readdirSync(pnpmDir)) {
      if (!entry.startsWith("electron@")) continue;
      const pkg = join(pnpmDir, entry, "node_modules", "electron");
      if (existsSync(join(pkg, "package.json"))) found.add(pkg);
    }
  }
  return [...found];
}

function main() {
  if (process.platform !== "darwin") {
    console.log(`[brand-electron] skip rename (platform=${process.platform}) — productName=AP POS ใน dist`);
    return;
  }

  const roots = findElectronPackageRoots();
  if (!roots.length) {
    console.warn("[brand-electron] electron package not found — skip");
    return;
  }

  let n = 0;
  for (const root of roots) {
    const appRoot = renameBundle(root);
    if (appRoot && brandApp(appRoot)) {
      n += 1;
      console.log(`[brand-electron] patched ${appRoot}`);
    }
  }
  console.log(`[brand-electron] ${APP_NAME} (${BUNDLE_ID}) · ${n} app(s)`);
}

main();
