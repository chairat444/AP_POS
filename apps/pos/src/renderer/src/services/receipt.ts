/** ใบเสร็จ POS — รูปแบบใกล้เคียงสลิปเดิม (เอพี หมูสด) */

export type PaperWidth = "58mm" | "80mm";

export type PrinterConfig = {
  paperWidth: PaperWidth;
  /** พิมพ์อัตโนมัติหลังชำระ */
  autoPrint: boolean;
  /** true = ไม่โชว์ไดอะล็อก (fallback Electron) */
  silent: boolean;
  /** ชื่อเครื่องพิมพ์ใน OS — ว่าง = เดา XP-58 */
  printerName: string;
  /** เตะลิ้นชักตอนพิมพ์ */
  openDrawer: boolean;
  /**
   * ข้อความหัวกระดาษ (หลายบรรทัดได้)
   * ว่าง = ใช้ชื่อร้าน + สาขา + คำโปรยจากตั้งค่าร้าน
   */
  headerText: string;
  footerHours: string;
  footerPhones: string;
};

export const DEFAULT_PRINTER_CONFIG: PrinterConfig = {
  paperWidth: "58mm",
  autoPrint: true,
  silent: true,
  printerName: "",
  openDrawer: true,
  /** {สาขา} = ชื่อสาขาเครื่องตอนพิมพ์ */
  headerText: "เอพี หมูสด ({สาขา})\nมาตรฐาน สะอาด ปลอดภัย",
  footerHours: "เปิดบริการทุกวัน 09.00 - 20.00 น.",
  footerPhones: "ติดต่อ 084 912 3509, 092 494 5442",
};

export type ReceiptLine = {
  name: string;
  qty: number;
  unit: string;
  unitPrice: number;
  lineTotal: number;
  discount?: number;
  /** แสดงบรรทัดโปร เช่น "สินค้า 35 บ. 3 แพ็ค 100บ." */
  promoHint?: string | null;
};

export type ReceiptPayment = {
  method: string;
  label: string;
  amount: number;
};

export type ReceiptPromo = {
  label: string;
  discount: number;
};

export type ReceiptPayload = {
  storeName: string;
  branchName: string;
  tagline: string;
  /** หัวกระดาษกำหนดเอง (หลายบรรทัด) — ถ้าว่างใช้ store/branch/tagline */
  headerText?: string;
  billNo: string;
  at: string;
  lines: ReceiptLine[];
  itemCount: number;
  subtotal: number;
  /** ส่วนลดโปรรวม */
  promoDiscount: number;
  promos: ReceiptPromo[];
  /** ส่วนลดแต้ม (บาท) */
  pointsDiscount: number;
  total: number;
  payments: ReceiptPayment[];
  change: number;
  memberCode?: string | null;
  memberName?: string | null;
  pointsEarned?: number;
  pointsBalance?: number;
  paperWidth: PaperWidth;
  footerHours: string;
  footerPhones: string;
  appVersion: string;
  /** URL โลโก้ร้าน (resolve เป็น data URL ตอนพิมพ์) */
  logoUrl?: string | null;
  /** data URL พร้อมใช้ใน HTML / ส่ง main */
  logoDataUrl?: string | null;
};

const PRINTER_META = "printer-config";

export function normalizePrinterConfig(
  raw: Partial<PrinterConfig> | null | undefined,
): PrinterConfig {
  const paperWidth =
    raw?.paperWidth === "58mm" || raw?.paperWidth === "80mm"
      ? raw.paperWidth
      : DEFAULT_PRINTER_CONFIG.paperWidth;
  const headerRaw = raw?.headerText;
  let headerText =
    headerRaw === undefined || headerRaw === null
      ? DEFAULT_PRINTER_CONFIG.headerText
      : String(headerRaw).replace(/\r\n/g, "\n").trimEnd();
  // อัปเกรดค่าเก่าที่ไม่มีชื่อสาขา
  if (
    !headerText ||
    headerText === "AP หมูสด\nมาตรฐาน สะอาด ปลอดภัย" ||
    headerText === "เอพี หมูสด\nมาตรฐาน สะอาด ปลอดภัย"
  ) {
    headerText = DEFAULT_PRINTER_CONFIG.headerText;
  }
  return {
    paperWidth,
    autoPrint: raw?.autoPrint !== false,
    silent: raw?.silent !== false,
    printerName: String(raw?.printerName ?? "").trim(),
    openDrawer: raw?.openDrawer !== false,
    headerText,
    footerHours:
      String(raw?.footerHours ?? "").trim() ||
      DEFAULT_PRINTER_CONFIG.footerHours,
    footerPhones:
      String(raw?.footerPhones ?? "").trim() ||
      DEFAULT_PRINTER_CONFIG.footerPhones,
  };
}

