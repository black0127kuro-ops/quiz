@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

set "OUT=dist\quiz-lan-usb"
set "NODE_VER=20.18.1"
set "NODE_ZIP=node-v%NODE_VER%-win-x64.zip"
set "NODE_URL=https://nodejs.org/dist/v%NODE_VER%/%NODE_ZIP%"

echo.
echo Building USB portable package...
echo.

if not exist "node_modules\express\" (
  echo Running npm install...
  call npm install
  if errorlevel 1 exit /b 1
)

if exist "%OUT%" rmdir /s /q "%OUT%"
mkdir "%OUT%\app" 2>nul
mkdir "%OUT%\node" 2>nul

echo Copying app...
copy /y "server.js" "%OUT%\app\" >nul
xcopy /e /i /q "public" "%OUT%\app\public" >nul
xcopy /e /i /q "node_modules" "%OUT%\app\node_modules" >nul
copy /y "portable\quiz-lan.bat" "%OUT%\quiz-lan.bat" >nul
copy /y "portable\README-USB.txt" "%OUT%\README-USB.txt" >nul
copy /y "portable\allow-firewall-once.bat" "%OUT%\allow-firewall-once.bat" >nul

if not exist "%OUT%\node\node.exe" (
  echo Downloading Node.js %NODE_VER%...
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0portable\download-node.ps1" -NodeVer "%NODE_VER%" -OutDir "%OUT%"
  if errorlevel 1 (
    echo Download failed. Check internet connection.
    pause
    exit /b 1
  )
)

echo.
echo Done: %OUT%\
echo Copy this folder to USB. Run quiz-lan.bat on the school PC.
echo.
pause
