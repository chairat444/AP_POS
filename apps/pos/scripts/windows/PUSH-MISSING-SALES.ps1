# Push unsynced / missing sales from local POS SQLite to server.
# Use when close-shift Discord count > bills on Admin (e.g. bills 9-18 missing).
# Run on the Jetsamian POS PC. AP POS can stay open.
# ASCII-only script for Windows PowerShell 5.x

$ErrorActionPreference = "Stop"
$ApiBase = "https://pos.chinthurakij.com/api"
$BillFrom = 9
$BillTo = 18
$ShiftIdHint = "1788400812424-7qo5mw"

function Write-Step([string]$msg) { Write-Host (">> " + $msg) }

function Escape-Sql([string]$v) {
  if ($null -eq $v) { return "" }
  return $v.Replace("'", "''")
}

$DbPath = Join-Path $env:APPDATA "@ap-pos\pos\db\ap-pos-local.sqlite"
if (-not (Test-Path $DbPath)) {
  Write-Host ("DB not found: " + $DbPath)
  exit 1
}
Write-Step ("DB: " + $DbPath)

$ToolsDir = Join-Path $env:TEMP "ap-pos-sqlite-tools"
$SqliteExe = Join-Path $ToolsDir "sqlite3.exe"
if (-not (Test-Path $SqliteExe)) {
  Write-Host "sqlite3 not found. Run MERGE-SHIFT-TODAY.bat once first (downloads sqlite3)."
  exit 1
}

function Invoke-Sqlite([string]$sql) {
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $SqliteExe
  $psi.Arguments = '"' + $DbPath + '"'
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
  if ($p.ExitCode -ne 0) { throw ("sqlite3 failed: " + $err) }
  return $out
}

function Invoke-SqliteJson([string]$sql) {
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $SqliteExe
  $psi.Arguments = '"' + $DbPath + '" -json'
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
  if ($p.ExitCode -ne 0) { throw ("sqlite3 failed: " + $err) }
  return $out
}

function Get-SqliteJson([string]$sql) {
  $raw = (Invoke-SqliteJson $sql).Trim()
  if (-not $raw) { return @() }
  try {
    $parsed = $raw | ConvertFrom-Json
    if ($null -eq $parsed) { return @() }
    if ($parsed -is [System.Array]) { return @($parsed) }
    return @($parsed)
  } catch {
    Write-Host "WARN: JSON parse failed for query"
    $n = [Math]::Min(300, $raw.Length)
    Write-Host $raw.Substring(0, $n)
    return @()
  }
}

function Get-BillSeq([string]$billNo) {
  if ($billNo -match "(\d+)$") { return [int]$Matches[1] }
  return -1
}

Write-Step "Local sales still on disk (synced_at empty = not uploaded)"
$localSales = @(Get-SqliteJson "SELECT id, bill_no, shift_id, total, synced_at, created_at FROM sales ORDER BY bill_no;")
Write-Host ("  rows=" + $localSales.Count)
foreach ($s in $localSales) {
  $syncedLabel = "(pending)"
  if ($s.synced_at) { $syncedLabel = [string]$s.synced_at }
  Write-Host ("  " + $s.bill_no + "  total=" + $s.total + "  synced=" + $syncedLabel + "  shift=" + $s.shift_id)
}

Write-Step "Sale outbox pending"
$outboxSales = @(Get-SqliteJson "SELECT id, entity_id, payload FROM sync_outbox WHERE entity_type='sale' ORDER BY created_at;")
Write-Host ("  outbox sales=" + $outboxSales.Count)

$envelopes = New-Object System.Collections.Generic.List[object]
$seen = @{}

foreach ($row in $outboxSales) {
  try {
    $rawPayload = [string]$row.payload
    $envObj = $rawPayload | ConvertFrom-Json
    if (-not $envObj.payload) { continue }
    $billNo = [string]$envObj.payload.billNo
    $seq = Get-BillSeq $billNo
    if ($BillFrom -gt 0 -and ($seq -lt $BillFrom -or $seq -gt $BillTo)) { continue }
    $eid = [string]$envObj.id
    if ($seen.ContainsKey($eid)) { continue }
    $seen[$eid] = $true
    [void]$envelopes.Add($envObj)
  } catch {
    Write-Host ("WARN: skip outbox " + $row.id)
  }
}

