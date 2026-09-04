# Deep search for missing bills 9-18 on this POS PC.
# ASCII-only. Does NOT change data.

$ErrorActionPreference = "Continue"
$BillFrom = 9
$BillTo = 18
$DayPrefix = "S260903-002-"

function Write-Step([string]$msg) { Write-Host (">> " + $msg) }
function Escape-Sql([string]$v) {
  if ($null -eq $v) { return "" }
  return $v.Replace("'", "''")
}

$DbPath = Join-Path $env:APPDATA "@ap-pos\pos\db\ap-pos-local.sqlite"
$DbDir = Split-Path $DbPath -Parent
$Report = Join-Path $env:TEMP ("ap-pos-find-bills-" + (Get-Date -Format "yyyyMMdd-HHmmss") + ".txt")
$linesOut = New-Object System.Collections.Generic.List[string]
function L([string]$s) {
  Write-Host $s
  [void]$linesOut.Add($s)
}

L "=== FIND MISSING BILLS ==="
L ("DB: " + $DbPath)
L ("Report: " + $Report)
L ""

# --- 1) Live DB ---
$ToolsDir = Join-Path $env:TEMP "ap-pos-sqlite-tools"
$SqliteExe = Join-Path $ToolsDir "sqlite3.exe"
if (-not (Test-Path $SqliteExe)) {
  L "sqlite3 missing. Run MERGE-SHIFT-TODAY.bat once, then re-run this."
  $linesOut | Set-Content -Path $Report -Encoding UTF8
  exit 1
}

function Invoke-SqliteOn([string]$db, [string]$sql) {
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $SqliteExe
  $psi.Arguments = '"' + $db + '" -json'
  $psi.RedirectStandardInput = $true
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $p = [System.Diagnostics.Process]::Start($psi)
  $p.StandardInput.WriteLine($sql)
  $p.StandardInput.Close()
  $out = $p.StandardOutput.ReadToEnd()
  $null = $p.StandardError.ReadToEnd()
  $p.WaitForExit()
  return $out
}

function Get-JsonRows([string]$db, [string]$sql) {
  $raw = (Invoke-SqliteOn $db $sql).Trim()
  if (-not $raw) { return @() }
  try {
    $parsed = $raw | ConvertFrom-Json
    if ($null -eq $parsed) { return @() }
    if ($parsed -is [System.Array]) { return @($parsed) }
    return @($parsed)
  } catch { return @() }
}

function Test-BillInDb([string]$db) {
  $hits = @()
  for ($n = $BillFrom; $n -le $BillTo; $n++) {
    $bn = $DayPrefix + $n.ToString("000000")
    $rows = @(Get-JsonRows $db ("SELECT id, bill_no, total, shift_id, synced_at, created_at FROM sales WHERE bill_no='" + (Escape-Sql $bn) + "';"))
    if ($rows.Count -gt 0) { $hits += $rows }
  }
  # also by seq pattern
  $all = @(Get-JsonRows $db "SELECT id, bill_no, total, shift_id, synced_at, created_at FROM sales ORDER BY bill_no;")
  foreach ($r in $all) {
    if ([string]$r.bill_no -match "(\d+)$") {
      $seq = [int]$Matches[1]
      if ($seq -ge $BillFrom -and $seq -le $BillTo) {
        $already = $false
        foreach ($h in $hits) { if ($h.id -eq $r.id) { $already = $true; break } }
        if (-not $already) { $hits += $r }
      }
    }
  }
  return $hits
}

Write-Step "1) Live SQLite"
if (Test-Path $DbPath) {
  $fi = Get-Item $DbPath
  L ("  size=" + $fi.Length + "  mtime=" + $fi.LastWriteTime)
  $salesCount = @(Get-JsonRows $DbPath "SELECT COUNT(*) AS c FROM sales;")
  $outboxCount = @(Get-JsonRows $DbPath "SELECT COUNT(*) AS c FROM sync_outbox;")
  L ("  sales_rows=" + $(if ($salesCount[0]) { $salesCount[0].c } else { "?" }))
  L ("  outbox_rows=" + $(if ($outboxCount[0]) { $outboxCount[0].c } else { "?" }))
  $hits = @(Test-BillInDb $DbPath)
  L ("  bills_9_18_in_live_db=" + $hits.Count)
  foreach ($h in $hits) {
    L ("    FOUND " + $h.bill_no + " total=" + $h.total + " id=" + $h.id)
  }

  # meta session may still hold JSON sales
  $meta = @(Get-JsonRows $DbPath "SELECT key, length(value) AS n FROM meta;")
  foreach ($m in $meta) {
    L ("  meta " + $m.key + " len=" + $m.n)
  }
  $sessionRaw = ""
  try {
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $SqliteExe
    $psi.Arguments = '"' + $DbPath + '"'
    $psi.RedirectStandardInput = $true
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $p = [System.Diagnostics.Process]::Start($psi)
    $p.StandardInput.WriteLine("SELECT value FROM meta WHERE key='active-shift-session';")
    $p.StandardInput.Close()
    $sessionRaw = $p.StandardOutput.ReadToEnd().Trim()
    $null = $p.StandardError.ReadToEnd()
    $p.WaitForExit()
  } catch {}
  if ($sessionRaw) {
    L ("  active-shift-session chars=" + $sessionRaw.Length)
    try {
      $sess = $sessionRaw | ConvertFrom-Json
      $sessSales = @($sess.sales)
      L ("  session.sales count=" + $sessSales.Count)
      foreach ($sale in $sessSales) {
        if ([string]$sale.billNo -match "(\d+)$") {
          $seq = [int]$Matches[1]
          if ($seq -ge $BillFrom -and $seq -le $BillTo) {
            L ("    SESSION HAS " + $sale.billNo + " total=" + $sale.total + " id=" + $sale.id)
          }
        }
      }
    } catch {
      L "  session JSON parse failed"
    }
  } else {
    L "  active-shift-session: empty"
  }
} else {
  L "  LIVE DB MISSING"
}

