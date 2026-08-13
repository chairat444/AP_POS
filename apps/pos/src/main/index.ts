import {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  screen,
  shell,
  systemPreferences,
} from "electron";
import { existsSync } from "node:fs";
import { join } from "node:path";
import * as localDb from "./local-db";
import * as mediaCache from "./media-cache";
import * as receiptPrint from "./receipt-print";

const APP_NAME = "AP POS";
const APP_USER_MODEL_ID = "th.ap.pos";
/** ขนาดหน้าต่างแคชเชียร์เริ่มต้น (จอขายจริงที่ใช้เทส) */
const POS_DEFAULT_WIDTH = 1360;
const POS_DEFAULT_HEIGHT = 768;
/** คง path เดิมของ SQLite — อย่าให้ setName ย้ายไปโฟลเดอร์ใหม่ */
const USER_DATA_DIR = join(app.getPath("appData"), "@ap-pos", "pos");

app.setPath("userData", USER_DATA_DIR);
// ต้องตั้งก่อน ready — ชื่อเมนู / About (โหมด dev ยังรัน Electron.app)
app.setName(APP_NAME);
if (process.platform === "win32") {
  app.setAppUserModelId(APP_USER_MODEL_ID);
}

/** ต้องเรียกก่อน app ready — ให้ img/video โหลดจาก cache ออฟไลน์ได้ */
mediaCache.registerMediaScheme();


let cashierWindow: BrowserWindow | null = null;
let customerWindow: BrowserWindow | null = null;
let ipcReady = false;
/** snapshot ล่าสุดของตะกร้า — ส่งซ้ำเมื่อจอลูกค้าโหลดเสร็จ */
let lastCartSnapshot: unknown = null;
let lastSettingsSnapshot: unknown = null;
/** มีรอบขายเปิดอยู่ — ห้ามปิดแอป (ยกเว้นหลังปิดรอบ) */
let shiftOpen = false;
/** ปิดรอบแล้ว อนุญาตออกจากแอป */
let forceQuit = false;
/** ตั้งค่าจาก Admin/renderer ว่าต้องการใช้จอลูกค้า (จะเปิดจริงเมื่อมีจอ 2) */
let customerScreenWanted = true;

function resolveAppIcon(): string | undefined {
  const candidates = [
    join(__dirname, "../../build/icon.ico"),
    join(__dirname, "../../build/icon.png"),
    join(__dirname, "../../resources/icon.icns"),
    join(__dirname, "../../resources/icon.png"),
    join(process.resourcesPath, "icon.ico"),
    join(process.resourcesPath, "icon.png"),
    join(process.resourcesPath, "icon.icns"),
  ];
  return candidates.find((p) => existsSync(p));
}

function applyDockBranding() {
  if (process.platform === "darwin") {
    app.setAboutPanelOptions({
      applicationName: APP_NAME,
      applicationVersion: app.getVersion(),
      copyright: "Copyright © AP หมูสด",
    });
  }
  if (process.platform !== "darwin" || !app.dock) return;
  const iconPath = resolveAppIcon();
  if (!iconPath) return;
  const img = nativeImage.createFromPath(iconPath);
  if (!img.isEmpty()) app.dock.setIcon(img);
}

/**
 * คีย์ที่ Chromium / OS แย่งก่อนถึงหน้าเว็บ
 * - F10 → โฟกัสเมนู (Win)
 * - F11 → เต็มจอ (Win) / Show Desktop (macOS)
 * ส่งเข้า renderer เองผ่าน pos:hotkey
 */

/** accelerator ที่ยึดด้วย globalShortcut (macOS เป็นหลัก) */
const DARWIN_PAY_ACCELS: Array<{
  accel: string;
  key: string;
  ctrl?: boolean;
  meta?: boolean;
  alt?: boolean;
}> = [
  { accel: "F9", key: "F9" },
  { accel: "F10", key: "F10" },
  { accel: "F11", key: "F11" },
  { accel: "F12", key: "F12" },
  // macOS มักกลืน F11 เปล่า — Ctrl/Alt+F11 ยังส่งถึงแอปได้
  { accel: "Control+F11", key: "F11", ctrl: true },
  { accel: "Alt+F11", key: "F11", alt: true },
];

