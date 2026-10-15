import { loadPrinterConfig } from "./receipt";

let cachedPrinterName: string | undefined;
let primed = false;

/** จำชื่อเครื่องพิมพ์ไว้ — เตะได้ทันทีโดยไม่รออ่าน SQLite */
export async function primeDrawerFromPrinterConfig(): Promise<void> {
  try {
    const cfg = await loadPrinterConfig();
    cachedPrinterName = cfg.printerName?.trim() || undefined;
    primed = true;
  } catch {
    /* ignore */
  }
}

export function setDrawerPrinterName(name: string | undefined) {
  cachedPrinterName = name?.trim() || undefined;
  primed = true;
}

/**
 * เตะลิ้นชัก — ไม่ throw · ไม่บล็อกงานอื่น
 * ใช้ตอนจบบิล / นำเงินเข้า-ออก / นับเงิน / ปิดรอบ
 * (ไม่ผูกกับติ๊ก「เตะลิ้นชักก่อนพิมพ์」— ติ๊กนั้นมีผลเฉพาะตอนพิมพ์สลิป)
 */
export function kickCashDrawer(deviceName?: string): void {
  void (async () => {
    try {
      if (!window.apPos?.print?.kickDrawer) return;
      if (deviceName !== undefined) {
        const name = deviceName.trim() || undefined;
        if (name) cachedPrinterName = name;
        await window.apPos.print.kickDrawer({ deviceName: name });
        return;
      }
      if (!primed) {
        await primeDrawerFromPrinterConfig();
      }
      await window.apPos.print.kickDrawer({
        deviceName: cachedPrinterName,
      });
    } catch {
      // เตะไม่ได้ก็ไม่กระทบบันทึก/sync
    }
  })();
}
