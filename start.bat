@echo off
setlocal enabledelayedexpansion

title RE Stream - Live Streaming Server
color 0A

:: Check if node_modules exists
if not exist "node_modules" (
    echo Menyiapkan dependensi pertama kali...
    call npm install
)

:: Check if .env exists
if not exist ".env" (
    if exist ".env.example" copy ".env.example" ".env" >nul
)

set "SERVER_PORT=3002"
if exist ".env" (
    for /f "usebackq tokens=1,2 delims==" %%a in (".env") do (
        if "%%a"=="PORT" set "SERVER_PORT=%%b"
    )
)

echo ==============================================================================
echo              RE Stream — Live Streaming Server (Windows)
echo ==============================================================================
echo.
echo Server sedang berjalan di port %SERVER_PORT%...
echo URL Dashboard: http://localhost:%SERVER_PORT%
echo Tekan CTRL+C untuk menghentikan server.
echo.

:: Open browser automatically after a short delay
start "" "http://localhost:%SERVER_PORT%"

:: Run server
node server.js

pause