/** กันยิงซ้ำจาก before-input-event + globalShortcut */
const lastHotkeyAt = new Map<string, number>();

type HotkeyPayload = {
  key: string;
  code: string;
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  meta: boolean;
};

function isFnKey(input: { key: string; code: string }, name: string) {
  return input.key === name || input.code === name;
}

function setupIpc() {
  if (ipcReady) return;
  ipcReady = true;

  ipcMain.on("cart:update", (_event, snapshot) => {
    lastCartSnapshot = snapshot;
    pushCartToCustomer(snapshot);
  });
  ipcMain.handle("cart:get", async () => lastCartSnapshot);

  ipcMain.on("settings:update", (_event, snapshot) => {
    lastSettingsSnapshot = snapshot;
    pushSettingsToCustomer(snapshot);
  });
  ipcMain.handle("settings:get", async () => lastSettingsSnapshot);

  ipcMain.handle("db:path", async () => localDb.getSqlitePath());
  ipcMain.handle("db:device", async () => localDb.getDeviceConfig());
  ipcMain.handle(
    "db:device:set",
    async (
      _e,
      patch: {
        branchId?: string;
        branchName?: string;
        terminalId?: string;
        terminalName?: string;
        setupDone?: boolean;
      },
    ) => localDb.setDeviceConfig(patch),
  );
  ipcMain.handle("db:device:replace", async (_e, config) =>
    localDb.replaceDeviceConfig(config),
  );
  ipcMain.handle("db:products:list", async () => localDb.listProducts());
  ipcMain.handle("db:products:upsert", async (_e, products) => {
    await localDb.upsertProducts(products);
    return true;
  });
  ipcMain.handle("db:products:remove", async (_e, ids: string[]) => {
    await localDb.removeProducts(ids);
    return true;
  });
  ipcMain.handle("db:members:list", async () => localDb.listMembers());
  ipcMain.handle("db:members:upsert", async (_e, members) => {
    await localDb.upsertMembers(members);
    return true;
  });
  ipcMain.handle("db:members:remove", async (_e, ids: string[]) => {
    await localDb.removeMembers(ids);
    return true;
  });
  ipcMain.handle(
    "db:members:adjustPoints",
    async (_e, id: string, delta: number) =>
      localDb.adjustMemberPoints(id, delta),
  );
  ipcMain.handle("db:sale:save", async (_e, sale) => localDb.saveSale(sale));
  ipcMain.handle("db:shift:enqueue", async (_e, shift) =>
    localDb.enqueueShift(shift),
  );
  ipcMain.handle("db:audit:save", async (_e, audit) =>
    localDb.saveAudit(audit),
  );
  ipcMain.handle("db:audit:listByShift", async (_e, shiftId: string) =>
    localDb.listAuditsByShift(shiftId),
  );
  ipcMain.handle("db:outbox:list", async () => localDb.listOutbox());
  ipcMain.handle("db:outbox:ack", async (_e, ids: string[]) => {
    await localDb.ackOutbox(ids);
    return true;
  });
  ipcMain.handle("db:outbox:count", async () => localDb.pendingOutboxCount());
  ipcMain.handle("db:sales:purgeSynced", async () =>
    localDb.purgeSyncedSales(),
  );
  ipcMain.handle("db:meta:get", async (_e, key: string) => localDb.getMeta(key));
  ipcMain.handle("db:meta:set", async (_e, key: string, value: string) => {
    await localDb.setMeta(key, value);
    return true;
  });
  ipcMain.handle("app:quit", () => {
    quitAfterCloseShift();
    return true;
  });
  ipcMain.on("app:quit", () => {
    quitAfterCloseShift();
  });
  ipcMain.on("app:shift-open", (_e, open: boolean) => {
    setShiftOpen(Boolean(open));
  });
  ipcMain.on("app:customer-screen", (_e, enabled: boolean) => {
    setCustomerScreenEnabled(Boolean(enabled));
  });

  ipcMain.handle("shell:open-external", async (_e, url: string) => {
    const raw = String(url ?? "").trim();
    if (!/^https?:\/\//i.test(raw)) return { ok: false, message: "URL ไม่ถูกต้อง" };
    try {
      await shell.openExternal(raw);
      return { ok: true };
    } catch (e) {
      return {
        ok: false,
        message: e instanceof Error ? e.message : "เปิดลิงก์ไม่สำเร็จ",
      };
    }
  });

  ipcMain.handle("media:index", async () => mediaCache.getMediaIndex());
  ipcMain.handle("media:set-api-base", async (_e, url: string) => {
    mediaCache.setApiBase(String(url ?? ""));
    return true;
  });
  ipcMain.handle("media:resolve", async (_e, url: string) => {
    return mediaCache.resolveCached(url) ?? null;
  });
  ipcMain.handle("media:cache", async (_e, urls: string[]) => {
    const list = Array.isArray(urls) ? urls.filter((u) => typeof u === "string") : [];
    return mediaCache.cacheUrls(list);
  });

  ipcMain.handle(
    "receipt:print",
    async (
      _e,
      req: {
        html: string;
        paperWidth?: "58mm" | "80mm";
        silent?: boolean;
        deviceName?: string;
      },
    ) => {
      return receiptPrint.printReceiptHtml({
        html: String(req?.html ?? ""),
        paperWidth: req?.paperWidth === "58mm" ? "58mm" : "80mm",
        silent: req?.silent !== false,
        deviceName:
          typeof req?.deviceName === "string" ? req.deviceName.trim() : "",
      });
    },
  );
  ipcMain.handle("printers:list", async () => {
    return receiptPrint.listSystemPrinters();
  });
  ipcMain.handle(
    "receipt:preview",
    async (
      _e,
      req: {
        html: string;
        paperWidth?: "58mm" | "80mm";
        title?: string;
      },
    ) => {
      return receiptPrint.previewReceiptHtml({
        html: String(req?.html ?? ""),
        paperWidth: req?.paperWidth === "58mm" ? "58mm" : "80mm",
        title: typeof req?.title === "string" ? req.title : undefined,
      });
    },
  );
}

function shouldBlockQuit() {
  // อนุญาตปิดแอปได้เสมอ (แม้รอบยังเปิด — ข้อมูลค้างในเครื่อง)
  return false;
}

function setShiftOpen(open: boolean) {
  shiftOpen = open;
  for (const win of BrowserWindow.getAllWindows()) {
    try {
      win.setClosable(true);
    } catch {
      // ignore
    }
  }
}

/** ปิดจอลูกค้าทันที (ก่อนปิดแอป / หลังปิดรอบ) */
function closeCustomerWindow() {
  if (!customerWindow || customerWindow.isDestroyed()) {
    customerWindow = null;
    return;
  }
  try {
    customerWindow.removeAllListeners("close");
    customerWindow.setClosable(true);
    customerWindow.destroy();
  } catch {
    // ignore
  }
  customerWindow = null;
}

/** อนุญาตออกจากแอป — เรียกได้จากปิดรอบเท่านั้น */
function quitAfterCloseShift() {
  forceQuit = true;
  shiftOpen = false;
  // ปิดจอ 2 ก่อน — อย่าให้ค้างบนจอที่สองหลังปิดรอบ
  closeCustomerWindow();
  for (const win of BrowserWindow.getAllWindows()) {
    try {
      win.removeAllListeners("close");
      win.setClosable(true);
      win.destroy();
    } catch {
      // ignore
    }
  }
  app.exit(0);
}

function blockWindowClose(win: BrowserWindow) {
  win.on("close", (e) => {
    if (!shouldBlockQuit()) return;
    e.preventDefault();
    if (!win.isDestroyed()) {
      win.webContents.send("app:close-blocked");
    }
  });
}

function pushCartToCustomer(snapshot: unknown) {
  if (!customerWindow || customerWindow.isDestroyed()) return;
  customerWindow.webContents.send("cart:update", snapshot);
}

function pushSettingsToCustomer(snapshot: unknown) {
  if (!customerWindow || customerWindow.isDestroyed()) return;
  customerWindow.webContents.send("settings:update", snapshot);
}

function loadRoute(win: BrowserWindow, route: "cashier" | "customer") {
  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(`${process.env.ELECTRON_RENDERER_URL}?v=${route}#/${route}`);
  } else {
    void win.loadFile(join(__dirname, "../renderer/index.html"), {
      hash: `/${route}`,
    });
  }
}

