import { app, BrowserWindow } from "electron";
import { mkdirSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { sendTextToWindowsPrinter } from "./windows-gdi-print";
import { kickCashDrawerBestEffort } from "./windows-raw-print";

export type PrintReceiptRequest = {
  html: string;
  /** สลิปข้อความสำหรับ ESC/POS (แนะนำ) */
  text?: string;
  paperWidth: "58mm" | "80mm";
  silent?: boolean;
  /** ชื่อเครื่องพิมพ์จาก Admin (ต้องตรงกับ OS) — ว่าง = default */
  deviceName?: string;
  /** ชื่อหน้าต่างตัวอย่าง (ใบเสร็จ / ใบปิดรอบ) */
  title?: string;
  /** คงไว้เพื่อเข้ากันกับ IPC เก่า — ไม่ใช้แล้ว */
  method?: string;
  encoding?: string;
  openDrawer?: boolean;
};

let previewWin: BrowserWindow | null = null;

function paperPx(paperWidth: "58mm" | "80mm") {
  return paperWidth === "58mm" ? 280 : 360;
}

function isWin() {
  return process.platform === "win32";
}

function normalizePrinterKey(name: string) {
  return name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/^\\\\[^\\]+\\/, ""); // \\PC\Printer → Printer
}

/** PDF / Fax / OneNote — ไม่ใช่เครื่องสลิป */
function isVirtualPrinter(name: string) {
  const n = normalizePrinterKey(name);
  return /pdf|onenote|fax|xps document|microsoft print to|send to|adobe pdf|cutepdf|nova pdf|fax/.test(
    n,
  );
}

/** คะแนนจับ thermal สลิป — XP-58C ได้สูงสุด */
function thermalScore(name: string) {
  const n = normalizePrinterKey(name);
  if (isVirtualPrinter(name)) return -1000;
  let s = 0;
  if (/xp-?58|58\s*c|58mm/.test(n)) s += 100;
  if (/xp-?80|80\s*c|80mm/.test(n)) s += 40;
  if (/xprinter|xpos|thermal|receipt|pos printer|pos-/.test(n)) s += 30;
  return s;
}

type OsPrinter = { name: string; isDefault?: boolean };

function pickBestPrinter(printers: OsPrinter[]): OsPrinter | undefined {
  if (!printers.length) return undefined;
  const real = printers.filter((p) => p.name && !isVirtualPrinter(p.name));
  const pool = real.length ? real : printers;
  const ranked = [...pool].sort((a, b) => {
    const ds = thermalScore(b.name) - thermalScore(a.name);
    if (ds !== 0) return ds;
    if (Boolean(b.isDefault) !== Boolean(a.isDefault)) {
      return b.isDefault ? 1 : -1;
    }
    return a.name.localeCompare(b.name);
  });
  return ranked[0];
}

async function listPrinters(contents: Electron.WebContents) {
  try {
    return (await contents.getPrintersAsync()) ?? [];
  } catch {
    return [];
  }
}

/**
 * จับคู่ชื่อเครื่องพิมพ์แบบยืดหยุ่น (Windows ชื่อมักไม่ตรงเป๊ะกับที่พิมพ์ใน Admin)
 * ว่าง / ไม่เจอ → ชอบ XP-58 / Xprinter มากกว่า default ที่เป็น PDF
 */
async function resolvePrinterName(
  contents: Electron.WebContents,
  preferred?: string,
): Promise<{
  name?: string;
  available: string[];
  matchedPreferred: boolean;
  warning?: string;
}> {
  const printers = await listPrinters(contents);
  const available = printers.map((p) => p.name).filter(Boolean);
  if (!available.length) return { available: [], matchedPreferred: false };

  const want = preferred?.trim();
  if (want) {
    const wantKey = normalizePrinterKey(want);
    const exact = printers.find((p) => p.name === want);
    if (exact?.name) {
      return { name: exact.name, available, matchedPreferred: true };
    }
    const ci = printers.find(
      (p) => normalizePrinterKey(p.name) === wantKey,
    );
    if (ci?.name) {
      return { name: ci.name, available, matchedPreferred: true };
    }
    // รวม / ขึ้นต้น / ลงท้าย — เช่น "XP-58C" กับ "XP-58C (copy 1)"
    const soft = printers.find((p) => {
      const n = normalizePrinterKey(p.name);
      return n.includes(wantKey) || wantKey.includes(n);
    });
    if (soft?.name) {
      return { name: soft.name, available, matchedPreferred: true };
    }

    const fallback = pickBestPrinter(printers);
    return {
      name: fallback?.name || undefined,
      available,
      matchedPreferred: false,
      warning: `ไม่พบ「${want}」— ใช้ ${fallback?.name ?? "default"} แทน · มีในเครื่อง: ${available.join(", ")}`,
    };
  }

  const fallback = pickBestPrinter(printers);
  const note =
    fallback && thermalScore(fallback.name) >= 100
      ? undefined
      : fallback
        ? `ใช้เครื่องพิมพ์「${fallback.name}」— แนะนำตั้งชื่อ XP-58C ในตั้งค่าเครื่อง`
        : undefined;
  return {
    name: fallback?.name || undefined,
    available,
    matchedPreferred: false,
    warning: note,
  };
}

