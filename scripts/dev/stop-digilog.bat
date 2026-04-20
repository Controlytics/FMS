@echo off
title DigiLog - Stopping All Services
color 0C
echo.
echo  ============================================
echo   DigiLog - Stopping All Services
echo  ============================================
echo.

echo [1/3] Stopping Frontend (Vite)...
taskkill /FI "WINDOWTITLE eq DigiLog Web*" /F >NUL 2>&1
echo       Done

echo [2/3] Stopping Backend API...
taskkill /FI "WINDOWTITLE eq DigiLog API*" /F >NUL 2>&1
echo       Done

echo [3/3] Stopping EMQX...
"C:\Users\hello\emqx\bin\emqx.cmd" stop >NUL 2>&1
echo       Done

echo.
echo  All services stopped.
echo  (PostgreSQL keeps running - it's a Windows service.)
echo.
pause
