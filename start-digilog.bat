@echo off
setlocal enabledelayedexpansion
title DigiLog - Starting All Services
color 0A
echo.
echo  ============================================
echo   DigiLog - Starting All Services
echo  ============================================
echo.

:: --- 1. Start Redis 5 ---
echo [1/5] Starting Redis...
tasklist /FI "IMAGENAME eq redis-server.exe" 2>NUL | find /I "redis-server.exe" >NUL
if %ERRORLEVEL%==0 (
    echo       Redis already running - skipping
) else (
    start "DigiLog Redis" /MIN cmd /c "C:\Users\hello\redis5\redis-server.exe" --port 6379
    timeout /t 3 /nobreak >NUL
    echo       Redis started on port 6379
)

:: --- 2. Start EMQX ---
echo [2/5] Starting EMQX MQTT Broker...
"C:\Users\hello\emqx\bin\emqx.cmd" ping >NUL 2>&1
if %ERRORLEVEL%==0 (
    echo       EMQX already running - skipping
) else (
    start "DigiLog EMQX" /MIN cmd /c "C:\Users\hello\emqx\bin\emqx.cmd" start
    set EMQX_READY=0
    for /L %%i in (1,1,12) do (
        if !EMQX_READY!==0 (
            timeout /t 5 /nobreak >NUL
            "C:\Users\hello\emqx\bin\emqx.cmd" ping >NUL 2>&1
            if !ERRORLEVEL!==0 set EMQX_READY=1
        )
    )
    if !EMQX_READY!==1 (
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
    echo       Open Services (services.msc) and start "postgresql-x64-18"
)

:: --- 4. Start Backend API ---
echo [4/5] Starting Backend API (Fastify)...
start "DigiLog API" cmd /k "cd /d C:\Users\hello\21cfrlogbook-DigitalFMS\apps\api && title DigiLog API - Port 3000 && npx tsx watch src/app.ts"
timeout /t 8 /nobreak >NUL
echo       API starting on http://localhost:3000

:: --- 5. Start Frontend ---
echo [5/5] Starting Frontend (Vite)...
:: Kill any existing Vite process on port 5175 first
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":5175" ^| findstr "LISTENING"') do (
    echo       Killing old Vite process (PID: %%a)...
    taskkill /F /PID %%a >NUL 2>&1
)
timeout /t 2 /nobreak >NUL
start "DigiLog Web" cmd /k "cd /d C:\Users\hello\21cfrlogbook-DigitalFMS\apps\web && title DigiLog Web - Port 5175 && npx vite --host"
timeout /t 5 /nobreak >NUL
echo       Frontend starting on http://localhost:5175

:: --- Wait for API to be ready ---
echo.
echo  Waiting for API to be ready...
set API_READY=0
for /L %%i in (1,1,30) do (
    if !API_READY!==0 (
        curl -s -f http://localhost:3000/api/health >NUL 2>&1
        if !ERRORLEVEL!==0 (
            echo       Attempt %%i/30 - API not ready yet...
            timeout /t 3 /nobreak >NUL
        ) else (
            set API_READY=1
            echo       API is ready!
        )
    )
)
if !API_READY!==0 (
    echo       [WARNING] API did not respond within 90s. Opening browser anyway...
)

:: --- Wait for Vite to be ready ---
echo  Waiting for Frontend to be ready...
set VITE_READY=0
for /L %%i in (1,1,10) do (
    if !VITE_READY!==0 (
        curl -s -f http://localhost:5175/ >NUL 2>&1
        if !ERRORLEVEL!==0 (
            timeout /t 2 /nobreak >NUL
        ) else (
            set VITE_READY=1
            echo       Frontend is ready!
        )
    )
)

:: --- Done ---
echo.
echo  ============================================
echo   All services started!
echo  ============================================
echo.
echo   Frontend:  http://localhost:5175
echo   API:       http://localhost:3000
echo   Swagger:   http://localhost:3000/docs
echo   EMQX:      http://localhost:18083
echo   Login:     superadmin / Admin@123
echo.
echo  ============================================
echo.

:: Open browser
start http://localhost:5175

echo Press any key to exit this window (services keep running)...
pause >NUL
