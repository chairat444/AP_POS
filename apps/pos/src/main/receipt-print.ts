import { BrowserWindow } from "electron";

export type PrintReceiptRequest = {
  html: string;
  paperWidth: "58mm" | "80mm";
  silent?: boolean;
  /** ชื่อเครื่องพิมพ์จาก Admin (ต้องตรงกับ OS) — ว่าง = default */
  deviceName?: string;
  /** ชื่อหน้าต่างตัวอย่าง (ใบเสร็จ / ใบปิดรอบ) */
  title?: string;
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

async function listPrinters(contents: Electron.WebContents) {
  try {
    return (await contents.getPrintersAsync()) ?? [];
  } catch {
    return [];
  }
}

/**
 * จับคู่ชื่อเครื่องพิมพ์แบบยืดหยุ่น (Windows ชื่อมักไม่ตรงเป๊ะกับที่พิมพ์ใน Admin)
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
    // รวม / ขึ้นต้น / ลงท้าย — เช่น "XP-80C" กับ "XP-80C (copy 1)"
    const soft = printers.find((p) => {
      const n = normalizePrinterKey(p.name);
      return n.includes(wantKey) || wantKey.includes(n);
    });
    if (soft?.name) {
      return { name: soft.name, available, matchedPreferred: true };
    }

    const fallback = printers.find((p) => p.isDefault) ?? printers[0];
    return {
      name: fallback?.name || undefined,
      available,
      matchedPreferred: false,
      warning: `ไม่พบ「${want}」— ใช้ ${fallback?.name ?? "default"} แทน · มีในเครื่อง: ${available.join(", ")}`,
    };
  }

  const fallback = printers.find((p) => p.isDefault) ?? printers[0];
  return {
    name: fallback?.name || undefined,
    available,
    matchedPreferred: false,
  };
}

function runPrint(
  contents: Electron.WebContents,
  opts: Electron.WebContentsPrintOptions,
): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      contents.print(opts, (success, failureReason) => {
        if (!success) {
          reject(new Error(failureReason || "พิมพ์ไม่สำเร็จ"));
          return;
        }
        resolve();
      });
    } catch (e) {
      reject(e instanceof Error ? e : new Error("พิมพ์ไม่สำเร็จ"));
    }
  });
}

/** ลองชุดตัวเลือกหลายแบบ — Windows silent พังง่ายถ้า option ไม่ถูกใจไดรเวอร์ */
async function printWithFallbacks(
  contents: Electron.WebContents,
  deviceName: string,
  wantSilent: boolean,
  paperWidth: "58mm" | "80mm",
): Promise<{ ok: true; note?: string } | { ok: false; message: string }> {
  const widthMicrons = paperWidth === "58mm" ? 58_000 : 80_000;
  // ความสูงยาว — thermal มักตัดเอง; สั้นเกินไป Windows บางตัวไม่ยิงงาน
  const heightMicrons = paperWidth === "58mm" ? 297_000 : 327_000;

  type Attempt = {
    label: string;
    opts: Electron.WebContentsPrintOptions;
  };

  const attempts: Attempt[] = [];

  if (wantSilent) {
    // 1) ชุดที่ผ่านบน Windows หลายเครื่อง (scaleFactor ≠ 100)
    attempts.push({
      label: "silent+pageSize+scale99",
      opts: {
        silent: true,
        printBackground: true,
        deviceName,
        copies: 1,
        scaleFactor: 99,
        margins: { marginType: "none" },
        pageSize: { width: widthMicrons, height: heightMicrons },
      },
    });
    // 2) ไม่ส่ง dpi (บางไดรเวอร์ thermal พังถ้าบังคับ 203)
    attempts.push({
      label: "silent+scale99",
      opts: {
        silent: true,
        printBackground: true,
        deviceName,
        copies: 1,
        scaleFactor: 99,
        margins: { marginType: "none" },
      },
    });
    // 3) scaleFactor 100 + pageSize
    attempts.push({
      label: "silent+pageSize",
      opts: {
        silent: true,
        printBackground: true,
        deviceName,
        copies: 1,
        margins: { marginType: "none" },
        pageSize: { width: widthMicrons, height: heightMicrons },
      },
    });
    // 4) ขั้นต่ำสุด
    attempts.push({
      label: "silent-min",
      opts: {
        silent: true,
        deviceName,
        printBackground: true,
      },
    });
  }

  // สุดท้าย: เปิดไดอะล็อก (ยังขายต่อได้)
  attempts.push({
    label: "dialog",
    opts: {
      silent: false,
      printBackground: true,
      deviceName,
      copies: 1,
      margins: { marginType: "none" },
    },
  });

  let lastErr = "พิมพ์ไม่สำเร็จ";
  for (const attempt of attempts) {
    try {
      console.log(
        `[ap-pos] print try ${attempt.label} → ${deviceName} (silent=${Boolean(attempt.opts.silent)})`,
      );
      await runPrint(contents, attempt.opts);
      if (attempt.label === "dialog" && wantSilent) {
        return {
          ok: true,
          note: "พิมพ์เงียบไม่สำเร็จ — เปิดหน้าต่างพิมพ์แทน",
        };
      }
      return { ok: true };
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
      console.warn(`[ap-pos] print fail ${attempt.label}:`, lastErr);
    }
  }
  return { ok: false, message: `${lastErr} (${deviceName})` };
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
 * พิมพ์ใบเสร็จผ่านหน้าต่างซ่อน
 * Windows: ลองหลายชุด option + จับคู่ชื่อเครื่องพิมพ์แบบยืดหยุ่น
 */
export async function printReceiptHtml(
  req: PrintReceiptRequest,
): Promise<{ ok: boolean; message?: string }> {
  const html = String(req.html || "");
  if (!html.trim()) {
    return { ok: false, message: "ไม่มีเนื้อหาใบเสร็จ" };
  }

  const paperWidth = req.paperWidth === "58mm" ? "58mm" : "80mm";
  const wantSilent = req.silent !== false;

  // Windows: หน้าต่างซ่อนล้วนบางเครื่องไม่เรนเดอร์ — วางนอกจอแล้ว showInactive
  const win = new BrowserWindow({
    show: false,
    width: paperPx(paperWidth),
    height: 1200,
    x: isWin() ? -4000 : undefined,
    y: isWin() ? -4000 : undefined,
    skipTaskbar: true,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  try {
    await win.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(html)}`,
    );
    await Promise.race([
      new Promise<void>((resolve) => {
        if (win.webContents.isLoading()) {
          win.webContents.once("did-finish-load", () => resolve());
        } else {
          resolve();
        }
      }),
      new Promise<void>((r) => setTimeout(r, 2000)),
    ]);

    if (isWin()) {
      try {
        win.showInactive();
      } catch {
        /* ignore */
      }
    }

    // ให้ layout สลิปนิ่งก่อนสั่งพิมพ์ (Windows ต้องรอนานกว่า Mac)
    await new Promise((r) => setTimeout(r, isWin() ? 600 : 350));

    const preferred = String(req.deviceName || "").trim();
    const resolved = await resolvePrinterName(win.webContents, preferred);
    const deviceName = resolved.name;
    console.log("[ap-pos] printers:", resolved.available.join(" | ") || "(none)");
    console.log(
      `[ap-pos] print target: ${deviceName ?? "(none)"} preferred=${preferred || "(default)"}`,
    );

    if (!deviceName) {
      return {
        ok: false,
        message:
          resolved.available.length === 0
            ? "ไม่พบเครื่องพิมพ์ใน Windows — ติดตั้งไดรเวอร์ / ตั้ง Default printer ก่อน"
            : `ไม่พบเครื่องพิมพ์ที่ใช้ได้ · มีในเครื่อง: ${resolved.available.join(", ")}`,
      };
    }

    const result = await printWithFallbacks(
      win.webContents,
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
    try {
      // Windows: หน่วงก่อนปิด — กันตัดงานพิมพ์กลางคัน
      await new Promise((r) => setTimeout(r, isWin() ? 1200 : 400));
      if (!win.isDestroyed()) win.destroy();
    } catch {
      /* ignore */
    }
  }
}

// end of file
