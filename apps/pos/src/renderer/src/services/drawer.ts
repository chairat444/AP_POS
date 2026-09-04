import { loadPrinterConfig } from "./receipt";

/** เตะลิ้นชัก — ไม่ throw (ใช้ตอนนับเงิน / นำเข้า-ออก) */
export async function kickCashDrawer() {
  try {
    if (!window.apPos?.print?.kickDrawer) return;
    const cfg = await loadPrinterConfig();
    await window.apPos.print.kickDrawer({
      deviceName: cfg.printerName || undefined,
    });
  } catch {
    // best-effort — นับเงินต่อได้แม้ลิ้นชักไม่เปิด
  }
}
