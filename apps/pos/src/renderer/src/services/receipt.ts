/** ใบเสร็จ POS — รูปแบบใกล้เคียงสลิปเดิม (เอพี หมูสด) */

export type PaperWidth = "58mm" | "80mm";

export type PrinterConfig = {
  paperWidth: PaperWidth;
  /** พิมพ์อัตโนมัติหลังชำระ */
  autoPrint: boolean;
  /** true = ไม่โชว์ไดอะล็อก */
  silent: boolean;
  /** ชื่อเครื่องพิมพ์ใน OS (จาก Admin) — ว่าง = default */
  printerName: string;
  footerHours: string;
  footerPhones: string;
};

export const DEFAULT_PRINTER_CONFIG: PrinterConfig = {
  paperWidth: "80mm",
  autoPrint: true,
  silent: true,
  printerName: "",
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
};

const PRINTER_META = "printer-config";

export function normalizePrinterConfig(
  raw: Partial<PrinterConfig> | null | undefined,
): PrinterConfig {
  const paperWidth =
    raw?.paperWidth === "58mm" || raw?.paperWidth === "80mm"
      ? raw.paperWidth
      : DEFAULT_PRINTER_CONFIG.paperWidth;
  return {
    paperWidth,
    autoPrint: raw?.autoPrint !== false,
    silent: raw?.silent !== false,
    printerName: String(raw?.printerName ?? "").trim(),
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
  const storeLine = payload.branchName
    ? `${payload.storeName} (${payload.branchName})`
    : payload.storeName;

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
  <div class="center store">${esc(storeLine)}</div>
  ${payload.tagline ? `<div class="center tag">${esc(payload.tagline)}</div>` : ""}
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
  opts?: { silent?: boolean; preview?: boolean; deviceName?: string },
): Promise<{ ok: boolean; message?: string }> {
  if (!window.apPos?.print?.receipt && !window.apPos?.print?.previewReceipt) {
    return { ok: false, message: "ระบบพิมพ์ยังไม่พร้อม" };
  }
  const html = buildReceiptHtml(payload);
  const paperWidth = payload.paperWidth;
  try {
    // เปิดตัวอย่างเฉพาะเมื่อขอ (เช่น silent ปิด) — ค่าเริ่มต้นพิมพ์เงียบ
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
        paperWidth,
        silent: opts?.silent ?? true,
        deviceName,
      });
    } catch (e) {
      // silent พัง — ถ้าเปิดตัวอย่างไว้แล้วยังถือว่าพอใช้
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
