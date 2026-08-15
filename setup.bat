@echo off
setlocal enabledelayedexpansion

title RE Stream - Windows Setup Installer
color 0B

echo ==============================================================================
echo              RE Stream -- Live Streaming Server (Windows Setup)
echo ==============================================================================
echo.

:: -----------------------------------------------------------------------------
:: 1. Check & Auto-Download Node.js
:: -----------------------------------------------------------------------------
echo [1/5] Memeriksa instalasi Node.js...

where node >nul 2>nul
if %errorlevel% equ 0 goto :node_is_installed

echo [INFO] Node.js tidak ditemukan di sistem Anda.
echo Mengunduh dan menginstall Node.js v20 LTS otomatis...
echo.

set "NODE_MSI=node_installer.msi"
set "NODE_URL=https://nodejs.org/dist/v20.18.0/node-v20.18.0-x64.msi"

echo Men-download Node.js LTS dari nodejs.org...
powershell -NoProfile -ExecutionPolicy Bypass -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; (New-Object Net.WebClient).DownloadFile('%NODE_URL%', '%NODE_MSI%')"

if not exist "%NODE_MSI%" goto :node_download_failed

echo Menginstall Node.js (harap tunggu hingga selesai)...
msiexec /i "%NODE_MSI%" /passive /norestart
if exist "%NODE_MSI%" del /f /q "%NODE_MSI%"

:: Refresh PATH
set "PATH=%PATH%;C:\Program Files\nodejs;%APPDATA%\npm;C:\Program Files (x86)\nodejs"
goto :check_node_version

:node_download_failed
color 0C
echo [ERROR] Gagal mengunduh installer Node.js.
echo Silakan unduh dan pasang manual di https://nodejs.org/
pause
exit /b 1

:node_is_installed
:check_node_version
for /f "tokens=*" %%v in ('node -v 2^>nul') do set NODE_VER=%%v
if defined NODE_VER (
    echo [OK] Node.js terdeteksi: %NODE_VER%
) else (
    echo [OK] Node.js telah dipasang.
)
echo.

:: -----------------------------------------------------------------------------
:: 2. Check & Auto-Download FFmpeg (if not in PATH or bin)
:: -----------------------------------------------------------------------------
echo [2/5] Memeriksa FFmpeg...
if not exist "bin" mkdir "bin"

if exist "bin\ffmpeg.exe" goto :ffmpeg_is_ready
where ffmpeg >nul 2>nul
if %errorlevel% equ 0 goto :ffmpeg_is_ready

echo [INFO] FFmpeg tidak ditemukan. Mengunduh FFmpeg Windows ke folder bin...
powershell -NoProfile -ExecutionPolicy Bypass -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; $zip = 'ffmpeg_temp.zip'; try { (New-Object Net.WebClient).DownloadFile('https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip', $zip); Expand-Archive -Path $zip -DestinationPath 'ffmpeg_extracted' -Force; Get-ChildItem -Path 'ffmpeg_extracted' -Recurse -Filter 'ffmpeg.exe' | Copy-Item -Destination 'bin\ffmpeg.exe' -Force; Get-ChildItem -Path 'ffmpeg_extracted' -Recurse -Filter 'ffprobe.exe' | Copy-Item -Destination 'bin\ffprobe.exe' -Force; Remove-Item -Recurse -Force 'ffmpeg_extracted', $zip; Write-Host '[OK] FFmpeg berhasil dipasang di folder bin\' } catch { Write-Host '[WARNING] Download FFmpeg otomatis dilewati.' }"

:ffmpeg_is_ready
if exist "bin\ffmpeg.exe" (
    echo [OK] FFmpeg siap di bin\ffmpeg.exe
) else (
    for /f "tokens=*" %%f in ('ffmpeg -version 2^>nul') do (
        echo [OK] %%f
        goto :ffmpeg_step_done
    )
    echo [INFO] FFmpeg siap digunakan.
)
:ffmpeg_step_done
echo.

:: -----------------------------------------------------------------------------
:: 3. Create Required Folders
:: -----------------------------------------------------------------------------
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

:: -----------------------------------------------------------------------------
:: 4. Setup .env
:: -----------------------------------------------------------------------------
echo [4/5] Menyiapkan file konfigurasi .env...
if exist ".env" goto :env_exists
if exist ".env.example" (
    copy ".env.example" ".env" >nul
    echo [OK] Berhasil membuat .env dari template .env.example
    goto :env_done
)

(
    echo AUTH_USERNAME=admin
    echo AUTH_PASSWORD=admin123
    echo JWT_SECRET=re_stream_jwt_secret_token_2026_super_secure
    echo JWT_REFRESH_SECRET=re_stream_jwt_refresh_secret_2026_super_secure
    echo PORT=3002
) > ".env"
echo [OK] Berhasil membuat file .env baru

:env_exists
echo [OK] File .env sudah ada.
:env_done
echo.

:: -----------------------------------------------------------------------------
:: 5. Install Dependencies (npm install)
:: -----------------------------------------------------------------------------
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
echo  2. Atau dengan PM2: 'npm run pm2:start' (atau double-click pm2-manage.bat)
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
