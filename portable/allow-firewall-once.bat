@echo off
chcp 65001 >nul
:: 管理者権限が必要（校務PCで1回だけ実行）
net session >nul 2>&1
if errorlevel 1 (
  echo 管理者として実行してください（右クリック - 管理者として実行）
  pause
  exit /b 1
)

set "RULE=Quiz LAN TCP 3000"
netsh advfirewall firewall delete rule name="%RULE%" >nul 2>&1
netsh advfirewall firewall add rule name="%RULE%" dir=in action=allow protocol=TCP localport=3000 profile=private
if errorlevel 1 (
  echo ルールの追加に失敗しました。
  pause
  exit /b 1
)

echo.
echo  プライベートネットワーク向けに TCP 3000 を許可しました。
echo  その後 quiz-lan.bat を再度実行してください。
echo.
pause
