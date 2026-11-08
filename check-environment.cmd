@echo off
setlocal
powershell.exe -NoLogo -NoProfile -File "%~dp0check-environment.ps1"
set "companionCheckExit=%errorlevel%"
echo.
pause
exit /b %companionCheckExit%
