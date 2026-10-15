@echo off
chcp 65001 >nul
echo === CLEAR LOCAL DATA FOR BAN KHONG ===
echo Close AP POS first. Run on the POS PC that was used for testing.
echo This wipes local bills/shifts/outbox and sets branch to Ban Khong.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0CLEAR-FOR-BAN-KHONG.ps1"
echo.
pause
