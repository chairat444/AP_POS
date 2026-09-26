# Read-only check: pending sales + outbox (stuck sync / HTTP 403)
# Pure ASCII only - safe on Thai Windows encodings.
$ErrorActionPreference = "Stop"

function Write-Step([string]$msg) { Write-Host (">> " + $msg) }

$DbPath = Join-Path $env:APPDATA "@ap-pos\pos\db\ap-pos-local.sqlite"
if (-not (Test-Path $DbPath)) {
  Write-Host "DB not found: $DbPath"
  Write-Host "Run this on the POS PC (same Windows user that runs AP POS)."
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
  $null = $p.StandardError.ReadToEnd()
  $p.WaitForExit()
  return $out
}

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$ReportDir = Join-Path $env:USERPROFILE "Desktop"
if (-not (Test-Path $ReportDir)) { $ReportDir = $env:TEMP }
$Report = Join-Path $ReportDir ("AP-POS-stuck-sync-" + $stamp + ".txt")
$DbCopy = Join-Path $ReportDir ("AP-POS-local-copy-" + $stamp + ".sqlite")

$buf = New-Object System.Collections.Generic.List[string]
function L([string]$s) {
  Write-Host $s
  [void]$buf.Add($s)
}

L "=== AP POS STUCK SYNC CHECK ==="
L ("time: " + (Get-Date -Format "yyyy-MM-dd HH:mm:ss"))
L ("DB:   " + $DbPath)
L ("size: " + ((Get-Item $DbPath).Length) + " bytes")
L ""

$envMode = (Invoke-SqliteRaw "SELECT value FROM meta WHERE key='pos-env-mode';").Trim()
L ("pos-env-mode: " + $(if ($envMode) { $envMode } else { "(not set)" }))
L ""

L "=== PENDING SALES (synced_at IS NULL) ==="
$pending = Invoke-Sqlite @"
SELECT bill_no AS bill,
       ROUND(total,0) AS total,
       datetime(created_at) AS created,
       id,
       CASE WHEN synced_at IS NULL THEN 'PENDING' ELSE 'OK' END AS sync
FROM sales
WHERE synced_at IS NULL
ORDER BY created_at;
"@
L $pending
$pendingCount = (Invoke-SqliteRaw "SELECT COUNT(*) FROM sales WHERE synced_at IS NULL;").Trim()
L ("pending_count=" + $pendingCount)
L ""

L "=== DETAIL PER PENDING BILL ==="
$idsRaw = Invoke-SqliteRaw "SELECT id FROM sales WHERE synced_at IS NULL ORDER BY created_at;"
$idList = @($idsRaw -split "`r?`n" | Where-Object { $_.Trim() -ne "" })
foreach ($sid in $idList) {
  $sid = $sid.Trim()
  if (-not $sid) { continue }
  L ("---- sale_id=" + $sid + " ----")
  L (Invoke-Sqlite @"
SELECT bill_no, ROUND(total,2) AS total, branch_id, terminal_id, shift_id,
       customer_id, datetime(created_at) AS created, synced_at
FROM sales WHERE id='$sid';
"@)
  $nLines = (Invoke-SqliteRaw "SELECT COUNT(*) FROM sale_lines WHERE sale_id='$sid';").Trim()
  $nPays = (Invoke-SqliteRaw "SELECT COUNT(*) FROM sale_payments WHERE sale_id='$sid';").Trim()
  L ("sale_lines_count=" + $nLines)
  L ("sale_payments_count=" + $nPays)
  if ([int]$nLines -eq 0) {
    L "DIAG: NO sale_lines - install AP POS 0.1.26+ then push pending again."
  }
  L "lines:"
  L (Invoke-Sqlite "SELECT id, barcode, name, qty, unit, line_total FROM sale_lines WHERE sale_id='$sid';")
  L "payments:"
  L (Invoke-Sqlite "SELECT method, amount, tendered FROM sale_payments WHERE sale_id='$sid';")
  $oid = $sid + ":outbox"
  L "outbox:"
  L (Invoke-Sqlite @"
SELECT id, entity_type, attempts, last_error,
       length(payload) AS payload_bytes,
       substr(payload,1,120) AS payload_head
FROM sync_outbox WHERE id='$oid' OR entity_id='$sid';
"@)
  L ""
}

L "=== FOCUS: S260926-001-000008 / 000045 ==="
foreach ($bn in @("S260926-001-000008", "S260926-001-000045")) {
  L ("-- " + $bn + " --")
  L (Invoke-Sqlite @"
SELECT id, bill_no, ROUND(total,2), synced_at, datetime(created_at)
FROM sales WHERE bill_no='$bn';
"@)
  $sid = (Invoke-SqliteRaw "SELECT id FROM sales WHERE bill_no='$bn' LIMIT 1;").Trim()
  if ($sid) {
    $nLines = (Invoke-SqliteRaw "SELECT COUNT(*) FROM sale_lines WHERE sale_id='$sid';").Trim()
    $nPays = (Invoke-SqliteRaw "SELECT COUNT(*) FROM sale_payments WHERE sale_id='$sid';").Trim()
    $err = (Invoke-SqliteRaw "SELECT last_error FROM sync_outbox WHERE entity_id='$sid' OR id='${sid}:outbox' LIMIT 1;").Trim()
    L ("lines=" + $nLines + " payments=" + $nPays + " last_error=" + $(if ($err) { $err } else { "(none)" }))
  } else {
    L "not found in local sales table"
  }
  L ""
}

L "=== OUTBOX SUMMARY ==="
L (Invoke-Sqlite @"
SELECT entity_type, COUNT(*) AS n,
       SUM(CASE WHEN last_error IS NOT NULL AND last_error != '' THEN 1 ELSE 0 END) AS with_error
FROM sync_outbox
GROUP BY entity_type;
"@)
L "outbox errors:"
L (Invoke-Sqlite @"
SELECT entity_type, entity_id, attempts, last_error
FROM sync_outbox
WHERE last_error IS NOT NULL AND last_error != ''
ORDER BY created_at DESC
LIMIT 20;
"@)
L ""

L "=== COPY DB TO DESKTOP ==="
try {
  Copy-Item -LiteralPath $DbPath -Destination $DbCopy -Force
  L ("copied: " + $DbCopy)
} catch {
  L ("copy failed: " + $_.Exception.Message)
}

$buf | Set-Content -Path $Report -Encoding UTF8
L ""
L ("report saved: " + $Report)
L "Send the .txt (and .sqlite copy if asked) to support."
L "Done. Read-only - no data changed."
exit 0
