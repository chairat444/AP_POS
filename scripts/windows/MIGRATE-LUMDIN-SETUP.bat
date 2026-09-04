@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Migrate หลุมดิน — Setup

echo.
echo === Migrate หลุมดิน — ติดตั้ง Python venv + ทดสอบเชื่อมต่อ ===
echo.

if not exist "migrate-config.local.bat" (
  echo ยังไม่มี migrate-config.local.bat
  echo   copy migrate-config.example.bat migrate-config.local.bat
  echo   แล้วแก้ MSSQL_PASSWORD / DATABASE_URL / MSSQL_HOST
  echo.
  pause
  exit /b 1
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0migrate-lumdin.ps1" -Mode setup
set ERR=%ERRORLEVEL%
echo.
if not "%ERR%"=="0" (
  echo FAILED code %ERR%
  pause
  exit /b %ERR%
)
echo OK
pause
exit /b 0
