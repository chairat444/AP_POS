import { contextBridge, ipcRenderer } from "electron";
import type { CartSnapshot } from "@ap-pos/shared";

export type PosHotkeyPayload = {
  key: string;
  code: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  meta?: boolean;
};

export type LocalProduct = {
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
  updatedAt: string;
};

export type LocalMember = {
  id: string;
  code: string;
  name: string;
  phone?: string | null;
  points: number;
  updatedAt: string;
};

export type DeviceConfig = {
  branchId: string;
  branchName: string;
  terminalId: string;
  terminalName?: string;
  setupDone?: boolean;
};

contextBridge.exposeInMainWorld("apPos", {
  publishCart(snapshot: CartSnapshot) {
    ipcRenderer.send("cart:update", snapshot);
  },
  getCart() {
    return ipcRenderer.invoke("cart:get") as Promise<CartSnapshot | null>;
  },
  publishSettings(snapshot: unknown) {
    ipcRenderer.send("settings:update", snapshot);
  },
  getSettings() {
    return ipcRenderer.invoke("settings:get") as Promise<unknown>;
  },
  quit() {
    // ส่งทั้ง invoke และ send — กันเคส handler ค้างแล้วปิดไม่ได้
    void ipcRenderer.invoke("app:quit").catch(() => undefined);
    ipcRenderer.send("app:quit");
    return Promise.resolve(true);
  },
  setShiftOpen(open: boolean) {
    ipcRenderer.send("app:shift-open", open);
  },
  setCustomerScreenEnabled(enabled: boolean) {
    ipcRenderer.send("app:customer-screen", enabled);
  },
  openExternal(url: string) {
    return ipcRenderer.invoke("shell:open-external", url) as Promise<{
      ok: boolean;
      message?: string;
    }>;
  },
  onCartUpdate(handler: (snapshot: CartSnapshot) => void) {
    const listener = (_: unknown, snapshot: CartSnapshot) => handler(snapshot);
    ipcRenderer.on("cart:update", listener);
    return () => ipcRenderer.removeListener("cart:update", listener);
  },
  onSettingsUpdate(handler: (snapshot: unknown) => void) {
    const listener = (_: unknown, snapshot: unknown) => handler(snapshot);
    ipcRenderer.on("settings:update", listener);
    return () => ipcRenderer.removeListener("settings:update", listener);
  },
  onPosHotkey(handler: (payload: PosHotkeyPayload) => void) {
    const listener = (_: unknown, payload: PosHotkeyPayload) => handler(payload);
    ipcRenderer.on("pos:hotkey", listener);
    return () => ipcRenderer.removeListener("pos:hotkey", listener);
  },
  onCloseBlocked(handler: () => void) {
    const listener = () => handler();
    ipcRenderer.on("app:close-blocked", listener);
    return () => ipcRenderer.removeListener("app:close-blocked", listener);
  },
  media: {
    index: () =>
      ipcRenderer.invoke("media:index") as Promise<Record<string, string>>,
    setApiBase: (url: string) =>
      ipcRenderer.invoke("media:set-api-base", url) as Promise<boolean>,
    resolve: (url: string) =>
      ipcRenderer.invoke("media:resolve", url) as Promise<string | null>,
    cache: (urls: string[]) =>
      ipcRenderer.invoke("media:cache", urls) as Promise<Record<string, string>>,
  },
  print: {
    receipt: (req: {
      html: string;
      paperWidth: "58mm" | "80mm";
      silent?: boolean;
      deviceName?: string;
    }) =>
      ipcRenderer.invoke("receipt:print", req) as Promise<{
        ok: boolean;
        message?: string;
      }>,
    previewReceipt: (req: {
      html: string;
      paperWidth: "58mm" | "80mm";
      title?: string;
    }) =>
      ipcRenderer.invoke("receipt:preview", req) as Promise<{
        ok: boolean;
        message?: string;
      }>,
    listPrinters: () =>
      ipcRenderer.invoke("printers:list") as Promise<{
        printers: Array<{ name: string; isDefault: boolean }>;
      }>,
  },
  db: {
    path: () => ipcRenderer.invoke("db:path") as Promise<string>,
    device: () => ipcRenderer.invoke("db:device") as Promise<DeviceConfig>,
    setDevice: (patch: {
      branchId?: string;
      branchName?: string;
      terminalId?: string;
      terminalName?: string;
      setupDone?: boolean;
    }) => ipcRenderer.invoke("db:device:set", patch) as Promise<DeviceConfig>,
    replaceDevice: (config: DeviceConfig) =>
      ipcRenderer.invoke("db:device:replace", config) as Promise<DeviceConfig>,
    listProducts: () =>
      ipcRenderer.invoke("db:products:list") as Promise<LocalProduct[]>,
    upsertProducts: (products: LocalProduct[]) =>
      ipcRenderer.invoke("db:products:upsert", products) as Promise<boolean>,
    removeProducts: (ids: string[]) =>
      ipcRenderer.invoke("db:products:remove", ids) as Promise<boolean>,
    listMembers: () =>
      ipcRenderer.invoke("db:members:list") as Promise<LocalMember[]>,
    upsertMembers: (members: LocalMember[]) =>
      ipcRenderer.invoke("db:members:upsert", members) as Promise<boolean>,
    removeMembers: (ids: string[]) =>
      ipcRenderer.invoke("db:members:remove", ids) as Promise<boolean>,
    adjustMemberPoints: (id: string, delta: number) =>
      ipcRenderer.invoke("db:members:adjustPoints", id, delta) as Promise<LocalMember | null>,
    saveSale: (sale: unknown) =>
      ipcRenderer.invoke("db:sale:save", sale) as Promise<unknown>,
    enqueueShift: (shift: unknown) =>
      ipcRenderer.invoke("db:shift:enqueue", shift) as Promise<unknown>,
    saveAudit: (audit: unknown) =>
      ipcRenderer.invoke("db:audit:save", audit) as Promise<unknown>,
    listAuditsByShift: (shiftId: string) =>
      ipcRenderer.invoke("db:audit:listByShift", shiftId) as Promise<unknown[]>,
    listOutbox: () => ipcRenderer.invoke("db:outbox:list") as Promise<unknown[]>,
    ackOutbox: (ids: string[]) =>
      ipcRenderer.invoke("db:outbox:ack", ids) as Promise<boolean>,
    outboxCount: () =>
      ipcRenderer.invoke("db:outbox:count") as Promise<number>,
    purgeSyncedSales: () =>
      ipcRenderer.invoke("db:sales:purgeSynced") as Promise<number>,
    getMeta: (key: string) =>
      ipcRenderer.invoke("db:meta:get", key) as Promise<string | null>,
    setMeta: (key: string, value: string) =>
      ipcRenderer.invoke("db:meta:set", key, value) as Promise<boolean>,
  },
});
