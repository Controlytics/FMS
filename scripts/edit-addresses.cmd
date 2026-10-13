@echo off
:: DigiLog - Edit server addresses (Start menu shortcut target).
:: Opens digilog-addresses.ini in Notepad AS ADMINISTRATOR: the file sits in
:: C:\ProgramData\DigiLog\config, next to digilog.env (the secrets), which
:: ordinary users may only read - so a normal Notepad could not save it.
:: The folder's permissions are deliberately NOT loosened.
:: After saving, run "Apply server addresses".
net session >nul 2>&1
if %errorlevel% neq 0 (
    powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)
start "" notepad.exe "%ProgramData%\DigiLog\config\digilog-addresses.ini"
