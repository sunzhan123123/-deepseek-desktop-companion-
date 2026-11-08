@echo off
setlocal
powershell.exe -NoProfile -WindowStyle Hidden -File "%~dp0stop-deepseek-chat-v1.ps1"
if errorlevel 1 pause
endlocal