function paperSizeMicrons(paperWidth: "58mm" | "80mm") {
  // Electron pageSize เป็นไมครอน (1mm = 1000)
  return paperWidth === "58mm"
    ? { width: 58000, height: 297000 }
    : { width: 80000, height: 297000 };
}

function runPrint(
  contents: Electron.WebContents,
  opts: Electron.WebContentsPrintOptions,
  timeoutMs = 12000,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (contents.isDestroyed()) {
      reject(new Error("หน้าต่างพิมพ์ถูกปิดก่อนสั่งพิมพ์"));
      return;
    }
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };
    const timer = setTimeout(() => {
      finish(() => reject(new Error("หมดเวลารอไดรเวอร์พิมพ์ (ค้าง)")));
    }, timeoutMs);
    try {
      contents.print(opts, (success, failureReason) => {
        finish(() => {
          if (success) {
            resolve();
            return;
          }
          reject(new Error(failureReason || "พิมพ์ไม่สำเร็จ"));
        });
      });
    } catch (e) {
      finish(() =>
        reject(e instanceof Error ? e : new Error("พิมพ์ไม่สำเร็จ")),
      );
    }
  });
}

function writeTempReceiptHtml(html: string): string {
  const dir = join(app.getPath("temp"), "ap-pos-print");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `slip-${randomBytes(6).toString("hex")}.html`);
  writeFileSync(file, html, "utf8");
  return file;
}

