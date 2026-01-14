@echo off
echo Stopping System Monitor...
taskkill /F /IM node.exe >nul 2>&1
if %errorlevel% equ 0 (
    echo System Monitor stopped successfully.
) else (
    echo No running System Monitor found.
)
timeout /t 2 >nul
