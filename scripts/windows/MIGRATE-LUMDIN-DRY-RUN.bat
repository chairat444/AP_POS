@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Migrate หลุมดิน — Dry-run

echo.
echo === Migrate หลุมดิน — DRY-RUN (ไม่เขียน Postgres) ===
echo.

if not exist "migrate-config.local.bat" (
  echo รัน MIGRATE-LUMDIN-SETUP.bat ก่อน หรือ copy migrate-config.example.bat
  pause
  exit /b 1
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0migrate-lumdin.ps1" -Mode dry-run
set ERR=%ERRORLEVEL%
echo.
if not "%ERR%"=="0" (
  echo FAILED code %ERR%
  pause
  exit /b %ERR%
)
echo OK — ดูตัวเลขด้านบน แล้วค่อยรัน MIGRATE-LUMDIN-APPLY.bat
pause
exit /b 0
