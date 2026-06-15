@echo off
chcp 65001 >nul
cd /d "%~dp0"
title 早押しクイズ（LAN版）
echo.
echo  早押しクイズ — ローカルネットワーク版
echo  このウィンドウを閉じると部屋も終了します。
echo.
if not exist "node_modules\" (
  echo  初回: 依存パッケージをインストール中...
  call npm install
)
echo  起動中...
echo.
call npm start
pause
