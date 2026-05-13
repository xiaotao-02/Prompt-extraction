@echo off
REM 一键把本扩展加载到 Chrome（开发者模式 · 加载已解压扩展）
REM 双击此文件即可：会自动 npm install / npm run build / 启动 Chrome 加载扩展

setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [install] 未检测到 Node.js，请先安装 Node 18+：https://nodejs.org/
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo [install] 首次运行，先执行 npm install...
  call npm install
  if errorlevel 1 (
    echo [install] npm install 失败
    pause
    exit /b 1
  )
)

node scripts/install-to-chrome.mjs %*
set EXITCODE=%ERRORLEVEL%

if not "%EXITCODE%"=="0" (
  echo.
  echo [install] 脚本退出码 %EXITCODE%
  pause
)
exit /b %EXITCODE%
