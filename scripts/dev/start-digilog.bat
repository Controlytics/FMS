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
echo   DigiLog - Starting All Services (pg-boss)
echo  ============================================
echo.

:: --- 1. Start EMQX MQTT Broker ---
echo [1/4] Starting EMQX MQTT Broker...
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

:: --- 2. Check PostgreSQL (used by Prisma, TimescaleDB, and pg-boss) ---
echo [2/4] Checking PostgreSQL...
"C:\Program Files\PostgreSQL\18\bin\pg_isready.exe" -h localhost -p 5432 >NUL 2>&1
if %ERRORLEVEL%==0 (
    echo       PostgreSQL running on port 5432
) else (
    echo       [FATAL] PostgreSQL is NOT running!
    echo       Open Services ^(services.msc^) and start postgresql-x64-18
    echo       pg-boss needs PostgreSQL for the job queue.
    pause
    exit /b 1
)

:: --- 3. Start Backend API ---
echo [3/4] Starting Backend API (Fastify)...
start "DigiLog API" cmd /k "cd /d C:\Users\hello\21cfrlogbook-DigitalFMS\apps\api && title DigiLog API - Port 3000 HTTPS && set API_HTTPS=true&&npx tsx watch src/app.ts"
timeout /t 8 /nobreak >NUL
echo       API starting on https://localhost:3000

:: --- 4. Start Frontend ---
echo [4/4] Starting Frontend (Vite)...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":5175" ^| findstr "LISTENING"') do (
    echo       Killing old Vite process PID %%a ...
    taskkill /F /PID %%a >NUL 2>&1
)
timeout /t 2 /nobreak >NUL
start "DigiLog Web" cmd /k "cd /d C:\Users\hello\21cfrlogbook-DigitalFMS\apps\web && title DigiLog Web - Port 5175 && npx vite --host"
timeout /t 5 /nobreak >NUL
echo       Frontend starting on https://localhost:5175

:: --- Wait for API to be ready ---
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

:: --- Verify proxy chain (Vite -> API) ---
echo  Verifying proxy chain...
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
echo   Queue:     pg-boss (uses PostgreSQL - no Redis needed)
echo   Login:     superadmin / Admin@123
echo.
echo  ============================================
echo.

start https://localhost:5175

echo Press any key to exit this window (services keep running)...
pause >NUL
