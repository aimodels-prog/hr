@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0repair-startup.ps1"
if errorlevel 1 (
  echo Startup repair failed. Run repair-startup.ps1 in an Administrator PowerShell window to see the details.
) else (
  echo Automatic startup is configured. Your existing pairing has been kept.
)
pause
