@echo off
chcp 65001 >nul
cd /d "%~dp0app"
title Quiz LAN
echo.
echo  Quiz LAN - close this window to stop.
echo.
echo  [Firewall] If Windows asks, choose ALLOW on Private network.
echo  Participants cannot connect if blocked.
echo.
"%~dp0node\node.exe" server.js
pause