# --- 2) Sibling files next to DB ---
Write-Step "2) Files next to DB"
if (Test-Path $DbDir) {
  Get-ChildItem -Force $DbDir | ForEach-Object {
    L ("  " + $_.Name + "  " + $_.Length + "  " + $_.LastWriteTime)
  }
} else {
  L ("  missing dir " + $DbDir)
}

# --- 3) Search copies under AppData / Temp / Desktop / D:\Share ---
Write-Step "3) Search sqlite copies on disk"
$roots = @(
  (Join-Path $env:APPDATA "@ap-pos"),
  (Join-Path $env:LOCALAPPDATA "@ap-pos"),
  $env:TEMP,
  (Join-Path $env:USERPROFILE "Desktop"),
  (Join-Path $env:USERPROFILE "Documents"),
  "D:\Share",
  "D:\",
  "C:\Users\ADMIN\AppData\Local\Temp"
) | Select-Object -Unique

$candidates = @()
foreach ($root in $roots) {
  if (-not (Test-Path $root)) { continue }
  try {
    $found = Get-ChildItem -Path $root -Recurse -Force -ErrorAction SilentlyContinue |
      Where-Object {
        $_.Name -match 'ap-pos-local|sqlite' -and $_.Length -gt 10000
      } |
      Select-Object -First 40
    foreach ($f in $found) { $candidates += $f }
  } catch {}
}

$candidates = $candidates | Sort-Object FullName -Unique
L ("  candidate files=" + @($candidates).Count)
foreach ($f in $candidates) {
  L ("  FILE " + $f.FullName + "  size=" + $f.Length + "  mtime=" + $f.LastWriteTime)
  if ($f.Extension -match 'sqlite|db' -or $f.Name -match 'sqlite') {
    try {
      $hits = @(Test-BillInDb $f.FullName)
      L ("    bills_9_18=" + $hits.Count)
      foreach ($h in $hits) {
        L ("      HIT " + $h.bill_no + " total=" + $h.total + " id=" + $h.id + " synced=" + $h.synced_at)
      }
    } catch {
      L ("    open failed: " + $_.Exception.Message)
    }
  }
}

# --- 4) Previous Versions / Shadow copies hint ---
Write-Step "4) Previous Versions check"
L "  Right-click this file in Explorer > Properties > Previous Versions:"
L ("  " + $DbPath)
L "  Or run as Admin: vssadmin list shadows"
try {
  $vss = & vssadmin list shadows 2>&1 | Out-String
  if ($vss) {
    $clip = $vss.Substring(0, [Math]::Min(1500, $vss.Length))
    L $clip
  }
} catch {
  L ("  vssadmin: " + $_.Exception.Message)
}

# --- 5) Recycle Bin recent sqlite ---
Write-Step "5) Recycle Bin"
try {
  $shell = New-Object -ComObject Shell.Application
  $rb = $shell.NameSpace(0xA)
  if ($rb) {
    $n = 0
    foreach ($item in $rb.Items()) {
      if ($item.Name -match 'sqlite|ap-pos') {
        L ("  recycle: " + $item.Name + "  " + $item.Path)
        $n++
      }
    }
    if ($n -eq 0) { L "  no sqlite-like items visible" }
  }
} catch {
  L ("  recycle check failed: " + $_.Exception.Message)
}

L ""
L "=== DONE ==="
L ("Saved: " + $Report)
$linesOut | Set-Content -Path $Report -Encoding UTF8
Write-Host ""
Write-Host ("Report saved to " + $Report)
Write-Host "Copy that .txt back / photo the FOUND lines"