function sendPosHotkey(win: BrowserWindow | null, payload: HotkeyPayload) {
  if (!win || win.isDestroyed()) return;
  const stampKey = `${payload.key}:${payload.ctrl ? 1 : 0}:${payload.alt ? 1 : 0}:${payload.shift ? 1 : 0}`;
  const now = Date.now();
  const prev = lastHotkeyAt.get(stampKey) ?? 0;
  if (now - prev < 120) return;
  lastHotkeyAt.set(stampKey, now);
  win.webContents.send("pos:hotkey", payload);
}

function registerDarwinStolenKeys() {
  // ขอสิทธิ์ Accessibility — ช่วยให้ globalShortcut จับ F-keys ได้บน macOS
  try {
    if (!systemPreferences.isTrustedAccessibilityClient(false)) {
      console.warn(
        "[ap-pos] macOS Accessibility ยังไม่เปิดให้ Electron — จะเด้งขอสิทธิ์ (จำเป็นสำหรับ F11)",
      );
      systemPreferences.isTrustedAccessibilityClient(true);
    }
  } catch {
    /* ignore */
  }

  for (const row of DARWIN_PAY_ACCELS) {
    try {
      globalShortcut.unregister(row.accel);
    } catch {
      /* ignore */
    }
  }

  let f11Ok = false;
  for (const row of DARWIN_PAY_ACCELS) {
    const ok = globalShortcut.register(row.accel, () => {
      const win =
        cashierWindow && !cashierWindow.isDestroyed()
          ? cashierWindow
          : BrowserWindow.getFocusedWindow();
      sendPosHotkey(win, {
        key: row.key,
        code: row.key,
        ctrl: Boolean(row.ctrl),
        shift: false,
        alt: Boolean(row.alt),
        meta: Boolean(row.meta),
      });
    });
    if (row.accel === "F11") f11Ok = ok;
    if (!ok) {
      console.warn(`[ap-pos] globalShortcut ${row.accel} failed`);
    } else {
      console.log(`[ap-pos] globalShortcut ${row.accel} ok`);
    }
  }
  if (!f11Ok) {
    console.warn(
      "[ap-pos] F11 เปล่าถูก macOS แย่ง (Show Desktop) — ใช้ Ctrl+F11 หรือไปปิด Show Desktop ที่ System Settings → Keyboard → Keyboard Shortcuts → Mission Control",
    );
  }
}

