export type PaperWidth = "58mm" | "80mm";

export type TerminalRecord = {
  id: string;
  code: string;
  name: string;
  branchId: string;
  active: boolean;
  paperWidth: PaperWidth;
  autoPrint: boolean;
  printSilent: boolean;
  /** ชื่อเครื่องพิมพ์ใน OS ของเครื่อง POS นั้น (เช่น XP-80C) */
  printerName: string | null;
  receiptFooterHours: string | null;
  receiptFooterPhones: string | null;
  lastSeenAt: string | null;
  updatedAt: string;
};

export type UpsertTerminalDto = {
  code?: string;
  name: string;
  branchId: string;
  active?: boolean;
  paperWidth?: PaperWidth;
  autoPrint?: boolean;
  printSilent?: boolean;
  printerName?: string | null;
  receiptFooterHours?: string | null;
  receiptFooterPhones?: string | null;
};

export type RegisterTerminalDto = {
  id?: string;
  code?: string;
  name: string;
  branchId: string;
};

export type ClaimTerminalDto = {
  id: string;
  branchId: string;
};

export function normalizePaperWidth(v: unknown): PaperWidth {
  return v === "58mm" ? "58mm" : "80mm";
}
