# Migrate POS_AP (SQL Server หลุมดิน) -> Postgres AP POS
# อ่าน MSSQL อย่างเดียว · เขียน Postgres เท่านั้น
param(
  [ValidateSet("setup", "dry-run", "apply")]
  [string]$Mode = "dry-run"
)

$ErrorActionPreference = "Stop"
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
$ScriptsRoot = Split-Path -Parent $Here
$ConfigFile = Join-Path $Here "migrate-config.local.bat"

function Write-Step([string]$msg) { Write-Host ">> $msg" -ForegroundColor Cyan }

if (-not (Test-Path $ConfigFile)) {
  Write-Host ""
  Write-Host "ไม่พบ migrate-config.local.bat" -ForegroundColor Red
  Write-Host "  cd $Here"
  Write-Host "  copy migrate-config.example.bat migrate-config.local.bat"
  Write-Host "  แล้วแก้ MSSQL_PASSWORD / DATABASE_URL / MSSQL_HOST"
  exit 1
}

Write-Step "โหลด config"
cmd /c "`"$ConfigFile`" && set MSSQL_" > $null 2>&1
# อ่าน env จาก batch (call แล้ว inherit ใน process เดียว)
$envBlock = cmd /c "`"$ConfigFile`" && set" 2>$null
foreach ($line in $envBlock) {
  if ($line -match "^([^=]+)=(.*)$") {
    $k = $matches[1]
    $v = $matches[2]
    if ($k -match "^(MSSQL_|DATABASE_URL|BRANCH_)") {
      Set-Item -Path "env:$k" -Value $v
    }
  }
}

$required = @("MSSQL_HOST", "MSSQL_PASSWORD", "MSSQL_DB", "DATABASE_URL", "BRANCH_CODE", "BRANCH_NAME")
foreach ($k in $required) {
  if (-not $env:$k) {
    Write-Host "ขาด $k ใน migrate-config.local.bat" -ForegroundColor Red
    exit 1
  }
}
if ($env:MSSQL_PASSWORD -eq "CHANGE_ME") {
  Write-Host "แก้ MSSQL_PASSWORD ใน migrate-config.local.bat ก่อน" -ForegroundColor Red
  exit 1
}

$PyScript = Join-Path $ScriptsRoot "migrate_pos_ap.py"
if (-not (Test-Path $PyScript)) {
  Write-Host "ไม่พบ $PyScript — คัดลอกโฟลเดอร์ scripts ทั้งชุดมาเครื่อง POS" -ForegroundColor Red
  exit 1
}

$VenvDir = Join-Path $ScriptsRoot ".venv-migrate"
$VenvPy = Join-Path $VenvDir "Scripts\python.exe"

function Find-Python {
  foreach ($exe in @("py", "python", "python3")) {
    try {
      if ($exe -eq "py") {
        $v = & py -3 -c "import sys; print(sys.executable)" 2>$null
      } else {
        $v = & $exe -c "import sys; print(sys.executable)" 2>$null
      }
      if ($LASTEXITCODE -eq 0 -and $v) { return ($v | Select-Object -First 1).ToString().Trim() }
    } catch { }
  }
  return $null
}

function Ensure-Venv {
  if (Test-Path $VenvPy) { return $VenvPy }
  Write-Step "สร้าง venv + ติดตั้ง pymssql psycopg (ครั้งแรก)"
  $basePy = Find-Python
  if (-not $basePy) {
    Write-Host "ไม่พบ Python — ติดตั้ง Python 3.10+ จาก python.org แล้วรัน MIGRATE-LUMDIN-SETUP.bat" -ForegroundColor Red
    exit 1
  }
  & $basePy -m venv $VenvDir
  if ($LASTEXITCODE -ne 0) { throw "venv failed" }
  & $VenvPy -m pip install -q --upgrade pip
  & $VenvPy -m pip install -q "psycopg[binary]" pymssql
  if ($LASTEXITCODE -ne 0) { throw "pip install failed" }
  return $VenvPy
}

if ($Mode -eq "setup") {
  $null = Ensure-Venv
  Write-Step "ทดสอบเชื่อม MSSQL..."
  & $VenvPy -c @"
import os, pymssql
c = pymssql.connect(
    server=os.environ['MSSQL_HOST'],
    port=int(os.environ.get('MSSQL_PORT', '1433')),
    user=os.environ.get('MSSQL_USER', 'sa'),
    password=os.environ['MSSQL_PASSWORD'],
    database=os.environ['MSSQL_DB'],
)
cur = c.cursor()
cur.execute('SELECT COUNT(*) FROM TCstMCustomer')
print('  customers:', cur.fetchone()[0])
c.close()
print('MSSQL OK')
"@
  if ($LASTEXITCODE -ne 0) { exit 1 }
  Write-Step "ทดสอบ Postgres..."
  & $VenvPy -c @"
import os, psycopg
u = os.environ['DATABASE_URL']
with psycopg.connect(u) as c:
    with c.cursor() as cur:
        cur.execute('SELECT COUNT(*) FROM branches')
        print('  branches:', cur.fetchone()[0])
print('Postgres OK')
"@
  if ($LASTEXITCODE -ne 0) { exit 1 }
  Write-Host ""
  Write-Host "SETUP OK — รัน MIGRATE-LUMDIN-DRY-RUN.bat ต่อ" -ForegroundColor Green
  exit 0
}

$Py = Ensure-Venv

if ($Mode -eq "apply") {
  Write-Host ""
  Write-Host "=== APPLY จริง ===" -ForegroundColor Yellow
  Write-Host "  MSSQL: $($env:MSSQL_HOST)/$($env:MSSQL_DB)"
  Write-Host "  Postgres: $($env:DATABASE_URL)"
  Write-Host "  สาขา: $($env:BRANCH_CODE) $($env:BRANCH_NAME)"
  Write-Host ""
  Write-Host "แนะนำ backup Postgres ก่อน (pg_dump)" -ForegroundColor Yellow
  $ans = Read-Host "พิมพ์ YES เพื่อ apply"
  if ($ans -ne "YES") {
    Write-Host "ยกเลิก"
    exit 0
  }
}

Write-Step "หยุด AP POS (ถ้าเปิดอยู่)"
Get-Process -Name "AP POS" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

$args = @(
  $PyScript,
  "--branch-code", $env:BRANCH_CODE,
  "--branch-name", $env:BRANCH_NAME,
  "--skip-products"
)
if ($Mode -eq "apply") {
  $args += "--apply"
} else {
  $args += "--dry-run"
}

Write-Step "migrate_pos_ap.py $Mode ..."
Write-Host ""
& $Py @args
exit $LASTEXITCODE
