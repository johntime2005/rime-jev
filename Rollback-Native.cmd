@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\Rollback-Native.ps1"
set "result=%ERRORLEVEL%"
echo.
pause
exit /b %result%
