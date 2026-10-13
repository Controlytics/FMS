@echo off
:: ============================================================================
:: apply-addresses.bat - apply digilog-addresses.ini (this folder) to the
:: local DigiLog: HTTPS certificate, API port + allowed origins, firewall
:: check, then reload the API and the web page.
::
:: Edit digilog-addresses.ini whenever this PC's IP, name or a port changes,
:: then double-click this file. A mistake in the file stops it before anything
:: is changed. The tablet keeps trusting the certificate (same mkcert root).
:: No Administrator rights needed. DEV machine only - an installed server has
:: "Apply server addresses" in the Start menu instead.
:: ============================================================================
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\refresh-lan-cert.ps1"
echo.
pause
