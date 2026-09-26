/**
 * ส่งไบต์ RAW ไปคิวเครื่องพิมพ์ Windows (รับงานได้แม้เครื่องพิมพ์ปิด/ออฟไลน์
 * ถ้ายังมีคิวติดตั้งใน Windows)
 */
import { spawn } from "node:child_process";
import { writeFileSync, unlinkSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { app } from "electron";
import { encodeDrawerOnly } from "./escpos-text";

function psEscapeSingle(s: string) {
  return s.replace(/'/g, "''");
}

export async function sendRawToWindowsPrinter(
  printerName: string,
  data: Buffer,
  opts?: { docName?: string },
): Promise<void> {
  const name = printerName.trim();
  if (!name) throw new Error("ไม่ได้ระบุชื่อเครื่องพิมพ์");

  const dir = join(app.getPath("temp"), "ap-pos-print");
  mkdirSync(dir, { recursive: true });
  const binPath = join(dir, `raw-${randomBytes(6).toString("hex")}.bin`);
  writeFileSync(binPath, data);
  const docName = opts?.docName || "AP POS Receipt";

  const ps = `
$ErrorActionPreference = 'Stop'
$printerName = '${psEscapeSingle(name)}'
$binPath = '${psEscapeSingle(binPath)}'
$docName = '${psEscapeSingle(docName)}'
$bytes = [System.IO.File]::ReadAllBytes($binPath)

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class ApPosRawPrint {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  public class DOCINFO {
    [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPWStr)] public string pDatatype;
  }
  [DllImport("winspool.drv", SetLastError=true, CharSet=CharSet.Unicode)]
  public static extern bool OpenPrinter(string pPrinterName, out IntPtr phPrinter, IntPtr pDefault);
  [DllImport("winspool.drv", SetLastError=true)]
  public static extern bool ClosePrinter(IntPtr hPrinter);
  [DllImport("winspool.drv", SetLastError=true, CharSet=CharSet.Unicode)]
  public static extern bool StartDocPrinter(IntPtr hPrinter, int Level, [In] DOCINFO di);
  [DllImport("winspool.drv", SetLastError=true)]
  public static extern bool EndDocPrinter(IntPtr hPrinter);
  [DllImport("winspool.drv", SetLastError=true)]
  public static extern bool StartPagePrinter(IntPtr hPrinter);
  [DllImport("winspool.drv", SetLastError=true)]
  public static extern bool EndPagePrinter(IntPtr hPrinter);
  [DllImport("winspool.drv", SetLastError=true)]
  public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, int dwCount, out int dwWritten);
}
"@

$h = [IntPtr]::Zero
if (-not [ApPosRawPrint]::OpenPrinter($printerName, [ref]$h, [IntPtr]::Zero)) {
  throw "OpenPrinter failed for $printerName (Win32=$([Runtime.InteropServices.Marshal]::GetLastWin32Error()))"
}
try {
  $di = New-Object ApPosRawPrint+DOCINFO
  $di.pDocName = $docName
  $di.pOutputFile = $null
  $di.pDatatype = 'RAW'
  if (-not [ApPosRawPrint]::StartDocPrinter($h, 1, $di)) {
    throw "StartDocPrinter failed (Win32=$([Runtime.InteropServices.Marshal]::GetLastWin32Error()))"
  }
  try {
    if (-not [ApPosRawPrint]::StartPagePrinter($h)) {
      throw "StartPagePrinter failed"
    }
    try {
      $ptr = [Runtime.InteropServices.Marshal]::AllocHGlobal($bytes.Length)
      try {
        [Runtime.InteropServices.Marshal]::Copy($bytes, 0, $ptr, $bytes.Length)
        $written = 0
        if (-not [ApPosRawPrint]::WritePrinter($h, $ptr, $bytes.Length, [ref]$written)) {
          throw "WritePrinter failed (Win32=$([Runtime.InteropServices.Marshal]::GetLastWin32Error()))"
        }
        if ($written -lt $bytes.Length) {
          throw "WritePrinter partial $written / $($bytes.Length)"
        }
      } finally {
        [Runtime.InteropServices.Marshal]::FreeHGlobal($ptr)
      }
    } finally {
      [void][ApPosRawPrint]::EndPagePrinter($h)
    }
  } finally {
    [void][ApPosRawPrint]::EndDocPrinter($h)
  }
} finally {
  [void][ApPosRawPrint]::ClosePrinter($h)
}
`;

  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        "powershell.exe",
        [
          "-NoLogo",
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy",
          "Bypass",
          "-Command",
          ps,
        ],
        { windowsHide: true },
      );
      let stderr = "";
      child.stderr.on("data", (d) => {
        stderr += String(d);
      });
      child.on("error", reject);
      child.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(stderr.trim() || `PowerShell exit ${code}`));
      });
    });
  } finally {
    try {
      unlinkSync(binPath);
    } catch {
      /* ignore */
    }
  }
}

/**
 * เตะลิ้นชักแบบ best-effort — ลองหลายชื่อคิว ไม่ throw
 * เรียกก่อนพิมพ์เสมอ แม้เครื่องพิมพ์ปิดอยู่
 */
export async function kickCashDrawerBestEffort(
  printerNames: Array<string | undefined | null>,
): Promise<{ ok: boolean; used?: string; error?: string }> {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const n of printerNames) {
    const t = String(n || "").trim();
    if (!t) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(t);
  }
  if (!names.length) {
    return { ok: false, error: "ไม่มีชื่อเครื่องพิมพ์สำหรับเตะลิ้นชัก" };
  }

  const payload = encodeDrawerOnly();
  let lastErr = "";
  for (const name of names) {
    try {
      await sendRawToWindowsPrinter(name, payload, {
        docName: "AP POS Drawer",
      });
      console.log(`[ap-pos] drawer kick ok → ${name}`);
      return { ok: true, used: name };
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
      console.warn(`[ap-pos] drawer kick fail → ${name}:`, lastErr);
    }
  }
  return { ok: false, error: lastErr || "เตะลิ้นชักไม่สำเร็จ" };
}
