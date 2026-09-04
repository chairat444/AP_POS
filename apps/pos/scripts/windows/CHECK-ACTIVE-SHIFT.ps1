# Read-only: show which shift the POS will restore from local SQLite.
$ErrorActionPreference = "Stop"

$DbPath = Join-Path $env:APPDATA "@ap-pos\pos\db\ap-pos-local.sqlite"
if (-not (Test-Path $DbPath)) {
  Write-Host "DB not found: $DbPath"
  exit 1
}

$ToolsDir = Join-Path $env:TEMP "ap-pos-sqlite-tools"
$SqliteExe = Join-Path $ToolsDir "sqlite3.exe"
if (-not (Test-Path $SqliteExe)) {
  Write-Host "sqlite3 not found. Run MERGE-SHIFT-TODAY.bat once first (downloads sqlite3), then run this again."
  exit 1
}

function Invoke-Sqlite([string]$sql) {
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $SqliteExe
  $psi.Arguments = "`"$DbPath`""
  $psi.RedirectStandardInput = $true
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $p = [System.Diagnostics.Process]::Start($psi)
  $p.StandardInput.WriteLine($sql)
  $p.StandardInput.Close()
  $out = $p.StandardOutput.ReadToEnd()
  $err = $p.StandardError.ReadToEnd()
  $p.WaitForExit()
  if ($p.ExitCode -ne 0) { throw "sqlite3 failed: $err" }
  return $out
}

Write-Host "DB: $DbPath"
Write-Host ""

$raw = (Invoke-Sqlite "SELECT value FROM meta WHERE key='active-shift-session';").Trim()
if (-not $raw) {
  Write-Host "active-shift-session: (empty) - POS will ask for PIN / open a NEW shift"
  exit 0
}

try {
  $s = $raw | ConvertFrom-Json
} catch {
  Write-Host "active-shift-session: JSON parse failed"
  Write-Host $raw.Substring(0, [Math]::Min(200, $raw.Length))
  exit 1
}

$billCount = @($s.sales).Count
$maxBill = ""
$maxSeq = 0
foreach ($sale in @($s.sales)) {
  if ([string]$sale.billNo -match "(\d+)$") {
    $n = [int]$Matches[1]
    if ($n -ge $maxSeq) {
      $maxSeq = $n
      $maxBill = [string]$sale.billNo
    }
  }
}

$daySeq = (Invoke-Sqlite "SELECT value FROM meta WHERE key LIKE 'bill-seq-%' ORDER BY key DESC LIMIT 1;").Trim()

Write-Host "=== ACTIVE SHIFT (what POS will restore) ==="
Write-Host ("shiftId     : {0}" -f $s.shiftId)
Write-Host ("staff       : {0} ({1})" -f $s.staff.name, $s.staff.code)
Write-Host ("openedAt    : {0}" -f $s.openedAt)
Write-Host ("openCash    : {0}" -f $s.openCash)
Write-Host ("billsInSession : {0}" -f $billCount)
Write-Host ("billSeq     : {0}" -f $s.billSeq)
Write-Host ("maxBillNo   : {0}" -f $maxBill)
$nextSeq = ($maxSeq + 1).ToString("000000")
Write-Host ("nextBillHint: ...-{0}  (from maxBill)" -f $nextSeq)
if ([int]($s.billSeq) -lt $maxSeq) {
  Write-Host "WARNING: billSeq < maxBillNo — POS will show wrong next bill. Re-run MERGE-SHIFT-TODAY.bat"
}
Write-Host ("day bill-seq meta : {0}" -f $(if ($daySeq) { $daySeq } else { "(none)" }))
Write-Host ""

if ($s.shiftId -eq "1788055837916-a3zyzl") {
  Write-Host "OK - local session is on KEEP shift a3zyzl"
} elseif ($s.shiftId -eq "1788066682910-fc4mac" -or $s.shiftId -eq "1788064864175-zy2i5z") {
  Write-Host "NOT MERGED - still on orphan shift. Close POS and re-run MERGE-SHIFT-TODAY.bat"
} else {
  Write-Host "NOTE - different shiftId (maybe opened a new shift after merge)"
}

Write-Host ""
Write-Host "Local shifts table:"
Write-Host (Invoke-Sqlite "SELECT id, status, opened_at, open_cash FROM shifts ORDER BY opened_at DESC LIMIT 5;")
Write-Host "Local sales by shift_id (remaining rows only; synced sales may be deleted):"
Write-Host (Invoke-Sqlite "SELECT IFNULL(shift_id,'(null)'), COUNT(*), ROUND(COALESCE(SUM(total),0),2) FROM sales GROUP BY shift_id;")

exit 0