export async function loadPrinterConfig(): Promise<PrinterConfig> {
  try {
    const raw = await window.apPos?.db?.getMeta?.(PRINTER_META);
    if (raw) {
      return normalizePrinterConfig(JSON.parse(raw) as Partial<PrinterConfig>);
    }
  } catch {
    /* ignore */
  }
  return { ...DEFAULT_PRINTER_CONFIG };
}

export async function savePrinterConfig(
  patch: Partial<PrinterConfig>,
): Promise<PrinterConfig> {
  const current = await loadPrinterConfig();
  const next = normalizePrinterConfig({ ...current, ...patch });
  await window.apPos?.db?.setMeta?.(PRINTER_META, JSON.stringify(next));
  return next;
}

export function paymentLabel(method: string): string {
  switch (method) {
    case "cash":
      return "เงินสด";
    case "transfer":
      return "โอน";
    case "government":
      return "สวัสดิการแห่งรัฐ";
    default:
      return method;
  }
}

function money(n: number) {
  return n.toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function moneyPlain(n: number) {
  return Number(n).toFixed(2);
}

function chars(s: string) {
  return Array.from(String(s ?? ""));
}

function clip(s: string, max: number) {
  const a = chars(s);
  if (a.length <= max) return a.join("");
  if (max <= 1) return a.slice(0, max).join("");
  return `${a.slice(0, max - 1).join("")}…`;
}

function padCenter(s: string, width: number) {
  const a = chars(s);
  if (a.length >= width) return a.slice(0, width).join("");
  const left = Math.floor((width - a.length) / 2);
  return `${" ".repeat(left)}${a.join("")}`;
}

function pairLine(left: string, right: string, width: number) {
  const r = chars(right).join("");
  const maxL = Math.max(0, width - r.length - 1);
  const l = clip(left, maxL);
  const gap = Math.max(1, width - chars(l).length - r.length);
  return `${l}${" ".repeat(gap)}${r}`;
}

function dashLine(width: number) {
  return "-".repeat(width);
}

/** แถวสลิปสำหรับจัดซ้าย/กลาง/ขวาตอนพิมพ์ GDI */
export type ReceiptRow =
  | { a: "c"; t: string }
  | { a: "l"; t: string }
  | { a: "lr"; l: string; r: string }
  | { a: "s" };

function formatThaiDateTimePlain(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${dd}/${mm}/${yyyy} ${hh}:${mi}`;
}

function formatThaiDatePlain(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

/** แทนที่ {สาขา} ด้วยชื่อสาขาเครื่อง */
function expandHeaderLines(
  headerText: string | undefined,
  payload: Pick<ReceiptPayload, "storeName" | "branchName" | "tagline">,
): string[] {
  const branch = String(payload.branchName ?? "").trim();
  const custom = String(headerText ?? "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((line) => {
      let t = line;
      if (!branch) {
        t = t
          .replace(/\s*\(\s*\{สาขา\}\s*\)/g, "")
          .replace(/\s*\(\s*\{branch\}\s*\)/g, "");
      }
      t = t
        .replaceAll("{สาขา}", branch)
        .replaceAll("{branch}", branch)
        .replace(/\(\s*\)/g, "")
        .replace(/[ \t]{2,}/g, " ")
        .trim();
      return t;
    })
    .filter(Boolean);

  if (custom.length) return custom;

  const storeLine = branch
    ? `${payload.storeName} (${branch})`
    : payload.storeName;
  const lines = [storeLine];
  if (payload.tagline) lines.push(payload.tagline);
  return lines;
}

/** โครงสลิป — ซ้าย / กลาง / ขวา (ตัวเลขอยู่ขวา) */
export function buildReceiptRows(payload: ReceiptPayload): ReceiptRow[] {
  const when = formatThaiDateTimePlain(payload.at);
  const day = formatThaiDatePlain(payload.at);
  const rows: ReceiptRow[] = [];

  for (const h of expandHeaderLines(payload.headerText, payload)) {
    rows.push({ a: "c", t: h });
  }
  rows.push({ a: "s" });
  rows.push({ a: "lr", l: "บิล", r: payload.billNo });
  rows.push({ a: "lr", l: "วันที่", r: when });
  rows.push({ a: "s" });

  for (const line of payload.lines) {
    rows.push({ a: "lr", l: line.name, r: moneyPlain(line.lineTotal) });
    if (line.qty !== 1 || line.promoHint) {
      rows.push({
        a: "l",
        t: `  ${Number(line.qty).toFixed(2)} x ${moneyPlain(line.unitPrice)}`,
      });
    }
    if (line.promoHint) rows.push({ a: "l", t: `  ${line.promoHint}` });
    if (line.discount && line.discount > 0) {
      rows.push({
        a: "lr",
        l: "  ลดรายการ",
        r: `-${moneyPlain(line.discount)}`,
      });
    }
  }

  rows.push({ a: "s" });
  rows.push({
    a: "lr",
    l: `รายการ ${payload.itemCount}`,
    r: moneyPlain(payload.subtotal),
  });

  for (const p of payload.promos) {
    if (p.discount > 0) {
      rows.push({
        a: "lr",
        l: `โปร (${p.label})`,
        r: `-${moneyPlain(p.discount)}`,
      });
    }
  }
  if (payload.pointsDiscount > 0) {
    rows.push({
      a: "lr",
      l: "ส่วนลดแต้ม",
      r: `-${moneyPlain(payload.pointsDiscount)}`,
    });
  }
  rows.push({ a: "lr", l: "รวมทั้งสิ้น", r: moneyPlain(payload.total) });
  rows.push({ a: "s" });

  for (const p of payload.payments) {
    rows.push({ a: "lr", l: p.label, r: moneyPlain(p.amount) });
  }
  if (payload.change > 0) {
    rows.push({ a: "lr", l: "เงินทอน", r: moneyPlain(payload.change) });
  }

  if (
    payload.memberCode ||
    (payload.memberName && payload.memberName !== "ลูกค้าทั่วไป")
  ) {
    rows.push({ a: "s" });
    rows.push({
      a: "l",
      t: `สมาชิก ${payload.memberCode || ""} ${payload.memberName || ""}`.trim(),
    });
    if ((payload.pointsEarned ?? 0) > 0) {
      rows.push({
        a: "lr",
        l: `ได้แต้ม(${day})`,
        r: `${payload.pointsEarned} P`,
      });
    }
    rows.push({
      a: "lr",
      l: `แต้มคงเหลือ(${day})`,
      r: `${payload.pointsBalance ?? 0} P`,
    });
  }

  rows.push({ a: "s" });
  rows.push({ a: "c", t: "ขอบคุณที่ใช้บริการ" });
  if (payload.footerHours) rows.push({ a: "c", t: payload.footerHours });
  if (payload.footerPhones) rows.push({ a: "c", t: payload.footerPhones });
  if (payload.appVersion) rows.push({ a: "c", t: payload.appVersion });
  return rows;
}

/** payload สำหรับไดรเวอร์ — บรรทัดง่าย (ไม่ใช้ JSON ที่ PowerShell พังง่าย) */
export function buildReceiptPrintPayload(payload: ReceiptPayload): string {
  const esc = (s: string) =>
    String(s ?? "")
      .replace(/\r\n|\r|\n/g, " ")
      .replace(/\t/g, " ");
  const lines: string[] = ["APSLIP2"];
  for (const row of buildReceiptRows(payload)) {
    if (row.a === "s") lines.push("S");
    else if (row.a === "c") lines.push(`C\t${esc(row.t)}`);
    else if (row.a === "l") lines.push(`L\t${esc(row.t)}`);
    else lines.push(`LR\t${esc(row.l)}\t${esc(row.r)}`);
  }
  return lines.join("\n");
}

/** สลิปข้อความ (พรีวิว / fallback) */
export function buildReceiptText(
  payload: ReceiptPayload,
  opts?: { cols?: number },
): string {
  const width =
    opts?.cols ?? (payload.paperWidth === "58mm" ? 32 : 42);
  return buildReceiptRows(payload)
    .map((row) => {
      if (row.a === "s") return dashLine(width);
      if (row.a === "c") return padCenter(clip(row.t, width), width);
      if (row.a === "l") return clip(row.t, width);
      return pairLine(row.l, row.r, width);
    })
    .join("\n");
}

function esc(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatThaiDateTime(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${dd}/${mm}/${yyyy} ${hh}:${mi}:${ss}`;
}

function formatThaiDate(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

/** สร้าง HTML สลิป — ความกว้างตามกระดาษ */
export function buildReceiptHtml(payload: ReceiptPayload): string {
  const w = payload.paperWidth === "58mm" ? "58mm" : "80mm";
  const maxCss = payload.paperWidth === "58mm" ? "52mm" : "72mm";
  const fontSize = payload.paperWidth === "58mm" ? "11px" : "13px";
  const titleSize = payload.paperWidth === "58mm" ? "14px" : "16px";
  const when = formatThaiDateTime(payload.at);
  const day = formatThaiDate(payload.at);
  const headerLines = expandHeaderLines(payload.headerText, payload);
  const headerHtml = headerLines
    .map(
      (h, i) =>
        `<div class="center ${i === 0 ? "store" : "tag"}">${esc(h)}</div>`,
    )
    .join("");

  const lineRows = payload.lines
    .map((l) => {
      const hint = l.promoHint
        ? `<div class="hint">${esc(l.promoHint)}</div>`
        : "";
      const detail =
        l.qty !== 1 || l.promoHint
          ? `<div class="detail">${Number(l.qty).toFixed(2)} x ${money(l.unitPrice)}</div>`
          : "";
      const disc =
        l.discount && l.discount > 0
          ? `<div class="disc">ลดรายการ -${money(l.discount)}</div>`
          : "";
      return `<div class="row item">
        <div class="left">
          <div class="name">${esc(l.name)}</div>
          ${hint}${detail}${disc}
        </div>
        <div class="right">${money(l.lineTotal)}</div>
      </div>`;
    })
    .join("");

  const promoRows = payload.promos
    .filter((p) => p.discount > 0)
    .map(
      (p) => `<div class="row">
        <div class="left">โปรโมชั่น (${esc(p.label)})</div>
        <div class="right">-${money(p.discount)}</div>
      </div>`,
    )
    .join("");

  const pointsDiscRow =
    payload.pointsDiscount > 0
      ? `<div class="row">
        <div class="left">ส่วนลดแต้ม</div>
        <div class="right">-${money(payload.pointsDiscount)}</div>
      </div>`
      : "";

  const payRows = payload.payments
    .map(
      (p) => `<div class="row">
        <div class="left">${esc(p.label)}</div>
        <div class="right">${money(p.amount)}</div>
      </div>`,
    )
    .join("");

  const changeRow =
    payload.change > 0
      ? `<div class="row">
        <div class="left">เงินทอน</div>
        <div class="right">${money(payload.change)}</div>
      </div>`
      : "";

  const memberBlock =
    payload.memberCode ||
    (payload.memberName && payload.memberName !== "ลูกค้าทั่วไป")
      ? `<div class="member">
        <div>สมาชิก ${esc(payload.memberCode || "")} ${esc(payload.memberName || "")}</div>
        ${
          (payload.pointsEarned ?? 0) > 0
            ? `<div class="row tight"><span>ได้รับแต้ม(${day})</span><span>${payload.pointsEarned} P</span></div>`
            : ""
        }
        <div class="row tight"><span>แต้มสะสมคงเหลือ (วันที่${day})</span><span>${payload.pointsBalance ?? 0} P</span></div>
      </div>`
      : "";

  return `<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="utf-8" />
<title>ใบเสร็จ ${esc(payload.billNo)}</title>
<style>
  @page { size: ${w} auto; margin: 2mm; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: "Courier New", "Saraban", "Tahoma", monospace;
    font-size: ${fontSize};
    color: #000;
    width: ${maxCss};
    max-width: 100%;
    margin: 0 auto;
    line-height: 1.35;
  }
  .center { text-align: center; }
  .store { font-size: ${titleSize}; font-weight: 800; margin-bottom: 2px; }
  .tag { margin-bottom: 6px; }
  .meta { margin-bottom: 8px; }
  .row {
    display: flex;
    justify-content: space-between;
    gap: 6px;
    align-items: flex-start;
    margin: 2px 0;
  }
  .row.tight { margin: 1px 0; }
  .left { flex: 1; min-width: 0; word-break: break-word; }
  .right { flex: 0 0 auto; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .name { font-weight: 600; }
  .hint, .detail, .disc { opacity: 0.92; font-size: 0.92em; }
  .disc { color: #000; }
  .item { margin: 4px 0; }
  .sep { border: none; border-top: 1px dashed #000; margin: 8px 0; }
  .total .right { font-weight: 800; font-size: 1.15em; }
  .member { margin-top: 8px; }
  .foot { margin-top: 10px; text-align: center; }
  .foot .thanks { font-weight: 700; margin-bottom: 4px; }
  .ver { margin-top: 6px; opacity: 0.85; font-size: 0.9em; }
</style>
</head>
<body>
  ${headerHtml}
  <div class="center meta">
    <div>${esc(payload.billNo)}</div>
    <div>${esc(when)}</div>
  </div>

  ${lineRows}

  <hr class="sep" />

  <div class="row">
    <div class="left">จำนวนสินค้ารวม ${payload.itemCount} รายการ</div>
    <div class="right">${money(payload.subtotal)}</div>
  </div>
  ${promoRows}
  ${pointsDiscRow}
  <div class="row total">
    <div class="left">ยอดรวม</div>
    <div class="right">${money(payload.total)}</div>
  </div>

  <hr class="sep" />

  ${payRows}
  ${changeRow}

  ${memberBlock}

  <div class="foot">
    <div class="thanks">***** ขอบคุณที่ใช้บริการ ${esc(payload.storeName)} *****</div>
    <div>${esc(payload.footerHours)}</div>
    <div>${esc(payload.footerPhones)}</div>
    <div class="ver">${esc(payload.appVersion)}</div>
  </div>
</body>
</html>`;
}

export async function printReceipt(
  payload: ReceiptPayload,
  opts?: {
    silent?: boolean;
    preview?: boolean;
    deviceName?: string;
    openDrawer?: boolean;
  },
): Promise<{ ok: boolean; message?: string }> {
  if (!window.apPos?.print?.receipt && !window.apPos?.print?.previewReceipt) {
    return { ok: false, message: "ระบบพิมพ์ยังไม่พร้อม" };
  }
  // ไม่พิมพ์โลโก้บนใบเสร็จ (ข้อความหัวบิลอย่างเดียว)
  const printable: ReceiptPayload = { ...payload, logoDataUrl: null };
  const html = buildReceiptHtml(printable);
  const text = buildReceiptPrintPayload(printable);
  const paperWidth = payload.paperWidth;
  try {
    const wantPreview = opts?.preview === true;
    if (wantPreview && window.apPos.print?.previewReceipt) {
      const prev = await window.apPos.print.previewReceipt({ html, paperWidth });
      if (!prev.ok) {
        return prev;
      }
    }
    if (!window.apPos.print?.receipt) {
      return wantPreview
        ? { ok: true }
        : { ok: false, message: "ระบบพิมพ์ยังไม่พร้อม" };
    }
    try {
      const printer = await loadPrinterConfig();
      const deviceName =
        String(opts?.deviceName ?? printer.printerName ?? "").trim() ||
        undefined;
      return await window.apPos.print.receipt({
        html,
        text,
        paperWidth,
        silent: opts?.silent ?? true,
        deviceName,
        openDrawer: opts?.openDrawer ?? printer.openDrawer,
      });
    } catch (e) {
      return {
        ok: wantPreview,
        message: e instanceof Error ? e.message : undefined,
      };
    }
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "พิมพ์ไม่สำเร็จ",
    };
  }
}
