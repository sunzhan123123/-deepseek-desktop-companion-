@echo off
setlocal
powershell.exe -NoProfile -WindowStyle Hidden -File "%~dp0start-deepseek-chat-v1.ps1"
if errorlevel 1 (
  echo Chat window could not start. Check the application log or open the PowerShell launcher for details.
  pause
)
endlocal
