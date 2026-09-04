@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Migrate หลุมดิน — Apply

echo.
echo === Migrate หลุมดิน — APPLY จริง ===
echo ปิด AP POS ก่อน · backup Postgres ก่อน
echo.

if not exist "migrate-config.local.bat" (
  echo รัน MIGRATE-LUMDIN-SETUP.bat ก่อน
  pause
  exit /b 1
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0migrate-lumdin.ps1" -Mode apply
set ERR=%ERRORLEVEL%
echo.
if not "%ERR%"=="0" (
  echo FAILED code %ERR%
  pause
  exit /b %ERR%
)
echo OK — เปิด AP POS ใหม่ แล้วทดสอบค้นหาสมาชิก / ขาย 1 บิล
pause
exit /b 0
