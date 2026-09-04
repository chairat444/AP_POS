@echo off
chcp 65001 >nul
echo === FIND MISSING BILLS 9-18 ===
echo Searches this PC only. Does not change data.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0FIND-MISSING-BILLS.ps1"
echo.
pause
