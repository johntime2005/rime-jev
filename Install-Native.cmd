@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\Install-Windows.ps1" -Native %*
set "result=%ERRORLEVEL%"
echo.
pause
exit /b %result%
