@echo off
setlocal enabledelayedexpansion
if not "%~1"=="wrapped" (
    cmd /k ""%~f0" wrapped"
    exit /b
)
title DigiLog - Starting All Services
color 0A
echo.
echo  ============================================
echo   DigiLog - Starting All Services
echo  ============================================
echo.

:: --- 1. Check Redis (Memurai) is responding ---
:: Memurai is installed as a Windows service with auto-start, so it should
:: already be running after a reboot. We just verify it responds.
echo [1/5] Checking Redis (Memurai)...
redis-cli -p 6379 ping >NUL 2>&1
if errorlevel 1 (
    echo       Memurai not responding - trying to start service...
    net start Memurai >NUL 2>&1
    timeout /t 3 /nobreak >NUL
    redis-cli -p 6379 ping >NUL 2>&1
    if errorlevel 1 (
        echo.
        echo  [FATAL] Memurai not responding on port 6379.
        echo          Run as admin: net start Memurai
        echo          Or install:   winget install Memurai.MemuraiDeveloper
        echo.
        pause
        exit /b 1
    )
)
echo       Memurai OK

:: --- 2. Start EMQX ---
echo [2/5] Starting EMQX MQTT Broker...
cmd /c ""C:\Users\hello\emqx\bin\emqx.cmd" ping" >NUL 2>&1
if %ERRORLEVEL%==0 (
    echo       EMQX already running - skipping
) else (
    start "DigiLog EMQX" /MIN cmd /c "call C:\Users\hello\emqx\bin\emqx.cmd start"
    set EMQX_READY=0
    for /L %%i in (1,1,12) do (
        if !EMQX_READY! == 0 (
            timeout /t 5 /nobreak >NUL
            cmd /c ""C:\Users\hello\emqx\bin\emqx.cmd" ping" >NUL 2>&1
            if !ERRORLEVEL! == 0 set EMQX_READY=1
        )
    )
    if !EMQX_READY! == 1 (
        echo       EMQX started on port 1883
    ) else (
        echo       [WARNING] EMQX failed to start within 60s! Check logs.
    )
)

:: --- 3. Check PostgreSQL ---
echo [3/5] Checking PostgreSQL...
"C:\Program Files\PostgreSQL\18\bin\pg_isready.exe" -h localhost -p 5432 >NUL 2>&1
if %ERRORLEVEL%==0 (
    echo       PostgreSQL running on port 5432
) else (
    echo       [WARNING] PostgreSQL is NOT running! Start it manually.
    echo       Open Services services.msc and start postgresql-x64-18
)

:: --- 4. Start Backend API ---
echo [4/5] Starting Backend API (Fastify)...
start "DigiLog API" cmd /k "cd /d C:\Users\hello\21cfrlogbook-DigitalFMS\apps\api && title DigiLog API - Port 3000 HTTPS && set API_HTTPS=true&&npx tsx watch src/app.ts"
timeout /t 8 /nobreak >NUL
echo       API starting on https://localhost:3000

:: --- 5. Start Frontend ---
echo [5/5] Starting Frontend (Vite)...
:: Kill any existing Vite process on port 5175 first
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":5175" ^| findstr "LISTENING"') do (
    echo       Killing old Vite process PID %%a ...
    taskkill /F /PID %%a >NUL 2>&1
)
timeout /t 2 /nobreak >NUL
start "DigiLog Web" cmd /k "cd /d C:\Users\hello\21cfrlogbook-DigitalFMS\apps\web && title DigiLog Web - Port 5175 && npx vite --host"
timeout /t 5 /nobreak >NUL
echo       Frontend starting on https://localhost:5175

:: --- Wait for API to be ready (direct) ---
echo.
echo  Waiting for API to be ready...
set API_READY=0
for /L %%i in (1,1,40) do (
    if !API_READY! == 0 (
        curl -sk -f https://localhost:3000/api/health >NUL 2>&1
        if !ERRORLEVEL! == 0 (
            set API_READY=1
            echo       API is ready!
        ) else (
            echo       Attempt %%i/40 - API not ready yet...
            timeout /t 3 /nobreak >NUL
        )
    )
)
if !API_READY! == 0 (
    echo       [WARNING] API did not respond within 120s.
)

:: --- Wait for Vite dev server to be ready ---
echo  Waiting for Frontend to be ready...
set VITE_READY=0
for /L %%i in (1,1,30) do (
    if !VITE_READY! == 0 (
        curl -sk -f https://localhost:5175/ >NUL 2>&1
        if !ERRORLEVEL! == 0 (
            set VITE_READY=1
            echo       Frontend is ready!
        ) else (
            timeout /t 2 /nobreak >NUL
        )
    )
)

:: --- Wait for Vite proxy -> API to return JSON (end-to-end) ---
:: This is the critical check - prevents "failed to parse server response"
:: on first login by ensuring the proxy chain is fully warm.
echo  Verifying proxy chain (Vite -^> API)...
set PROXY_READY=0
for /L %%i in (1,1,20) do (
    if !PROXY_READY! == 0 (
        curl -sk -f https://localhost:3000/api/health >NUL 2>&1
        if !ERRORLEVEL! == 0 (
            set PROXY_READY=1
            echo       Proxy chain is ready!
        ) else (
            echo       Attempt %%i/20 - proxy not ready yet...
            timeout /t 2 /nobreak >NUL
        )
    )
)
if !PROXY_READY! == 0 (
    echo       [WARNING] Proxy chain not ready - login may fail on first try.
)

:: Extra settle time for tsx watch to finish compilation
timeout /t 3 /nobreak >NUL

:: --- Done ---
echo.
echo  ============================================
echo   All services started!
echo  ============================================
echo.
echo   Frontend:  https://localhost:5175
echo   API:       https://localhost:3000
echo   Swagger:   https://localhost:3000/docs
echo   EMQX:      http://localhost:18083
echo   Login:     superadmin / Admin@123
echo.
echo  ============================================
echo.

:: Open browser
start https://localhost:5175

echo Press any key to exit this window (services keep running)...
pause >NUL