function unregisterDarwinStolenKeys() {
  for (const row of DARWIN_PAY_ACCELS) {
    try {
      globalShortcut.unregister(row.accel);
    } catch {
      /* ignore */
    }
  }
}

/**
 * Windows: ดัก F9–F12 ใน before-input-event
 * macOS: ใช้ globalShortcut เป็นหลัก (OS กลืน F11 ก่อนถึง here)
 */
function attachPosHotkeyHooks(win: BrowserWindow) {
  win.webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown") return;
    if (input.isAutoRepeat) return;

    const hit = ["F9", "F10", "F11", "F12"].find((k) => isFnKey(input, k));
    if (!hit) return;
    // Shift+Fn ให้ผ่าน (งานรอบ/สรุป)
    if (input.shift) return;

    event.preventDefault();
    sendPosHotkey(win, {
      key: hit,
      code: hit,
      ctrl: Boolean(input.control),
      shift: false,
      alt: Boolean(input.alt),
      meta: Boolean(input.meta),
    });
  });
}

function hardenWindowsChrome(win: BrowserWindow) {
  // Windows: ปิดแถบเมนูให้หมด — ลดโอกาส F10 ไปโฟกัสเมนู
  // คง title bar ไว้เพื่อย่อ/ขยาย/ปิดตอนทดสอบ
  win.setMenu(null);
  win.setMenuBarVisibility(false);
  win.setAutoHideMenuBar(true);
}

