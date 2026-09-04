@echo off
cd /d "%~dp0"
echo === MERGE shift today into a3zyzl (local SQLite) ===
echo Close AP POS first if it is still open.
echo.

taskkill /IM "AP POS.exe" /F >nul 2>&1
timeout /t 2 /nobreak >nul

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0MERGE-SHIFT-TODAY.ps1"
set ERR=%ERRORLEVEL%
echo.
if not "%ERR%"=="0" (
  echo FAILED code %ERR%
  pause
  exit /b %ERR%
)
echo OK - open AP POS 0.1.10 next. Do NOT close-shift before merge.
pause
exit /b 0
