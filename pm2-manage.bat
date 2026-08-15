@echo off
setlocal enabledelayedexpansion

title RE Stream - PM2 Manager (Windows)
color 0B

:menu
cls
echo ==============================================================================
echo              RE Stream — PM2 Process Manager (Windows)
echo ==============================================================================
echo.
echo  [1] Start Server (PM2)
echo  [2] Stop Server (PM2)
echo  [3] Restart Server (PM2)
echo  [4] View Live Logs (PM2)
echo  [5] Check Status (PM2)
echo  [6] Delete from PM2
echo  [7] Exit
echo.
echo ==============================================================================
set /p choice="Pilih menu (1-7): "

if "%choice%"=="1" (
    echo.
    echo Menjalankan aplikasi dengan PM2...
    call npx pm2 start ecosystem.config.js
    pause
    goto menu
)
if "%choice%"=="2" (
    echo.
    echo Menghentikan aplikasi di PM2...
    call npx pm2 stop re-stream-web
    pause
    goto menu
)
if "%choice%"=="3" (
    echo.
    echo Me-restart aplikasi di PM2...
    call npx pm2 restart re-stream-web
    pause
    goto menu
)
if "%choice%"=="4" (
    echo.
    echo Membuka realtime logs (Tekan CTRL+C untuk keluar dari log)...
    call npx pm2 logs re-stream-web
    pause
    goto menu
)
if "%choice%"=="5" (
    echo.
    echo Status Proses PM2:
    call npx pm2 status
    pause
    goto menu
)
if "%choice%"=="6" (
    echo.
    echo Menghapus aplikasi dari daftar PM2...
    call npx pm2 delete re-stream-web
    pause
    goto menu
)
if "%choice%"=="7" (
    exit /b 0
)

echo Pilihan tidak valid.
pause
goto menu
