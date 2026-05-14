@echo off
setlocal
cd /d "%~dp0"

echo.
echo [%TIME%] 一键打包: npm run zip （构建 dist + 生成 dist-zip\*.zip）
echo.

call npm run zip
set "EXIT=%ERRORLEVEL%"

echo.
if %EXIT% neq 0 (
  echo [失败] 退出码 %EXIT%，请向上查看报错。
) else (
  echo [完成] 未解压产物: "%~dp0dist"
  echo [完成] ZIP 输出目录: "%~dp0dist-zip"
)

echo.
pause
exit /b %EXIT%
