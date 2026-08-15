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

echo ==============================================================================
echo              RE Stream — Live Streaming Server (Windows)
echo ==============================================================================
echo.
echo Server sedang berjalan...
echo URL Dashboard: http://localhost:3002
echo Tekan CTRL+C untuk menghentikan server.
echo.

:: Open browser automatically after a short delay
start "" http://localhost:3002

:: Run server
node server.js

pause
