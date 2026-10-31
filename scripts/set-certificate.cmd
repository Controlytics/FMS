@echo off
:: DigiLog - Change SSL certificate (Start menu shortcut target).
:: Switches FMS to a company / bought HTTPS certificate (.pfx, or .crt + .key),
:: or back to its own one. Checks the files first and rolls back automatically
:: if FMS does not come up on them. Needs Administrator: asks for it if this
:: window does not have it.
net session >nul 2>&1
if %errorlevel% neq 0 (
    powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0set-certificate.ps1"
echo.
pause
