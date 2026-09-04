@echo off
cd /d "%~dp0"
echo === CHECK active shift in local SQLite ===
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0CHECK-ACTIVE-SHIFT.ps1"
echo.
pause
