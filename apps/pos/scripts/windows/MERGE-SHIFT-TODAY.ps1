# Merge orphan shifts fc4mac/zy2i5z into a3zyzl in local POS SQLite.
# Run only after AP POS is closed.

$ErrorActionPreference = "Stop"

$KeepShift = "1788055837916-a3zyzl"
$DropShifts = @(
  "1788066682910-fc4mac",
  "1788064864175-zy2i5z"
)
$ApiBase = "https://pos.chinthurakij.com/api"
$BranchId = "branch-002"
$Day = "2026-08-30"
$ActiveKey = "active-shift-session"

function Write-Step($msg) { Write-Host ">> $msg" }

Write-Step "Stopping AP POS if running"
Get-Process -Name "AP POS" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

$DbPath = Join-Path $env:APPDATA "@ap-pos\pos\db\ap-pos-local.sqlite"
if (-not (Test-Path $DbPath)) {
  Write-Host "DB not found: $DbPath"
  exit 1
}
Write-Step "DB: $DbPath"

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$Bak = "$DbPath.bak-merge-$stamp"
Copy-Item -LiteralPath $DbPath -Destination $Bak -Force
Write-Step "Backup: $Bak"

$ToolsDir = Join-Path $env:TEMP "ap-pos-sqlite-tools"
$SqliteExe = Join-Path $ToolsDir "sqlite3.exe"
if (-not (Test-Path $SqliteExe)) {
  Write-Step "Downloading sqlite3 (first run)..."
  New-Item -ItemType Directory -Force -Path $ToolsDir | Out-Null
  $zip = Join-Path $ToolsDir "sqlite.zip"
  $url = "https://www.sqlite.org/2024/sqlite-tools-win-x64-3460100.zip"
  Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing
  Expand-Archive -LiteralPath $zip -DestinationPath $ToolsDir -Force
  $found = Get-ChildItem -Path $ToolsDir -Recurse -Filter "sqlite3.exe" | Select-Object -First 1
  if (-not $found) { throw "sqlite3.exe not found after unzip" }
  if ($found.FullName -ne $SqliteExe) {
    Copy-Item $found.FullName $SqliteExe -Force
  }
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
  if ($err -and ($err -match "Error|error")) { throw "sqlite3: $err" }
  return $out
}

function Get-SqliteScalar([string]$sql) {
  $o = Invoke-Sqlite $sql
  return ($o -split "`r?`n" | Where-Object { $_.Trim() -ne "" } | Select-Object -First 1)
}

$dropList = ($DropShifts | ForEach-Object { "'$_'" }) -join ","

Write-Step "Move sales/audits -> $KeepShift"
$SqlFix = @"
PRAGMA busy_timeout=5000;
BEGIN;
UPDATE sales SET shift_id = '$KeepShift' WHERE shift_id IN ($dropList);
UPDATE shift_audits SET shift_id = '$KeepShift' WHERE shift_id IN ($dropList);
INSERT INTO shifts(id, branch_id, terminal_id, opened_at, closed_at, open_cash, close_cash, status, synced_at)
SELECT '$KeepShift', branch_id, terminal_id, opened_at, NULL, open_cash, NULL, 'open', NULL
FROM shifts
WHERE id IN ($dropList)
  AND NOT EXISTS (SELECT 1 FROM shifts WHERE id = '$KeepShift')
LIMIT 1;
UPDATE shifts SET status = 'open', closed_at = NULL, synced_at = NULL WHERE id = '$KeepShift';
DELETE FROM shifts WHERE id IN ($dropList);
DELETE FROM sync_outbox WHERE entity_type = 'shift' AND entity_id IN ($dropList);
COMMIT;
SELECT 'sales_keep', COUNT(*), ROUND(COALESCE(SUM(total),0),2) FROM sales WHERE shift_id = '$KeepShift';
SELECT 'sales_drop_left', COUNT(*) FROM sales WHERE shift_id IN ($dropList);
SELECT 'shifts', id, status FROM shifts WHERE id = '$KeepShift' OR id IN ($dropList);
"@
Write-Host (Invoke-Sqlite $SqlFix)

Write-Step "Fix outbox payloads still pointing at old shifts"
$outboxIds = @(
  (Invoke-Sqlite "SELECT id FROM sync_outbox;") -split "`r?`n" |
    Where-Object { $_.Trim() -ne "" }
)
foreach ($oid in $outboxIds) {
  $idEsc = $oid.Replace("'", "''")
  $payloadText = Get-SqliteScalar "SELECT payload FROM sync_outbox WHERE id = '$idEsc';"
  if (-not $payloadText) { continue }
  $changed = $false
  $next = $payloadText
  foreach ($d in $DropShifts) {
    if ($next.Contains($d)) {
      $next = $next.Replace($d, $KeepShift)
      $changed = $true
    }
  }
  if ($changed) {
    $esc = $next.Replace("'", "''")
    Invoke-Sqlite "UPDATE sync_outbox SET payload = '$esc', entity_id = CASE WHEN entity_type = 'shift' AND entity_id IN ($dropList) THEN '$KeepShift' ELSE entity_id END WHERE id = '$idEsc';" | Out-Null
  }
}

Write-Step "Fetch today's bills from sync API (no admin login)"
$salesUri = "$ApiBase/sync/day-sales?branchId=$BranchId&day=$Day"
try {
  $api = Invoke-RestMethod -Uri $salesUri -Method Get -TimeoutSec 20
  # ใช้บิลทั้งวันของสาขา (ไม่กรอง shift) — จะย้ายเข้า keep shift ใน session
  $apiSales = @($api.sales | Sort-Object createdAt)
  Write-Step ("API returned {0} bills for {1}" -f $apiSales.Count, $Day)
  if ($apiSales.Count -eq 0) {
    Write-Host "WARNING: API returned 0 sales - session may keep old short bill list"
  }
} catch {
  Write-Host "API fetch FAILED: $($_.Exception.Message)"
  Write-Host "Will only rewrite shiftId; bill list/seq may stay wrong"
  $apiSales = @()
}

