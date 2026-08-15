@echo off
setlocal enabledelayedexpansion

title RE Stream - Windows Setup Installer
color 0B

echo ==============================================================================
echo              RE Stream — Live Streaming Server (Windows Setup)
echo ==============================================================================
echo.

:: 1. Check Node.js
echo [1/5] Memeriksa instalasi Node.js...
where node >nul 2>nul
if %errorlevel% neq 0 (
    color 0C
    echo [ERROR] Node.js tidak ditemukan!
    echo Silakan unduh dan install Node.js (LTS) dari https://nodejs.org/
    echo Setelah selesai menginstall, buka kembali file ini.
    echo.
    pause
    exit /b 1
)

for /f "tokens=*" %%v in ('node -v') do set NODE_VER=%%v
echo [OK] Node.js terdeteksi: %NODE_VER%
echo.

:: 2. Check FFmpeg
echo [2/5] Memeriksa FFmpeg...
where ffmpeg >nul 2>nul
if %errorlevel% neq 0 (
    if exist "bin\ffmpeg.exe" (
        echo [OK] FFmpeg ditemukan di folder lokal: bin\ffmpeg.exe
    ) else (
        echo [WARNING] FFmpeg tidak ditemukan di sistem PATH maupun di bin\ffmpeg.exe
        echo Pastikan FFmpeg sudah terpasang di Windows PATH atau letakkan ffmpeg.exe di folder 'bin\'.
    )
) else (
    for /f "tokens=*" %%f in ('ffmpeg -version 2^>nul') do (
        set FFMPEG_VER=%%f
        goto :ffmpeg_found
    )
)
:ffmpeg_found
if defined FFMPEG_VER echo [OK] %FFMPEG_VER%
echo.

:: 3. Create Required Folders
echo [3/5] Menyiapkan struktur folder...
if not exist "data" mkdir "data"
if not exist "logs" mkdir "logs"
if not exist "playlists" mkdir "playlists"
if not exist "uploads\videos" mkdir "uploads\videos"
if not exist "uploads\audios" mkdir "uploads\audios"
if not exist "uploads\thumbnails" mkdir "uploads\thumbnails"
if not exist "bin" mkdir "bin"
echo [OK] Folder data, logs, playlists, uploads, dan bin siap.
echo.

:: 4. Setup .env
echo [4/5] Menyiapkan file konfigurasi .env...
if not exist ".env" (
    if exist ".env.example" (
        copy ".env.example" ".env" >nul
        echo [OK] Berhasil membuat .env dari template .env.example
    ) else (
        (
            echo AUTH_USERNAME=admin
            echo AUTH_PASSWORD=admin123
            echo JWT_SECRET=re_stream_jwt_secret_token_2026_super_secure
            echo JWT_REFRESH_SECRET=re_stream_jwt_refresh_secret_2026_super_secure
            echo PORT=3002
        ) > ".env"
        echo [OK] Berhasil membuat file .env baru
    )
) else (
    echo [OK] File .env sudah ada.
)
echo.

:: 5. Install Dependencies
echo [5/5] Menginstall dependensi (npm install)...
call npm install --no-audit --fund=false
if %errorlevel% neq 0 (
    color 0C
    echo [ERROR] Gagal menginstall dependensi npm.
    pause
    exit /b 1
)
echo [OK] Dependensi npm berhasil diinstall.
echo.

color 0A
echo ==============================================================================
echo                    SETUP WINDOWS BERHASIL SELESAI!
echo ==============================================================================
echo.
echo Untuk menjalankan server:
echo  1. Jalankan langsung dengan start.bat (atau 'npm start')
echo  2. Atau dengan PM2: 'npm run pm2:start'
echo.
echo Akses Web Dashboard di: http://localhost:3002
echo Default Login: admin / admin123
echo ==============================================================================
echo.

set /p RUN_NOW="Apakah Anda ingin langsung menjalankan server sekarang? (Y/N): "
if /i "%RUN_NOW%"=="Y" (
    echo.
    echo Menjalankan server...
    start http://localhost:3002
    node server.js
)

pause