function createWindows() {
  setupIpc();
  Menu.setApplicationMenu(null);
  applyDockBranding();

  const primary = screen.getPrimaryDisplay();
  const iconPath = resolveAppIcon();
  const posBounds = defaultPosBounds(primary);

  cashierWindow = new BrowserWindow({
    x: posBounds.x,
    y: posBounds.y,
    width: posBounds.width,
    height: posBounds.height,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    title: `${APP_NAME} — แคชเชียร์`,
    backgroundColor: "#eef2f5",
    frame: true,
    fullscreenable: true,
    minimizable: true,
    maximizable: true,
    resizable: true,
    closable: true,
    autoHideMenuBar: true,
    ...(iconPath ? { icon: iconPath } : {}),
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      spellcheck: false,
    },
  });

  hardenWindowsChrome(cashierWindow);
  blockWindowClose(cashierWindow);
  attachPosHotkeyHooks(cashierWindow);

  cashierWindow.once("ready-to-show", () => {
    if (!cashierWindow || cashierWindow.isDestroyed()) return;
    applyDefaultPosSize(cashierWindow, primary);
    cashierWindow.show();
    cashierWindow.focus();
    if (process.platform === "darwin") registerDarwinStolenKeys();
  });

  loadRoute(cashierWindow, "cashier");

  cashierWindow.on("closed", () => {
    cashierWindow = null;
    // ปิดจอลูกค้าแล้วออกจากแอป — กด X ที่หน้าต่างหลักได้เสมอ
    closeCustomerWindow();
    if (!forceQuit) app.quit();
  });

  // จอลูกค้าเปิดตามตั้งค่าจาก Admin (ค่าเริ่มต้นเปิด)
  setCustomerScreenEnabled(true);
}

/** วางหน้าต่าง 1360×768 กลางพื้นที่ทำงานของจอ */
function defaultPosBounds(display: Electron.Display) {
  const { x, y, width, height } = display.workArea;
  const w = Math.min(POS_DEFAULT_WIDTH, width);
  const h = Math.min(POS_DEFAULT_HEIGHT, height);
  return {
    x: Math.round(x + (width - w) / 2),
    y: Math.round(y + (height - h) / 2),
    width: w,
    height: h,
  };
}

function applyDefaultPosSize(
  win: BrowserWindow,
  display: Electron.Display,
) {
  try {
    if (win.isFullScreen()) win.setFullScreen(false);
    if (process.platform === "darwin" && win.isSimpleFullScreen()) {
      win.setSimpleFullScreen(false);
    }
    if (win.isMaximized()) win.unmaximize();
  } catch {
    /* ignore */
  }
  try {
    win.setBounds(defaultPosBounds(display));
  } catch {
    /* ignore */
  }
}

/**
 * ขยายเต็มพื้นที่จอ แต่คง title bar (ย่อ/ขยาย/ปิดได้)
 * — ใช้กับจอลูกค้า / เมื่อต้องการเต็มจอ
 */
function fitWindowToDisplay(
  win: BrowserWindow,
  display: Electron.Display,
) {
  try {
    if (win.isFullScreen()) win.setFullScreen(false);
    if (process.platform === "darwin" && win.isSimpleFullScreen()) {
      win.setSimpleFullScreen(false);
    }
  } catch {
    /* ignore */
  }
  const { x, y, width, height } = display.workArea;
  try {
    win.setBounds({ x, y, width, height });
  } catch {
    /* ignore */
  }
  if (!win.isMaximized()) win.maximize();
}

