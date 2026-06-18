@echo off
chcp 65001 >nul
cd /d "%~dp0app"
title Quiz LAN
echo.
echo  Quiz LAN - close this window to stop.
echo.
"%~dp0node\node.exe" server.js
pause
