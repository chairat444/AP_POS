/** ใบปิดรอบการขาย (Z-report) — สลิปร้อน 58/80 มม. */

import type { CommissionResult } from "@ap-pos/shared";
import {
  loadPrinterConfig,
  type PaperWidth,
  type PrinterConfig,
} from "./receipt";
import { getAppVersionLabel } from "../utils/format";

export type ShiftCloseMove = {
  at: string;
  direction: "in" | "out";
  amount: number;
  reason: string;
};

export type ShiftCloseDenom = {
  denom: number;
  qty: number;
};

export type ShiftCloseReportPayload = {
  storeName: string;
  branchName: string;
  terminalName: string;
  tagline?: string;
  staffName: string;
  openedAt: string;
  closedAt: string;
  openCash: number;
  floatCounted: boolean;
  billCount: number;
  grossTotal: number;
  byMethod: {
    cash: number;
    transfer: number;
    government: number;
    points: number;
  };
  cashTendered: number;
  cashChange: number;
  cashInTotal: number;
  cashOutTotal: number;
  expectedCash: number;
  closeCash: number | null;
  variance: number | null;
  closeNote: string;
  pointsRedeemed: number;
  pointsEarned: number;
  voidLineCount: number;
  voidLineAmount: number;
  voidBillCount: number;
  voidBillAmount: number;
  cashMoves: ShiftCloseMove[];
  closeDenoms: ShiftCloseDenom[];
  commission: CommissionResult | null;
  paperWidth: PaperWidth;
  appVersion: string;
};