# Rebuild from sales table if still on disk but outbox gone
foreach ($s in $localSales) {
  if ($s.synced_at) { continue }
  $seq = Get-BillSeq ([string]$s.bill_no)
  if ($BillFrom -gt 0 -and ($seq -lt $BillFrom -or $seq -gt $BillTo)) { continue }
  $outboxId = ([string]$s.id) + ":outbox"
  if ($seen.ContainsKey($outboxId)) { continue }

  $sid = Escape-Sql ([string]$s.id)
  $lines = @(Get-SqliteJson ("SELECT id, barcode, product_code, name, qty, unit, unit_price, discount, line_total FROM sale_lines WHERE sale_id='" + $sid + "';"))
  $pays = @(Get-SqliteJson ("SELECT method, amount, tendered FROM sale_payments WHERE sale_id='" + $sid + "';"))
  if (-not $lines.Count) {
    Write-Host ("WARN: sale " + $s.bill_no + " has no lines - skip")
    continue
  }

  $full = Get-SqliteJson ("SELECT * FROM sales WHERE id='" + $sid + "';") | Select-Object -First 1
  if (-not $full) {
    Write-Host ("WARN: sale " + $s.bill_no + " row missing - skip")
    continue
  }

  $payList = @()
  foreach ($pay in $pays) {
    $tendered = $null
    if ($null -ne $pay.tendered) { $tendered = [double]$pay.tendered }
    $payList += @{
      method   = [string]$pay.method
      amount   = [double]$pay.amount
      tendered = $tendered
    }
  }

  $lineList = @()
  foreach ($ln in $lines) {
    $lineList += @{
      id          = [string]$ln.id
      barcode     = [string]$ln.barcode
      productCode = $ln.product_code
      name        = [string]$ln.name
      qty         = [double]$ln.qty
      unit        = [string]$ln.unit
      unitPrice   = [double]$ln.unit_price
      discount    = [double]$ln.discount
      lineTotal   = [double]$ln.line_total
    }
  }

  $shiftId = [string]$full.shift_id
  if (-not $shiftId) { $shiftId = $ShiftIdHint }

  $payload = [ordered]@{
    id             = [string]$full.id
    billNo         = [string]$full.bill_no
    branchId       = [string]$full.branch_id
    terminalId     = [string]$full.terminal_id
    shiftId        = $shiftId
    customerId     = $full.customer_id
    customerName   = $full.customer_name
    subtotal       = [double]$full.subtotal
    discount       = [double]$full.discount
    pointsRedeemed = [int]$full.points_redeemed
    pointsEarned   = [int]$full.points_earned
    total          = [double]$full.total
    paid           = [double]$full.paid
    change         = [double]$full.change
    createdAt      = [string]$full.created_at
    payments       = $payList
    lines          = $lineList
  }

  [void]$envelopes.Add([ordered]@{
    id      = $outboxId
    type    = "sale"
    payload = $payload
  })
  $seen[$outboxId] = $true
}

if (-not $envelopes.Count) {
  Write-Host ""
  Write-Host "NOTHING TO PUSH"
  Write-Host ("Local disk has no pending bills " + $BillFrom + "-" + $BillTo + ".")
  Write-Host "They were likely deleted after a false sync ack - cannot recover from this PC."
  Write-Host "Check Windows File History / backup of:"
  Write-Host ("  " + $DbPath)
  exit 2
}

Write-Step ("Ready to push " + $envelopes.Count + " sale(s)")
$sum = 0.0
foreach ($e in $envelopes) {
  $p = $e.payload
  $sum += [double]$p.total
  Write-Host ("  " + $p.billNo + "  " + $p.id + "  baht=" + $p.total)
}
Write-Host ("  SUM=" + $sum)

$body = @{ sales = @($envelopes.ToArray()) } | ConvertTo-Json -Depth 20 -Compress
Write-Step ("POST " + $ApiBase + "/sync/sales")
try {
  $res = Invoke-RestMethod -Uri ($ApiBase + "/sync/sales") -Method Post -Body $body -ContentType "application/json; charset=utf-8" -TimeoutSec 60
  Write-Host ("OK accepted=" + $res.accepted)
  if ($res.acceptedIds) {
    Write-Host ("acceptedIds=" + ($res.acceptedIds -join ", "))
  }
} catch {
  Write-Host ("PUSH FAILED: " + $_.Exception.Message)
  if ($_.ErrorDetails.Message) { Write-Host $_.ErrorDetails.Message }
  exit 1
}

Write-Host ""
Write-Host ("Done. Ask admin to refresh Sales / fix shift totals for " + $ShiftIdHint)
Write-Host "Expected after recover: ~50 bills / ~8907 if all 10 returned."
