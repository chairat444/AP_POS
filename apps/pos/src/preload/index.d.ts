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

export type ApPosDbBridge = {
  path: () => Promise<string>;
  device: () => Promise<DeviceConfig>;
  setDevice: (patch: {
    branchId?: string;
    branchName?: string;
    terminalId?: string;
    terminalName?: string;
    setupDone?: boolean;
  }) => Promise<DeviceConfig>;
  replaceDevice: (config: DeviceConfig) => Promise<DeviceConfig>;
  listProducts: () => Promise<LocalProduct[]>;
  upsertProducts: (products: LocalProduct[]) => Promise<boolean>;
  removeProducts: (ids: string[]) => Promise<boolean>;
  listMembers: () => Promise<LocalMember[]>;
  upsertMembers: (members: LocalMember[]) => Promise<boolean>;
  removeMembers: (ids: string[]) => Promise<boolean>;
  adjustMemberPoints: (
    id: string,
    delta: number,
  ) => Promise<LocalMember | null>;
  saveSale: (sale: unknown) => Promise<unknown>;
  enqueueShift: (shift: unknown) => Promise<unknown>;
  saveAudit: (audit: unknown) => Promise<unknown>;
  listAuditsByShift: (shiftId: string) => Promise<unknown[]>;
  listOutbox: () => Promise<unknown[]>;
  ackOutbox: (ids: string[]) => Promise<boolean>;
  outboxCount: () => Promise<number>;
  purgeSyncedSales: () => Promise<number>;
  getMeta: (key: string) => Promise<string | null>;
  setMeta: (key: string, value: string) => Promise<boolean>;
};

export type ApPosMediaBridge = {
  /** absolute remote URL → appos-media://... */
  index: () => Promise<Record<string, string>>;
  setApiBase: (url: string) => Promise<boolean>;
  resolve: (url: string) => Promise<string | null>;
  cache: (urls: string[]) => Promise<Record<string, string>>;
};

export type ApPosPrintBridge = {
  receipt: (req: {
    html: string;
    paperWidth: "58mm" | "80mm";
    silent?: boolean;
    deviceName?: string;
  }) => Promise<{ ok: boolean; message?: string }>;
  previewReceipt: (req: {
    html: string;
    paperWidth: "58mm" | "80mm";
    title?: string;
  }) => Promise<{ ok: boolean; message?: string }>;
  listPrinters: () => Promise<{
    printers: Array<{ name: string; isDefault: boolean }>;
  }>;
};

export type ApPosBridge = {
  publishCart(snapshot: CartSnapshot): void;
  getCart(): Promise<CartSnapshot | null>;
  publishSettings(snapshot: unknown): void;
  getSettings(): Promise<unknown>;
  quit(): Promise<boolean>;
  setShiftOpen(open: boolean): void;
  setCustomerScreenEnabled(enabled: boolean): void;
  openExternal(url: string): Promise<{ ok: boolean; message?: string }>;
  onCartUpdate(handler: (snapshot: CartSnapshot) => void): () => void;
  onSettingsUpdate(handler: (snapshot: unknown) => void): () => void;
  onPosHotkey(handler: (payload: PosHotkeyPayload) => void): () => void;
  onCloseBlocked(handler: () => void): () => void;
  media: ApPosMediaBridge;
  print: ApPosPrintBridge;
  db: ApPosDbBridge;
};

declare global {
  interface Window {
    apPos: ApPosBridge;
  }
}

export {};
