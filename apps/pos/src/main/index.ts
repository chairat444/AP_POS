import { app, BrowserWindow, ipcMain, Menu, screen } from "electron";
import { join } from "node:path";

let cashierWindow: BrowserWindow | null = null;
let customerWindow: BrowserWindow | null = null;
let ipcReady = false;

function setupIpc() {
  if (ipcReady) return;
  ipcReady = true;

  ipcMain.on("cart:update", (_event, snapshot) => {
    if (customerWindow && !customerWindow.isDestroyed()) {
      customerWindow.webContents.send("cart:update", snapshot);
    }
  });
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

function createWindows() {
  setupIpc();
  // ปิดเมนูมาตรฐาน — ไม่ให้ F5 refresh / แย่งคีย์ลัด POS
  Menu.setApplicationMenu(null);

  const displays = screen.getAllDisplays();
  const primary = screen.getPrimaryDisplay();
  const secondary = displays.find((d) => d.id !== primary.id);

  cashierWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    title: "AP POS — แคชเชียร์",
    backgroundColor: "#eef2f5",
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      spellcheck: false,
    },
  });

  customerWindow = new BrowserWindow({
    width: 1024,
    height: 768,
    show: false,
    focusable: true,
    title: "AP POS — จอลูกค้า",
    backgroundColor: "#fff8f0",
    x: secondary ? secondary.bounds.x + 40 : primary.bounds.x + 100,
    y: secondary ? secondary.bounds.y + 40 : primary.bounds.y + 100,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      spellcheck: false,
    },
  });

  cashierWindow.once("ready-to-show", () => {
    cashierWindow?.show();
    cashierWindow?.focus();
  });

  customerWindow.once("ready-to-show", () => {
    customerWindow?.showInactive();
  });

  loadRoute(cashierWindow, "cashier");
  loadRoute(customerWindow, "customer");

  cashierWindow.on("closed", () => {
    cashierWindow = null;
  });
  customerWindow.on("closed", () => {
    customerWindow = null;
  });
}

app.whenReady().then(() => {
  createWindows();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindows();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