async function openPrintWindow(
  filePath: string,
  paperWidth: "58mm" | "80mm",
  visible: boolean,
): Promise<BrowserWindow> {
  const win = new BrowserWindow({
    show: false,
    width: paperPx(paperWidth) + 40,
    height: 820,
    x: 48,
    y: 48,
    skipTaskbar: !visible,
    focusable: true,
    autoHideMenuBar: true,
    title: "AP POS — พิมพ์สลิป",
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  await win.loadFile(filePath);
  await Promise.race([
    new Promise<void>((resolve) => {
      if (win.webContents.isLoading()) {
        win.webContents.once("did-finish-load", () => resolve());
      } else {
        resolve();
      }
    }),
    new Promise<void>((r) => setTimeout(r, 2500)),
  ]);

  // รอ paint — ลดหน่วง แต่ยังให้ฟอนต์โหลดทัน
  await new Promise((r) => setTimeout(r, isWin() ? 350 : 150));

  if (visible) {
    win.setAlwaysOnTop(true, "screen-saver");
    win.show();
    win.focus();
  } else if (isWin()) {
    // บางไดรเวอร์ต้องการหน้าต่างมี HWND จริงก่อน silent print
    win.showInactive();
  }

  await new Promise((r) => setTimeout(r, isWin() ? 200 : 80));
  return win;
}

async function safeDestroy(win: BrowserWindow | null, delayMs: number) {
  if (!win || win.isDestroyed()) return;
  await new Promise((r) => setTimeout(r, delayMs));
  if (win.isDestroyed()) return;
  try {
    win.setAlwaysOnTop(false);
  } catch {
    /* ignore */
  }
  try {
    if (!win.isDestroyed()) win.destroy();
  } catch {
    /* ignore */
  }
}

/**
 * พิมพ์ทีละครั้งด้วยหน้าต่างใหม่ — ห้าม print ซ้ำบน webContents เดิม
 * (Electron Windows + XP-58C มักขึ้น "Object has been destroyed" ถ้าลองซ้ำบนหน้าต่างเดิม)
 */
async function printWithFreshWindows(
  filePath: string,
  deviceName: string,
  wantSilent: boolean,
  paperWidth: "58mm" | "80mm",
): Promise<{ ok: true; note?: string } | { ok: false; message: string }> {
  type Attempt = {
    label: string;
    visible: boolean;
    opts: Electron.WebContentsPrintOptions;
  };

  const attempts: Attempt[] = [];

  const pageSize = paperSizeMicrons(paperWidth);
  const baseOpts: Electron.WebContentsPrintOptions = {
    printBackground: true,
    copies: 1,
    margins: { marginType: "none" },
    pageSize,
    scaleFactor: 100,
    preferCSSPageSize: true,
  };

  if (wantSilent) {
    // ลองเงียบครั้งเดียว — กันค้างวนหลายรอบ
    attempts.push({
      label: "silent+named",
      visible: false,
      opts: {
        ...baseOpts,
        silent: true,
        deviceName,
      },
    });
  }

  attempts.push({
    label: "dialog+named",
    visible: true,
    opts: {
      ...baseOpts,
      silent: false,
      deviceName,
    },
  });

  let lastErr = "พิมพ์ไม่สำเร็จ";

  for (const attempt of attempts) {
    let win: BrowserWindow | null = null;
    try {
      console.log(
        `[ap-pos] print try ${attempt.label} → ${
          attempt.opts.deviceName || "(windows-default)"
        }`,
      );
      win = await openPrintWindow(filePath, paperWidth, attempt.visible);
      if (win.webContents.isDestroyed()) {
        throw new Error("หน้าต่างพิมพ์ไม่พร้อม");
      }
      await runPrint(win.webContents, attempt.opts);
      // สำเร็จ — เก็บหน้าต่างไว้ให้ spooler รับงานก่อนค่อยปิด
      await safeDestroy(win, isWin() ? 5000 : 600);
      win = null;
      if (attempt.label.startsWith("dialog") && wantSilent) {
        return {
          ok: true,
          note: "พิมพ์เงียบไม่สำเร็จ — ใช้หน้าต่างพิมพ์แทน",
        };
      }
      return { ok: true };
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
      console.warn(`[ap-pos] print fail ${attempt.label}:`, lastErr);
      // ปิดหน้าต่างที่พังก่อนลองหน้าต่างใหม่
      await safeDestroy(win, 200);
      win = null;
      // ถ้าโดน destroy ระหว่าง silent ให้ข้ามไป dialog เลย
      if (
        wantSilent &&
        /object has been destroyed/i.test(lastErr) &&
        attempt.label.startsWith("silent")
      ) {
        continue;
      }
    }
  }

  const friendly = /object has been destroyed/i.test(lastErr)
    ? "ระบบพิมพ์ถูกตัดกลางคัน — ลองปิด「พิมพ์เงียบ」แล้วกดทดสอบพิมพ์อีกครั้ง"
    : lastErr;
  return { ok: false, message: `${friendly} (${deviceName})` };
}

/**
 * เปิดหน้าต่างดูสลิป (ใช้ตอนยังไม่มีเครื่องพิมพ์ / ตรวจเลย์เอาต์)
 */
export async function previewReceiptHtml(
  req: PrintReceiptRequest,
): Promise<{ ok: boolean; message?: string }> {
  const html = String(req.html || "");
  if (!html.trim()) {
    return { ok: false, message: "ไม่มีเนื้อหาใบเสร็จ" };
  }
  const paperWidth = req.paperWidth === "58mm" ? "58mm" : "80mm";
  const winW = paperPx(paperWidth) + 48;
  const title = String(req.title || "").trim() || "ตัวอย่างใบเสร็จ";

  if (previewWin && !previewWin.isDestroyed()) {
    previewWin.close();
    previewWin = null;
  }

  const wrapped = `<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="utf-8" />
<title>${title.replace(/</g, "")}</title>
<style>
  body { margin: 0; background: #e8e6e3; font-family: system-ui, sans-serif; }
  .bar {
    position: sticky; top: 0; z-index: 5;
    display: flex; gap: 8px; align-items: center; justify-content: space-between;
    padding: 10px 12px; background: #1c1917; color: #fff;
  }
  .bar strong { font-size: 14px; }
  .bar .actions { display: flex; gap: 8px; }
  .bar button {
    border: 0; border-radius: 8px; padding: 8px 12px; font-weight: 700; cursor: pointer;
  }
  .bar .print { background: #b42318; color: #fff; }
  .bar .close { background: #44403c; color: #fff; }
  .sheet {
    margin: 16px auto 24px;
    width: ${paperPx(paperWidth)}px;
    max-width: calc(100% - 24px);
    background: #fff;
    box-shadow: 0 10px 30px rgba(0,0,0,.18);
    border-radius: 4px;
    overflow: hidden;
  }
  .sheet iframe { display: block; width: 100%; border: 0; min-height: 70vh; }
  .hint { font-size: 12px; opacity: .75; margin-left: 8px; }
</style>
</head>
<body>
  <div class="bar">
    <div>
      <strong>${title.replace(/</g, "")} (${paperWidth})</strong>
      <span class="hint">ยังไม่มีเครื่องพิมพ์ก็ดูตรงนี้ได้ · กดพิมพ์เพื่อเลือก PDF / เครื่องพิมพ์</span>
    </div>
    <div class="actions">
      <button type="button" class="print" id="btnPrint">พิมพ์ / บันทึก PDF</button>
      <button type="button" class="close" id="btnClose">ปิด</button>
    </div>
  </div>
  <div class="sheet">
    <iframe id="slip" title="slip"></iframe>
  </div>
  <script>
    const html = ${JSON.stringify(html)};
    const frame = document.getElementById('slip');
    frame.srcdoc = html;
    frame.onload = () => {
      try {
        const doc = frame.contentDocument;
        if (!doc) return;
        const h = Math.max(doc.body.scrollHeight, doc.documentElement.scrollHeight);
        frame.style.height = Math.max(480, h + 24) + 'px';
      } catch (_) {}
    };
    document.getElementById('btnPrint').onclick = () => {
      frame.contentWindow.focus();
      frame.contentWindow.print();
    };
    document.getElementById('btnClose').onclick = () => window.close();
  </script>
</body>
</html>`;

  previewWin = new BrowserWindow({
    show: true,
    width: Math.max(winW, 420),
    height: 860,
    title,
    autoHideMenuBar: true,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  previewWin.on("closed", () => {
    previewWin = null;
  });

  try {
    await previewWin.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(wrapped)}`,
    );
    previewWin.focus();
    return { ok: true };
  } catch (e) {
    try {
      if (previewWin && !previewWin.isDestroyed()) previewWin.destroy();
    } catch {
      /* ignore */
    }
    previewWin = null;
    return {
      ok: false,
      message: e instanceof Error ? e.message : "เปิดตัวอย่างไม่สำเร็จ",
    };
  }
}

/**
 * รายชื่อเครื่องพิมพ์บนเครื่องนี้ — ช่วยตั้งค่า Admin ให้ตรงชื่อ Windows
 */
export async function listSystemPrinters(): Promise<{
  printers: Array<{ name: string; isDefault: boolean }>;
}> {
  const probe = new BrowserWindow({
    show: false,
    width: 100,
    height: 100,
    webPreferences: { sandbox: true, contextIsolation: true },
  });
  try {
    await probe.loadURL("about:blank");
    const list = await listPrinters(probe.webContents);
    return {
      printers: list.map((p) => ({
        name: p.name,
        isDefault: Boolean(p.isDefault),
      })),
    };
  } finally {
    try {
      if (!probe.isDestroyed()) probe.destroy();
    } catch {
      /* ignore */
    }
  }
}

/**
 * พิมพ์ใบเสร็จ — ข้อความผ่านไดรเวอร์ Windows เท่านั้น
 * เร่ง: มีชื่อเครื่องตั้งไว้แล้ว → เตะลิ้นชัก + พิมพ์คู่ขนาน (ไม่เปิด BrowserWindow)
 */
export async function printReceiptHtml(
  req: PrintReceiptRequest,
): Promise<{ ok: boolean; message?: string }> {
  const html = String(req.html || "");
  const textBody = String(req.text || "").trim();
  if (!html.trim() && !textBody) {
    return { ok: false, message: "ไม่มีเนื้อหาใบเสร็จ" };
  }

  const paperWidth = req.paperWidth === "58mm" ? "58mm" : "80mm";
  const wantSilent = req.silent !== false;
  const preferred = String(req.deviceName || "").trim();
  const wantDrawer = isWin() && req.openDrawer !== false;
  const slipText = textBody || "AP POS\n(ไม่มีข้อความสลิป — อัปเดตแอป)";
  const gdiOpts = {
    paperWidthMm: (paperWidth === "80mm" ? 80 : 58) as 58 | 80,
    fontSizePt: paperWidth === "80mm" ? 8 : 7,
  };

  // Fast path: Windows + ตั้งชื่อเครื่องแล้ว — ไม่ต้อง enumerate เครื่องพิมพ์
  if (isWin() && preferred && textBody) {
    const t0 = Date.now();
    console.log(`[ap-pos] fast print → ${preferred}`);
    const drawerP = wantDrawer
      ? kickCashDrawerBestEffort([preferred]).then((r) => {
          if (!r.ok) console.warn("[ap-pos] drawer kick skipped:", r.error);
          else console.log(`[ap-pos] drawer ${Date.now() - t0}ms → ${r.used}`);
          return r;
        })
      : Promise.resolve({ ok: true as const });

    try {
      await Promise.all([
        drawerP,
        sendTextToWindowsPrinter(preferred, slipText, gdiOpts).then(() => {
          console.log(`[ap-pos] GDI done ${Date.now() - t0}ms → ${preferred}`);
        }),
      ]);
      return { ok: true, message: "พิมพ์ผ่านไดรเวอร์ Windows" };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn("[ap-pos] fast print failed, fallback enumerate:", msg);
      // ตกไปทางช้าด้านล่าง
    }
  }

  let tempFile: string | null = null;
  let probe: BrowserWindow | null = null;

  try {
    if (html.trim()) tempFile = writeTempReceiptHtml(html);

    probe = new BrowserWindow({
      show: false,
      width: 100,
      height: 100,
      webPreferences: { sandbox: true, contextIsolation: true },
    });
    await probe.loadURL("about:blank");
    const resolved = await resolvePrinterName(probe.webContents, preferred);
    await safeDestroy(probe, 50);
    probe = null;

    console.log("[ap-pos] printers:", resolved.available.join(" | ") || "(none)");
    const deviceName = resolved.name;
    console.log(
      `[ap-pos] print target: ${deviceName ?? "(none)"} preferred=${preferred || "(default)"}`,
    );

    if (!deviceName) {
      // ยังเตะลิ้นชักด้วยชื่อที่รู้ — กันลิ้นชักไม่เปิดทั้งที่พิมพ์ไม่ได้
      if (wantDrawer) {
        const drawer = await kickCashDrawerBestEffort([
          preferred,
          "XP-58C",
        ]);
        if (!drawer.ok) {
          console.warn("[ap-pos] drawer kick skipped:", drawer.error);
        }
      }
      return {
        ok: false,
        message:
          resolved.available.length === 0
            ? "ไม่พบเครื่องพิมพ์ใน Windows — ติดตั้งไดรเวอร์ / ตั้ง Default printer ก่อน"
            : `ไม่พบเครื่องพิมพ์ที่ใช้ได้ · มีในเครื่อง: ${resolved.available.join(", ")}`,
      };
    }

    if (isWin()) {
      try {
        const thermalGuess = resolved.available.find(
          (n) =>
            /xp-?58|xprinter|thermal|receipt/i.test(n) &&
            !/pdf|fax|onenote/i.test(n),
        );
        // ลิ้นชัก + พิมพ์คู่ขนาน — ส่งเข้าคิว Windows พร้อมกัน
        const drawerP = wantDrawer
          ? kickCashDrawerBestEffort([
              preferred,
              deviceName,
              thermalGuess,
            ]).then((r) => {
              if (!r.ok) console.warn("[ap-pos] drawer kick skipped:", r.error);
              return r;
            })
          : Promise.resolve({ ok: true as const });

        console.log(
          `[ap-pos] GDI text print ${slipText.length} chars → ${deviceName}`,
        );
        await Promise.all([
          drawerP,
          sendTextToWindowsPrinter(deviceName, slipText, gdiOpts),
        ]);
        return {
          ok: true,
          message: resolved.warning
            ? `ไดรเวอร์ · ${resolved.warning}`
            : "พิมพ์ผ่านไดรเวอร์ Windows",
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn("[ap-pos] GDI text print failed:", msg);
        return {
          ok: false,
          message: resolved.warning
            ? `พิมพ์ไม่สำเร็จ: ${msg} · ${resolved.warning}`
            : `พิมพ์ไม่สำเร็จ: ${msg}`,
        };
      }
    }

    if (!tempFile) {
      return { ok: false, message: "ไม่มีเนื้อหาใบเสร็จ" };
    }

    const result = await printWithFreshWindows(
      tempFile,
      deviceName,
      wantSilent,
      paperWidth,
    );

    if (!result.ok) {
      return {
        ok: false,
        message: resolved.warning
          ? `${result.message} · ${resolved.warning}`
          : result.message,
      };
    }

    const notes = [resolved.warning, result.note].filter(Boolean);
    return notes.length
      ? { ok: true, message: notes.join(" · ") }
      : { ok: true };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "พิมพ์ไม่สำเร็จ",
    };
  } finally {
    await safeDestroy(probe, 0);
    if (tempFile) {
      try {
        unlinkSync(tempFile);
      } catch {
        /* ignore */
      }
    }
  }
}
