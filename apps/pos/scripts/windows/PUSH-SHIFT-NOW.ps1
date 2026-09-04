# Push pending shift (open + float count) from local POS SQLite to server.
# Use when bills synced but Admin shows no shift / no float.
# AP POS can stay open — reads outbox only.

$ErrorActionPreference = "Stop"

$ApiBase = "https://pos.chinthurakij.com/api"

function Write-Step($msg) { Write-Host ">> $msg" }

$DbPath = Join-Path $env:APPDATA "@ap-pos\pos\db\ap-pos-local.sqlite"
if (-not (Test-Path $DbPath)) {
  Write-Host "DB not found: $DbPath"
  exit 1
}
Write-Step "DB: $DbPath"

$ToolsDir = Join-Path $env:TEMP "ap-pos-sqlite-tools"
$SqliteExe = Join-Path $ToolsDir "sqlite3.exe"
if (-not (Test-Path $SqliteExe)) {
  Write-Host "sqlite3 not found. Run MERGE-SHIFT-TODAY.bat once first (downloads sqlite3)."
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

function Get-SqliteScalar([string]$sql) {
  $o = Invoke-Sqlite $sql
  return ($o -split "`r?`n" | Where-Object { $_.Trim() -ne "" } | Select-Object -First 1)
}

$outboxRaw = Get-SqliteScalar @"
SELECT payload FROM sync_outbox
WHERE entity_type = 'shift'
ORDER BY created_at DESC
LIMIT 1;
"@

$shiftPayload = $null
if ($outboxRaw -and $outboxRaw.Trim().Length -gt 0) {
  try {
    $env = $outboxRaw | ConvertFrom-Json
    if ($env.payload) { $shiftPayload = $env.payload }
  } catch {
    Write-Host "WARN: outbox JSON parse failed — will build from active-shift-session"
  }
}

if (-not $shiftPayload) {
  Write-Step "No shift outbox — building from active-shift-session"
  $sessionRaw = Get-SqliteScalar "SELECT value FROM meta WHERE key='active-shift-session';"
  if (-not $sessionRaw) {
    Write-Host "No active-shift-session and no shift outbox — nothing to push"
    exit 1
  }
  $s = $sessionRaw | ConvertFrom-Json
  $gross = 0.0
  foreach ($sale in @($s.sales)) {
    if ($null -ne $sale.total) { $gross += [double]$sale.total }
  }
  $shiftPayload = [ordered]@{
    id           = [string]$s.shiftId
    branchId     = [string]$s.branchId
    terminalId   = [string]$s.terminalId
    staffId      = [string]$s.staff.id
    staffCode    = [string]$s.staff.code
    staffName    = [string]$s.staff.name
    openedAt     = [string]$s.openedAt
    closedAt     = $null
    openCash     = [double]$s.openCash
    status       = "open"
    billCount    = @($s.sales).Count
    grossTotal   = $gross
    cashMoves    = @($s.cashMoves)
    cashCounts   = @($s.cashCounts)
    summary      = @{ floatCounted = [bool]$s.floatCounted }
  }
}

$shiftId = [string]$shiftPayload.id
Write-Step ("Pushing shift {0} ({1}) openCash={2} bills={3}" -f $shiftId, $shiftPayload.staffName, $shiftPayload.openCash, $shiftPayload.billCount)

$body = @{ shifts = @($shiftPayload) } | ConvertTo-Json -Depth 12 -Compress
try {
  $resp = Invoke-RestMethod -Uri "$ApiBase/sync/shifts" -Method Post -Body $body -ContentType "application/json; charset=utf-8" -TimeoutSec 20
  Write-Host ("Server accepted: {0}" -f ($resp.accepted -join ", "))
} catch {
  Write-Host "POST FAILED: $($_.Exception.Message)"
  exit 1
}

$outboxId = "$shiftId`:shift:outbox"
$idEsc = $outboxId.Replace("'", "''")
$now = (Get-Date).ToUniversalTime().ToString("o")
Invoke-Sqlite @"
UPDATE shifts SET synced_at = '$now' WHERE id = '$($shiftId.Replace("'","''"))';
DELETE FROM sync_outbox WHERE id = '$idEsc';
"@ | Out-Null

Write-Step "Done — check Admin > รอบกะ"
exit 0
