# Clear local POS test data and prepare machine for Ban Khong (branch-003).
# Pure transactional wipe — keeps products/members/printer/API settings.
# ASCII-safe script body; Thai branch name via Unicode escapes.
$ErrorActionPreference = "Stop"

function Write-Step([string]$msg) { Write-Host (">> " + $msg) }

# branch-003 = Ban Khong
$TargetBranchId = "branch-003"
$TargetBranchName = -join @(
  [char]0x0E1A, [char]0x0E49, [char]0x0E32, [char]0x0E19,
  [char]0x0E06, [char]0x0E49, [char]0x0E2D, [char]0x0E07
)

$DbPath = Join-Path $env:APPDATA "@ap-pos\pos\db\ap-pos-local.sqlite"
if (-not (Test-Path $DbPath)) {
  Write-Host "DB not found: $DbPath"
  Write-Host "Run this on the POS PC (same Windows user that runs AP POS)."
  exit 1
}

# Refuse if AP POS looks running (sqlite locked / half-written)
$posProcs = @(Get-Process -ErrorAction SilentlyContinue | Where-Object {
  $_.ProcessName -match "^(AP POS|electron|ap-pos)$" -or
  ($_.MainWindowTitle -and $_.MainWindowTitle -match "AP POS")
})
if ($posProcs.Count -gt 0) {
  Write-Host "AP POS still looks open. Close POS completely, then run again."
  foreach ($p in $posProcs) {
    Write-Host ("  pid={0} name={1}" -f $p.Id, $p.ProcessName)
  }
  exit 1
}

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
  $psi.Arguments = '"' + $DbPath + '" -header -column'
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

function Invoke-SqliteRaw([string]$sql) {
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
  if ($p.ExitCode -ne 0) { throw "sqlite3 failed: $err" }
  return $out
}

Write-Host "=== CLEAR LOCAL DATA FOR BAN KHONG ==="
Write-Host ("time : " + (Get-Date -Format "yyyy-MM-dd HH:mm:ss"))
Write-Host ("db   : " + $DbPath)
Write-Host ("set  : " + $TargetBranchId + " / " + $TargetBranchName)
Write-Host ""
Write-Host "BEFORE:"
Write-Host (Invoke-Sqlite @"
SELECT 'sales' AS t, COUNT(*) AS c FROM sales
UNION ALL SELECT 'shifts', COUNT(*) FROM shifts
UNION ALL SELECT 'outbox', COUNT(*) FROM sync_outbox
UNION ALL SELECT 'audits', COUNT(*) FROM shift_audits;
"@)
Write-Host ""
Write-Host "device-config / env (before):"
Write-Host (Invoke-Sqlite "SELECT key, substr(value,1,120) AS value FROM meta WHERE key IN ('device-config','pos-env-mode','active-shift-session') ORDER BY key;")
Write-Host ""
Write-Host "This will DELETE local sales, shifts, audits, outbox, active shift, bill seq."
Write-Host "Keeps: products, members, printer, API URL."
Write-Host "Then sets machine to Ban Khong (prod) with a new terminal id."
Write-Host ""
$confirm = Read-Host "Type YES to continue"
if ($confirm -ne "YES") {
  Write-Host "Cancelled."
  exit 0
}

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$BackupDir = Join-Path $env:USERPROFILE "Desktop"
if (-not (Test-Path $BackupDir)) { $BackupDir = $env:TEMP }
$Backup = Join-Path $BackupDir ("AP-POS-before-ban-khong-" + $stamp + ".sqlite")
Write-Step ("Backup -> " + $Backup)
Copy-Item -LiteralPath $DbPath -Destination $Backup -Force

$terminalId = "terminal-" + [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds().ToString("x") + "-" + ([guid]::NewGuid().ToString("N").Substring(0, 6))
$now = (Get-Date).ToUniversalTime().ToString("o")
$deviceJson = (@{
  branchId = $TargetBranchId
  branchName = $TargetBranchName
  terminalId = $terminalId
  terminalName = "POS 1"
  setupDone = $false
} | ConvertTo-Json -Compress)
# Escape single quotes for SQL string literal
$deviceSql = $deviceJson.Replace("'", "''")

Write-Step "Wiping transactional tables + session meta..."
$sql = @"
BEGIN;
DELETE FROM sale_payments;
DELETE FROM sale_lines;
DELETE FROM sales;
DELETE FROM sync_outbox;
DELETE FROM shift_audits;
DELETE FROM shifts;
DELETE FROM meta WHERE key = 'active-shift-session'
  OR key = 'pending-member-creates'
  OR key LIKE 'bill-seq-%';
INSERT INTO meta(key, value, updated_at) VALUES('pos-env-mode', 'prod', '$now')
  ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;
INSERT INTO meta(key, value, updated_at) VALUES('device-config', '$deviceSql', '$now')
  ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;
COMMIT;
"@
$null = Invoke-SqliteRaw $sql

Write-Host ""
Write-Host "AFTER:"
Write-Host (Invoke-Sqlite @"
SELECT 'sales' AS t, COUNT(*) AS c FROM sales
UNION ALL SELECT 'shifts', COUNT(*) FROM shifts
UNION ALL SELECT 'outbox', COUNT(*) FROM sync_outbox
UNION ALL SELECT 'audits', COUNT(*) FROM shift_audits
UNION ALL SELECT 'products', COUNT(*) FROM products
UNION ALL SELECT 'customers', COUNT(*) FROM customers;
"@)
Write-Host ""
Write-Host "device-config / env (after):"
Write-Host (Invoke-Sqlite "SELECT key, value FROM meta WHERE key IN ('device-config','pos-env-mode') ORDER BY key;")
Write-Host ""
Write-Host "OK. Backup kept at:"
Write-Host ("  " + $Backup)
Write-Host "Next: open AP POS -> open shift -> confirm branch Ban Khong -> claim terminal."
exit 0
