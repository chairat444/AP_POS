@echo off
chcp 65001 >nul
echo === PUSH MISSING SALES (bills 9-18) ===
echo Run this on Jetsamian POS PC
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0PUSH-MISSING-SALES.ps1"
echo.
pause
