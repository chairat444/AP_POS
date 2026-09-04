/**
 * พิมพ์สลิปผ่านไดรเวอร์ Windows — จัดซ้าย / กลาง / ขวา
 * ฟอร์แมต APSLIP2 (บรรทัด Tab) — ไม่พึ่ง ConvertFrom-Json
 */
import { spawn } from "node:child_process";
import { writeFileSync, unlinkSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { app } from "electron";

function psEscapeSingle(s: string) {
  return s.replace(/'/g, "''");
}

function formatGdiPrintError(msg: string): string {
  if (!msg) return msg;
  if (/specified printer has been deleted/i.test(msg)) {
    return "เครื่องพิมพ์ถูกลบหรือไดรเวอร์หลุด — ลบเครื่องพิมพ์เก่าใน Windows แล้วติดตั้งไดรเวอร์ใหม่";
  }
  return msg;
}

export type GdiTextPrintOpts = {
  paperWidthMm?: 58 | 80;
  fontSizePt?: number;
};

export async function sendTextToWindowsPrinter(
  printerName: string,
  text: string,
  opts: GdiTextPrintOpts = {},
): Promise<void> {
  const name = printerName.trim();
  if (!name) throw new Error("ไม่ได้ระบุชื่อเครื่องพิมพ์");
  const body = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trimEnd();
  if (!body) throw new Error("ไม่มีข้อความสลิป");

  const dir = join(app.getPath("temp"), "ap-pos-print");
  mkdirSync(dir, { recursive: true });
  const txtPath = join(dir, `txt-${randomBytes(6).toString("hex")}.txt`);
  writeFileSync(txtPath, `\uFEFF${body}`, "utf8");

  const widthMm = opts.paperWidthMm === 80 ? 80 : 58;
  const widthHi = Math.round((widthMm / 25.4) * 100);
  const fontPt = opts.fontSizePt ?? (widthMm === 80 ? 8 : 7);

  const ps = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$printerName = '${psEscapeSingle(name)}'
$txtPath = '${psEscapeSingle(txtPath)}'
$widthHi = ${widthHi}
$fontPt = ${fontPt}
$wantMm = ${widthMm}

$raw = [System.IO.File]::ReadAllText($txtPath, [System.Text.Encoding]::UTF8).TrimStart([char]0xFEFF)
$srcLines = @($raw -split "\`n")

$pd = New-Object System.Drawing.Printing.PrintDocument
try {
  $pd.PrinterSettings.PrinterName = $printerName
  if (-not $pd.PrinterSettings.IsValid) {
    throw "เครื่องพิมพ์ไม่พร้อม: $printerName"
  }
  $pd.DocumentName = 'AP POS Receipt'
  $pd.PrinterSettings.Copies = 1
  $pd.OriginAtMargins = $false
  $pd.DefaultPageSettings.Margins = New-Object System.Drawing.Printing.Margins(0, 0, 0, 0)
  $pd.DefaultPageSettings.Landscape = $false

  # เลือก PaperSize จากไดรเวอร์ (อย่าสร้างเอง — XP-58 พิมพ์ว่าง)
  # แต่ความกว้างวาดยึด config ด้านล่าง — รองรับ XP-80C + ม้วน 58
  $picked = $null
  $bestDiff = 999999
  foreach ($psize in $pd.PrinterSettings.PaperSizes) {
    $n = [string]$psize.PaperName
    if ($wantMm -eq 58 -and $n -match '80|88') { continue }
    if ($wantMm -eq 80 -and $n -match '(^|[^0-9])58([^0-9]|$)') { continue }
    $nameHit = $false
    if ($wantMm -eq 58 -and $n -match '58|720|72\\s*mm|72mm') { $nameHit = $true }
    if ($wantMm -eq 80 -and $n -match '80|88') { $nameHit = $true }
    $diff = [Math]::Abs([int]$psize.Width - $widthHi)
    if ($nameHit -and $diff -lt $bestDiff) {
      $picked = $psize
      $bestDiff = $diff
    }
  }
  if (-not $picked) {
    foreach ($psize in $pd.PrinterSettings.PaperSizes) {
      $n = [string]$psize.PaperName
      if ($wantMm -eq 58 -and $n -match '80|88') { continue }
      if ($wantMm -eq 80 -and $n -match '(^|[^0-9])58([^0-9]|$)') { continue }
      if ($n -notmatch 'Receipt|Roll|58|80|72') { continue }
      $diff = [Math]::Abs([int]$psize.Width - $widthHi)
      if ($diff -lt $bestDiff) {
        $picked = $psize
        $bestDiff = $diff
      }
    }
  }
  if ($picked) {
    $pd.DefaultPageSettings.PaperSize = $picked
  }

  $font = $null
  foreach ($fname in @('Tahoma', 'Segoe UI', 'Microsoft Sans Serif', 'Arial')) {
    try {
      $font = New-Object System.Drawing.Font($fname, $fontPt, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Point)
      if ($font.Name) { break }
    } catch { $font = $null }
  }
  if (-not $font) { $font = New-Object System.Drawing.Font('Arial', $fontPt) }

  $brush = [System.Drawing.Brushes]::Black
  $pen = New-Object System.Drawing.Pen([System.Drawing.Color]::Black, 1)

  $fmtL = New-Object System.Drawing.StringFormat
  $fmtL.Alignment = [System.Drawing.StringAlignment]::Near
  $fmtL.LineAlignment = [System.Drawing.StringAlignment]::Near
  $fmtL.FormatFlags = [System.Drawing.StringFormatFlags]::NoWrap
  $fmtL.Trimming = [System.Drawing.StringTrimming]::EllipsisCharacter

  $fmtC = New-Object System.Drawing.StringFormat
  $fmtC.Alignment = [System.Drawing.StringAlignment]::Center
  $fmtC.LineAlignment = [System.Drawing.StringAlignment]::Near
  $fmtC.FormatFlags = [System.Drawing.StringFormatFlags]::NoWrap
  $fmtC.Trimming = [System.Drawing.StringTrimming]::EllipsisCharacter

  $fmtR = New-Object System.Drawing.StringFormat
  $fmtR.Alignment = [System.Drawing.StringAlignment]::Far
  $fmtR.LineAlignment = [System.Drawing.StringAlignment]::Near
  $fmtR.FormatFlags = [System.Drawing.StringFormatFlags]::NoWrap
  $fmtR.Trimming = [System.Drawing.StringTrimming]::Character

  function Wrap-Left([System.Drawing.Graphics]$g, [System.Drawing.Font]$f, [string]$text, [single]$maxW) {
    if ($null -eq $text) { return ,@('') }
    $mw = [Math]::Max(10.0, $maxW)
    if ($g.MeasureString($text, $f).Width -le $mw) { return ,@($text) }
    $acc = New-Object System.Collections.Generic.List[string]
    $cur = ''
    foreach ($ch in $text.ToCharArray()) {
      $try = $cur + $ch
      if ($g.MeasureString($try, $f).Width -gt $mw -and $cur.Length -gt 0) {
        [void]$acc.Add($cur)
        $cur = [string]$ch
      } else { $cur = $try }
    }
    if ($cur.Length -gt 0 -or $acc.Count -eq 0) { [void]$acc.Add($cur) }
    return ,$acc.ToArray()
  }

  $script:ops = New-Object System.Collections.Generic.Queue[object]
  $script:prepared = $false
  $script:drawn = 0
  $script:done = $false
  $script:err = $null

  $pd.add_BeginPrint({
    $script:drawn = 0
  })

  $pd.add_PrintPage({
    param($sender, $e)
    try {
      $g = $e.Graphics
      $g.PageUnit = [System.Drawing.GraphicsUnit]::Display
      $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit

      # ความกว้างวาดยึด config (58/80) — ไม่ใช้เต็มหน้าไดรเวอร์
      # XP-80C ไดรเวอร์มักเป็น 80 แต่สาขาใส่ม้วน 58 → ต้องบีบตาม config
      $page = $e.PageBounds
      if ($page.Width -lt 20) { $page = $e.MarginBounds }
      $pad = 2
      $x0 = [single]($page.X + $pad)
      # พื้นที่พิมพ์จริงแคบกว่าม้วน (ขอบหัวพิมพ์) — 58→52mm · 80→72mm
      $printMm = if ($wantMm -eq 80) { 72 } else { 52 }
      $configW = [single]([Math]::Round(($printMm / 25.4) * 100))
      $pageW = [single]([Math]::Max(40, $page.Width - $pad * 2))
      $fullW = $configW
      if ($pageW -lt $fullW) { $fullW = $pageW }

      $y = [single]($page.Y + $pad)
      $maxY = [single]($page.Y + $page.Height - $pad)
      $lh = $font.GetHeight($g)
      $gap = 4.0

      if (-not $script:prepared) {
        $isSlip = $srcLines.Count -gt 0 -and ($srcLines[0].Trim() -eq 'APSLIP2' -or $srcLines[0].Trim().StartsWith('APSLIP2'))
        $startIdx = 0
        if ($isSlip) { $startIdx = 1 }
        for ($i = $startIdx; $i -lt $srcLines.Count; $i++) {
          $line = [string]$srcLines[$i]
          if ($null -eq $line) { continue }
          $line = $line.TrimEnd()
          if (-not $isSlip) {
            foreach ($p in (Wrap-Left $g $font $line $fullW)) {
              $script:ops.Enqueue(@{ k = 'l'; t = [string]$p })
            }
            continue
          }
          if ($line -eq 'S') {
            $script:ops.Enqueue(@{ k = 's' })
            continue
          }
          $parts = $line -split "\`t", 3
          $kind = $parts[0]
          if ($kind -eq 'C') {
            $t = if ($parts.Count -gt 1) { $parts[1] } else { '' }
            foreach ($p in (Wrap-Left $g $font $t $fullW)) {
              $script:ops.Enqueue(@{ k = 'c'; t = [string]$p })
            }
          } elseif ($kind -eq 'L') {
            $t = if ($parts.Count -gt 1) { $parts[1] } else { '' }
            foreach ($p in (Wrap-Left $g $font $t $fullW)) {
              $script:ops.Enqueue(@{ k = 'l'; t = [string]$p })
            }
          } elseif ($kind -eq 'LR') {
            $left = if ($parts.Count -gt 1) { $parts[1] } else { '' }
            $right = if ($parts.Count -gt 2) { $parts[2] } else { '' }
            $rw = $g.MeasureString($right, $font).Width
            $leftMax = [Math]::Max(12.0, $fullW - $rw - $gap)
            $wrapped = @(Wrap-Left $g $font $left $leftMax)
            for ($w = 0; $w -lt $wrapped.Count; $w++) {
              if ($w -eq 0) {
                $script:ops.Enqueue(@{ k = 'lr'; l = [string]$wrapped[$w]; r = $right })
              } else {
                $script:ops.Enqueue(@{ k = 'l'; t = [string]$wrapped[$w] })
              }
            }
          } else {
            foreach ($p in (Wrap-Left $g $font $line $fullW)) {
              $script:ops.Enqueue(@{ k = 'l'; t = [string]$p })
            }
          }
        }
        if ($script:ops.Count -eq 0) {
          throw "ไม่มีเนื้อหาสลิปหลังแปลง (ว่าง)"
        }
        $script:prepared = $true
      }

      while ($script:ops.Count -gt 0) {
        if (($y + $lh) -gt $maxY -and $script:drawn -gt 0) {
          $e.HasMorePages = $true
          return
        }
        $op = $script:ops.Dequeue()
        $k = [string]$op.k
        if ($k -eq 's') {
          $yy = $y + ($lh * 0.45)
          $g.DrawLine($pen, $x0, $yy, $x0 + $fullW, $yy)
          $y += $lh * 0.7
          $script:drawn++
          continue
        }
        $rect = New-Object System.Drawing.RectangleF($x0, $y, $fullW, $lh)
        if ($k -eq 'c') {
          $g.DrawString([string]$op.t, $font, $brush, $rect, $fmtC)
        } elseif ($k -eq 'lr') {
          $right = [string]$op.r
          $rw = $g.MeasureString($right, $font).Width
          $leftW = [Math]::Max(12.0, $fullW - $rw - $gap)
          $leftRect = New-Object System.Drawing.RectangleF($x0, $y, $leftW, $lh)
          $rightRect = New-Object System.Drawing.RectangleF($x0, $y, $fullW, $lh)
          $g.DrawString([string]$op.l, $font, $brush, $leftRect, $fmtL)
          $g.DrawString($right, $font, $brush, $rightRect, $fmtR)
        } else {
          $g.DrawString([string]$op.t, $font, $brush, $rect, $fmtL)
        }
        $y += $lh
        $script:drawn++
      }
      $e.HasMorePages = $false
      $script:done = $true
    } catch {
      $script:err = $_.Exception.Message
      $e.Cancel = $true
    }
  })

  $pd.Print()
  if ($script:err) { throw $script:err }
  if (-not $script:done) { throw "ไดรเวอร์ไม่ได้รับงานพิมพ์" }
  if ($script:drawn -lt 1) { throw "พิมพ์แล้วแต่ไม่มีเนื้อหา (drawn=0)" }
  Write-Output ("OK drawn=" + $script:drawn)
  $pen.Dispose()
  $font.Dispose()
} finally {
  $pd.Dispose()
}
`;

  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        "powershell.exe",
        [
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
      let stdout = "";
      child.stderr.on("data", (d) => {
        stderr += String(d);
      });
      child.stdout.on("data", (d) => {
        stdout += String(d);
      });
      child.on("error", reject);
      child.on("close", (code) => {
        if (code === 0) {
          console.log("[ap-pos] GDI print ok:", stdout.trim() || "(no stdout)");
          resolve();
        } else {
          reject(
            new Error(
              formatGdiPrintError((stderr || stdout).trim()) ||
                `PowerShell text print exit ${code}`,
            ),
          );
        }
      });
    });
  } finally {
    try {
      unlinkSync(txtPath);
    } catch {
      /* ignore */
    }
  }
}
