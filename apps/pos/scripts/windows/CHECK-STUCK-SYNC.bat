@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo === CHECK STUCK SYNC ===
echo Read-only. Does not change data.
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0CHECK-STUCK-SYNC.ps1"
echo.
pause