$metaRaw = Get-SqliteScalar "SELECT value FROM meta WHERE key = '$ActiveKey';"
$session = $null
if ($metaRaw -and $metaRaw.Trim().Length -gt 0) {
  try { $session = $metaRaw | ConvertFrom-Json } catch { $session = $null }
}

function Get-MaxBillSeq($rows) {
  $maxSeq = 0
  foreach ($s in @($rows)) {
    $bn = $null
    if ($s.PSObject.Properties.Name -contains "billNo") { $bn = [string]$s.billNo }
    elseif ($s.PSObject.Properties.Name -contains "bill_no") { $bn = [string]$s.bill_no }
    if ($bn -and ($bn -match "(\d+)$")) {
      $n = [int]$Matches[1]
      if ($n -gt $maxSeq) { $maxSeq = $n }
    }
  }
  return $maxSeq
}

if (-not $session) {
  Write-Host "No active-shift-session - tables updated. Set day bill-seq from API if possible."
  $maxSeq = Get-MaxBillSeq $apiSales
  if ($maxSeq -gt 0) {
    $now = (Get-Date).ToUniversalTime().ToString("o")
    Invoke-Sqlite "INSERT INTO meta(key, value, updated_at) VALUES('bill-seq-$Day', '$maxSeq', '$now') ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at;" | Out-Null
    Write-Step "Set bill-seq-$Day = $maxSeq"
  }
} else {
  $mapped = @()
  if ($apiSales.Count -gt 0) {
    foreach ($r in $apiSales) {
      $payments = @()
      $cashTendered = 0.0
      foreach ($p in @($r.payments)) {
        $payments += @{ method = $p.method; amount = [double]$p.amount }
        if ($p.method -eq "cash") {
          if ($null -ne $p.tendered) { $cashTendered = [double]$p.tendered }
          else { $cashTendered = [double]$p.amount }
        }
      }
      $mapped += @{
        id = $r.id
        billNo = $r.billNo
        at = $r.createdAt
        total = [double]$r.total
        payments = $payments
        cashTendered = $cashTendered
        change = [double]$r.change
        pointsRedeemed = [int]$r.pointsRedeemed
        pointsEarned = [int]$r.pointsEarned
        memberName = $(if ($r.customerName) { $r.customerName } else { "" })
      }
    }
  } else {
    foreach ($s in @($session.sales)) { $mapped += $s }
  }

  $ids = @{}
  foreach ($m in $mapped) { $ids[[string]$m.id] = $true }
  foreach ($s in @($session.sales)) {
    $sid = [string]$s.id
    if (-not $ids.ContainsKey($sid)) {
      $mapped += $s
      $ids[$sid] = $true
    }
  }
  $mapped = @($mapped | Sort-Object { $_.at })
  $maxSeq = Get-MaxBillSeq $mapped
  # Force — อย่าเหลือ billSeq เก่า (เช่น 5) ไว้ ไม่งั้นจอ POS โชว์บิลถัดไป 000006
  $session.billSeq = [int]$maxSeq
  $session.shiftId = $KeepShift
  if ($mapped.Count -gt 0 -and $mapped[0].at) {
    $session.openedAt = $mapped[0].at
  }
  $session.sales = @($mapped)
  $session.version = 1

  # สร้าง JSON ใหม่ทั้งก้อน — กัน ConvertTo-Json จาก object เดิมค้างค่าเก่า
  $payload = [ordered]@{
    version     = 1
    branchId    = [string]$session.branchId
    terminalId  = [string]$session.terminalId
    staff       = $session.staff
    shiftId     = $KeepShift
    openedAt    = [string]$session.openedAt
    openCash    = [double]$session.openCash
    floatCounted = [bool]$session.floatCounted
    floatDenoms = @($session.floatDenoms)
    sales       = @($mapped)
    audits      = @($session.audits)
    cashMoves   = @($session.cashMoves)
    cashCounts  = @($session.cashCounts)
    billSeq     = [int]$maxSeq
  }

  $newJson = ($payload | ConvertTo-Json -Depth 12 -Compress)
  $escJson = $newJson.Replace("'", "''")
  $now = (Get-Date).ToUniversalTime().ToString("o")
  Invoke-Sqlite @"
INSERT INTO meta(key, value, updated_at) VALUES('$ActiveKey', '$escJson', '$now')
ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at;
INSERT INTO meta(key, value, updated_at) VALUES('bill-seq-$Day', '$maxSeq', '$now')
ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at;
"@ | Out-Null

  $gross = 0.0
  foreach ($m in $mapped) {
    if ($null -ne $m.total) { $gross += [double]$m.total }
  }
  Write-Step ("session -> {0} | {1} bills | total {2:N2} | billSeq={3}" -f $KeepShift, $mapped.Count, $gross, $maxSeq)
}

Write-Step "Summary"
Write-Host (Invoke-Sqlite @"
SELECT 'sales_by_shift', IFNULL(shift_id,'(null)'), COUNT(*), ROUND(COALESCE(SUM(total),0),2)
FROM sales GROUP BY shift_id;
SELECT 'open_shifts', id, status, open_cash FROM shifts WHERE status='open';
SELECT 'meta_shift', substr(value,1,120) FROM meta WHERE key='$ActiveKey';
SELECT 'bill_seq', value FROM meta WHERE key='bill-seq-$Day';
"@)

Write-Host ""
Write-Host "DONE - open AP POS 0.1.10. Keep shift: $KeepShift"
exit 0
