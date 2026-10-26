@echo off
chcp 65001 >nul
cd /d %~dp0
where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 未检测到 Node.js，请先安装 18 或更高版本：https://nodejs.org
  pause
  exit /b 1
)
if not exist node_modules (
  echo [1/2] 正在安装依赖，请稍候…
  call npm install --no-audit --no-fund
)
if not exist .env copy .env.example .env >nul
echo [2/2] 启动服务：http://localhost:3000
call npm start
pause
