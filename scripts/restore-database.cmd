@echo off
:: DigiLog - Restore the database from a backup file (Start menu shortcut target).
:: Runs restore-database.ps1, which checks the file, takes a safety backup and
:: replaces the database. Needs Administrator: asks for it if this window does
:: not have it. Step-by-step guide: docs\RESTORE-LARGE-DATABASE.md
net session >nul 2>&1
if %errorlevel% neq 0 (
    powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)
echo.
echo  RESTORE THE FMS DATABASE FROM A BACKUP
echo  Backups on this server, newest first (folder %ProgramData%\DigiLog\backups):
echo.
dir /o-d /a-d "%ProgramData%\DigiLog\backups" 2>nul | findstr /i "\.sql \.dump"
echo.
echo  Type or paste the FULL path of the backup file to restore,
echo  or drag the file onto this window, then press Enter.
echo  (Press Enter on an empty line to cancel - nothing is changed.)
echo.
set "DUMP="
set /p "DUMP=Backup file: "
if not defined DUMP (
    echo No file given. Nothing was changed.
    pause
    exit /b 1
)
set "DUMP=%DUMP:"=%"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0restore-database.ps1" -DumpFile "%DUMP%"
echo.
pause