function money(n: number, digits = 2) {
  return n.toLocaleString("th-TH", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function money0(n: number) {
  return money(n, 0);
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
  return `${dd}/${mm}/${yyyy} ${hh}:${mi}`;
}

function signed(n: number, digits = 0) {
  const body = money(Math.abs(n), digits);
  if (n > 0) return `+${body}`;
  if (n < 0) return `-${body}`;
  return body;
}

function row(left: string, right: string, cls = "") {
  return `<div class="row ${cls}"><div class="left">${left}</div><div class="right">${right}</div></div>`;
}

function section(title: string) {
  return `<div class="sec">${esc(title)}</div>`;
}

/** สร้าง HTML ใบปิดรอบ */
export function buildShiftCloseHtml(payload: ShiftCloseReportPayload): string {
  const w = payload.paperWidth === "58mm" ? "58mm" : "80mm";
  const maxCss = payload.paperWidth === "58mm" ? "52mm" : "72mm";
  const fontSize = payload.paperWidth === "58mm" ? "11px" : "13px";
  const titleSize = payload.paperWidth === "58mm" ? "14px" : "16px";
  const storeLine = payload.branchName
    ? `${payload.storeName} (${payload.branchName})`
    : payload.storeName;

  const methodRows = [
    row("เงินสด", money(payload.byMethod.cash)),
    row("เงินโอน", money(payload.byMethod.transfer)),
    row("สวัสดิการ", money(payload.byMethod.government)),
    payload.byMethod.points > 0
      ? row("ส่วนลดแต้ม (ยอด)", money(payload.byMethod.points))
      : "",
  ]
    .filter(Boolean)
    .join("");

  const drawerRows = [
    row(
      "เงินทอนเริ่ม",
      payload.floatCounted ? money0(payload.openCash) : "ยังไม่นับ",
    ),
    row("ขายเงินสด", `+${money0(payload.byMethod.cash)}`),
    payload.cashInTotal > 0
      ? row("นำเงินเข้า", `+${money0(payload.cashInTotal)}`)
      : "",
    payload.cashOutTotal > 0
      ? row("นำเงินออก", `-${money0(payload.cashOutTotal)}`)
      : "",
    row("คาดในลิ้นชัก", money0(payload.expectedCash), "em"),
    payload.closeCash != null
      ? row("นับได้จริง", money0(payload.closeCash), "em")
      : row("นับได้จริง", "ไม่ได้นับ"),
    payload.variance != null
      ? row(
          "ส่วนต่าง",
          signed(payload.variance, 0),
          payload.variance === 0 ? "ok" : "warn",
        )
      : "",
  ]
    .filter(Boolean)
    .join("");

  const denomRows = payload.closeDenoms
    .filter((d) => d.qty > 0)
    .map((d) =>
      row(
        `${money0(d.denom)} × ${d.qty}`,
        money0(d.denom * d.qty),
      ),
    )
    .join("");

  const moveRows = payload.cashMoves
    .map((m) => {
      const sign = m.direction === "out" ? "-" : "+";
      return row(
        `${formatThaiDateTime(m.at)} ${m.direction === "out" ? "ออก" : "เข้า"} ${esc(m.reason)}`,
        `${sign}${money0(m.amount)}`,
      );
    })
    .join("");

  const voidBlock =
    payload.voidLineCount > 0 || payload.voidBillCount > 0
      ? `${section("ยกเลิก / โมฆะ")}
        ${row(`รายการ ${payload.voidLineCount} ครั้ง`, money0(payload.voidLineAmount))}
        ${row(`บิล ${payload.voidBillCount} ครั้ง`, money0(payload.voidBillAmount))}`
      : "";

  const commissionBlock =
    payload.commission?.enabled
      ? `${section("ค่าคอมมิชชั่นวันนี้")}
        ${row("ยอดขายวันนี้", money(payload.commission.daySales))}
        ${row("ได้คอม", money0(payload.commission.amount), "em")}
        ${
          payload.commission.steps > 0
            ? row("จำนวนขั้น", String(payload.commission.steps))
            : ""
        }`
      : "";

  const pointsBlock =
    payload.pointsEarned > 0 || payload.pointsRedeemed > 0
      ? `${section("แต้มสมาชิก")}
        ${row("ได้แต้มรวม", String(payload.pointsEarned))}
        ${row("ใช้แต้มรวม", String(payload.pointsRedeemed))}`
      : "";

  const noteBlock = payload.closeNote
    ? `<div class="note">หมายเหตุ: ${esc(payload.closeNote)}</div>`
    : "";

  return `<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="utf-8" />
<title>ใบปิดรอบ ${esc(formatThaiDateTime(payload.closedAt))}</title>
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
  .doc { font-size: ${titleSize}; font-weight: 800; margin: 6px 0 2px; letter-spacing: 0.04em; }
  .tag { margin-bottom: 4px; opacity: 0.9; }
  .meta { margin-bottom: 6px; }
  .meta div { margin: 1px 0; }
  .row {
    display: flex;
    justify-content: space-between;
    gap: 6px;
    align-items: flex-start;
    margin: 2px 0;
  }
  .left { flex: 1; min-width: 0; word-break: break-word; }
  .right { flex: 0 0 auto; font-variant-numeric: tabular-nums; white-space: nowrap; text-align: right; }
  .sec {
    margin: 8px 0 4px;
    font-weight: 800;
    border-bottom: 1px solid #000;
    padding-bottom: 2px;
  }
  .sep { border: none; border-top: 1px dashed #000; margin: 8px 0; }
  .em .right { font-weight: 800; }
  .warn .right { font-weight: 800; }
  .ok .right { font-weight: 800; }
  .total .left, .total .right { font-weight: 800; font-size: 1.1em; }
  .note { margin-top: 6px; word-break: break-word; }
  .sign {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
    margin-top: 16px;
    text-align: center;
  }
  .sign .box { padding-top: 28px; border-top: 1px solid #000; font-size: 0.92em; }
  .foot { margin-top: 12px; text-align: center; font-size: 0.9em; opacity: 0.9; }
</style>
</head>
<body>
  <div class="center store">${esc(storeLine)}</div>
  ${payload.tagline ? `<div class="center tag">${esc(payload.tagline)}</div>` : ""}
  <div class="center doc">*** ใบปิดรอบการขาย ***</div>
  <div class="center meta">
    <div>เครื่อง: ${esc(payload.terminalName || "-")}</div>
    <div>พนักงาน: ${esc(payload.staffName)}</div>
    <div>เปิด ${esc(formatThaiDateTime(payload.openedAt))}</div>
    <div>ปิด ${esc(formatThaiDateTime(payload.closedAt))}</div>
  </div>

  <hr class="sep" />

  ${section("สรุปยอดขาย")}
  ${row("จำนวนบิล", String(payload.billCount))}
  ${row("ยอดขายรวม", money(payload.grossTotal), "total")}

  ${section("ช่องทางชำระ")}
  ${methodRows}
  ${
    payload.cashTendered > 0 || payload.cashChange > 0
      ? `${row("รับเงินสด (ทอนเดอร์)", money(payload.cashTendered))}
         ${row("เงินทอนลูกค้า", money(payload.cashChange))}`
      : ""
  }

  ${section("เงินในลิ้นชัก")}
  ${drawerRows}
  ${
    denomRows
      ? `${section("รายละเอียดการนับ")}
         ${denomRows}`
      : ""
  }
  ${noteBlock}

  ${
    moveRows
      ? `${section("เงินเข้า–ออก")}
         ${moveRows}`
      : ""
  }

  ${voidBlock}
  ${pointsBlock}
  ${commissionBlock}

  <hr class="sep" />

  <div class="sign">
    <div class="box">ผู้ปิดรอบ<br/>${esc(payload.staffName)}</div>
    <div class="box">ผู้ตรวจสอบ<br/>&nbsp;</div>
  </div>

  <div class="foot">
    <div>พิมพ์อัตโนมัติเมื่อปิดรอบ</div>
    <div>${esc(payload.appVersion)}</div>
  </div>
</body>
</html>`;
}

export async function printShiftCloseReport(
  closed: {
    staffName: string;
    openedAt: string | null;
    closedAt: string;
    openCash: number;
    closeCash: number | null;
    variance: number | null;
    closeNote: string;
    billCount: number;
    grossTotal: number;
    byMethod: ShiftCloseReportPayload["byMethod"];
    cashTendered: number;
    cashChange: number;
    cashInTotal: number;
    cashOutTotal: number;
    expectedCash: number;
    pointsRedeemed: number;
    pointsEarned: number;
    voidLineCount: number;
    voidLineAmount: number;
    voidBillCount: number;
    voidBillAmount: number;
    floatCounted: boolean;
    cashMoves: ShiftCloseMove[];
    cashCounts: Array<{
      purpose: "float" | "close";
      denoms: ShiftCloseDenom[];
    }>;
    commission: CommissionResult | null;
  },
  meta: {
    storeName: string;
    branchName: string;
    terminalName: string;
    tagline?: string;
  },
  opts?: { silent?: boolean; preview?: boolean; printer?: PrinterConfig },
): Promise<{ ok: boolean; message?: string }> {
  const printer = opts?.printer ?? (await loadPrinterConfig());
  const appVersion = await getAppVersionLabel();
  const closeCount = [...closed.cashCounts]
    .reverse()
    .find((c) => c.purpose === "close");

  const payload: ShiftCloseReportPayload = {
    storeName: meta.storeName || "AP หมูสด",
    branchName: meta.branchName || "",
    terminalName: meta.terminalName || "เครื่อง POS",
    tagline: meta.tagline,
    staffName: closed.staffName,
    openedAt: closed.openedAt || closed.closedAt,
    closedAt: closed.closedAt,
    openCash: closed.openCash,
    floatCounted: closed.floatCounted,
    billCount: closed.billCount,
    grossTotal: closed.grossTotal,
    byMethod: closed.byMethod,
    cashTendered: closed.cashTendered,
    cashChange: closed.cashChange,
    cashInTotal: closed.cashInTotal,
    cashOutTotal: closed.cashOutTotal,
    expectedCash: closed.expectedCash,
    closeCash: closed.closeCash,
    variance: closed.variance,
    closeNote: closed.closeNote || "",
    pointsRedeemed: closed.pointsRedeemed,
    pointsEarned: closed.pointsEarned,
    voidLineCount: closed.voidLineCount,
    voidLineAmount: closed.voidLineAmount,
    voidBillCount: closed.voidBillCount,
    voidBillAmount: closed.voidBillAmount,
    cashMoves: closed.cashMoves,
    closeDenoms: closeCount?.denoms ?? [],
    commission: closed.commission,
    paperWidth: printer.paperWidth,
    appVersion,
  };

  if (!window.apPos?.print?.receipt && !window.apPos?.print?.previewReceipt) {
    return { ok: false, message: "ระบบพิมพ์ยังไม่พร้อม" };
  }

  const html = buildShiftCloseHtml(payload);
  const paperWidth = payload.paperWidth;
  // ปิดรอบ: พิมพ์เงียบเป็นค่าเริ่มต้น (ไม่ค้างตัวอย่างก่อน quit)
  const wantPreview = opts?.preview === true;
  try {
    if (wantPreview && window.apPos.print?.previewReceipt) {
      const prev = await window.apPos.print.previewReceipt({
        html,
        paperWidth,
        title: "ตัวอย่างใบปิดรอบ",
      });
      if (!prev.ok) return prev;
    }
    if (!window.apPos.print?.receipt) {
      return wantPreview ? { ok: true } : { ok: false, message: "ระบบพิมพ์ยังไม่พร้อม" };
    }
    try {
      return await window.apPos.print.receipt({
        html,
        paperWidth,
        silent: opts?.silent ?? printer.silent,
        deviceName: printer.printerName || undefined,
        openDrawer: true,
      });
    } catch (e) {
      return {
        ok: true,
        message: e instanceof Error ? e.message : undefined,
      };
    }
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "พิมพ์ใบปิดรอบไม่สำเร็จ",
    };
  }
}