function ensureCustomerWindow(): BrowserWindow | null {
  const target = resolveCustomerDisplay();
  if (!target) {
    closeCustomerWindow();
    return null;
  }

  if (customerWindow && !customerWindow.isDestroyed()) {
    fitWindowToDisplay(customerWindow, target);
    return customerWindow;
  }

  const iconPath = resolveAppIcon();
  customerWindow = new BrowserWindow({
    x: target.workArea.x,
    y: target.workArea.y,
    width: target.workArea.width,
    height: target.workArea.height,
    show: false,
    focusable: true,
    title: `${APP_NAME} — จอลูกค้า`,
    backgroundColor: "#fff8f0",
    frame: true,
    fullscreenable: true,
    minimizable: true,
    maximizable: true,
    resizable: true,
    closable: true,
    autoHideMenuBar: true,
    ...(iconPath ? { icon: iconPath } : {}),
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      spellcheck: false,
    },
  });

  hardenWindowsChrome(customerWindow);
  blockWindowClose(customerWindow);
  customerWindow.setClosable(true);

  customerWindow.once("ready-to-show", () => {
    if (!customerWindow || customerWindow.isDestroyed()) return;
    fitWindowToDisplay(customerWindow, target);
    customerWindow.showInactive();
  });
  customerWindow.webContents.on("did-finish-load", () => {
    if (lastCartSnapshot != null) pushCartToCustomer(lastCartSnapshot);
    if (lastSettingsSnapshot != null) {
      pushSettingsToCustomer(lastSettingsSnapshot);
    }
  });
  loadRoute(customerWindow, "customer");
  customerWindow.on("closed", () => {
    customerWindow = null;
  });
  return customerWindow;
}

/** มีจอที่ไม่ใช่จอหลัก (จอ 2) ต่ออยู่จริงหรือไม่ */
function hasSecondaryDisplay(): boolean {
  const displays = screen.getAllDisplays();
  if (displays.length < 2) return false;
  const primary = screen.getPrimaryDisplay();
  return displays.some((d) => d.id !== primary.id);
}

/** จอสำหรับลูกค้า — ต้องเป็นจอที่ไม่ใช่จอหลักเท่านั้น */
function resolveCustomerDisplay(): Electron.Display | null {
  const displays = screen.getAllDisplays();
  const primary = screen.getPrimaryDisplay();
  return displays.find((d) => d.id !== primary.id) ?? null;
}

/** เปิด/ปิดจอลูกค้าตามตั้งค่า + การต่อจอจริง */
function syncCustomerScreen() {
  if (forceQuit || !customerScreenWanted || !hasSecondaryDisplay()) {
    closeCustomerWindow();
    return;
  }
  const target = resolveCustomerDisplay();
  if (!target) {
    closeCustomerWindow();
    return;
  }
  const win = ensureCustomerWindow();
  if (win && !win.isDestroyed()) {
    fitWindowToDisplay(win, target);
    if (!win.isVisible()) win.showInactive();
  }
}

function setCustomerScreenEnabled(enabled: boolean) {
  customerScreenWanted = Boolean(enabled);
  syncCustomerScreen();
}

app.whenReady().then(async () => {
  applyDockBranding();
  mediaCache.initMediaCache();
  try {
    const path = await localDb.getSqlitePath();
    console.log("[ap-pos] SQLite ready:", path);
  } catch (err) {
    console.error("[ap-pos] SQLite init failed — continuing without local DB", err);
  }
  createWindows();
  // เสียบ/ถอดจอ 2 — เปิดหรือปิดจอลูกค้าตามสถานะจริง
  screen.on("display-added", () => syncCustomerScreen());
  screen.on("display-removed", () => syncCustomerScreen());
  screen.on("display-metrics-changed", () => syncCustomerScreen());
  if (process.platform === "darwin") registerDarwinStolenKeys();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindows();
    if (process.platform === "darwin") registerDarwinStolenKeys();
  });
});

app.on("before-quit", (e) => {
  if (!shouldBlockQuit()) return;
  e.preventDefault();
  if (cashierWindow && !cashierWindow.isDestroyed()) {
    cashierWindow.webContents.send("app:close-blocked");
  }
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});

app.on("window-all-closed", () => {
  if (shouldBlockQuit()) return;
  if (process.platform !== "darwin") app.quit();
});
