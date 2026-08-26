@echo off
cd /d "%~dp0"
echo ===================================================
echo               Pushing to GitHub (main)
echo ===================================================
echo.
"C:\Program Files\Git\cmd\git.exe" push origin main
echo.
if %errorlevel% equ 0 (
    echo [SUCCESS] Berhasil dipush ke GitHub!
) else (
    echo [ERROR] Gagal melakukan push. Pastikan sudah login di browser.
)
echo.
pause
