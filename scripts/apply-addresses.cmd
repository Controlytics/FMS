@echo off
:: DigiLog - Apply server addresses (Start menu shortcut target).
:: Applies C:\ProgramData\DigiLog\config\digilog-addresses.ini: HTTPS
:: certificate, port, allowed origins, firewall, then restarts the API.
:: Needs Administrator: asks for it if this window does not have it.
net session >nul 2>&1
if %errorlevel% neq 0 (
    powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0apply-addresses.ps1"
echo.
pause
